use crate::event::DEFAULT_EVENT_CAPACITY;
use crate::{
    AgentContext, AgentError, AgentEvent, AgentLoop, AgentLoopConfig, AssistantMessage, LoopControl, Message,
    PendingMessageQueue, QueueMode, RunResult, event_channel,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct AgentOptions {
    pub loop_config: AgentLoopConfig,
    pub initial_context: AgentContext,
    pub steering_mode: QueueMode,
    pub follow_up_mode: QueueMode,
    pub event_capacity: usize,
}

impl AgentOptions {
    pub fn new(loop_config: AgentLoopConfig) -> Self {
        Self {
            loop_config,
            initial_context: AgentContext::default(),
            steering_mode: QueueMode::OneAtATime,
            follow_up_mode: QueueMode::OneAtATime,
            event_capacity: DEFAULT_EVENT_CAPACITY,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct AgentState {
    pub context: AgentContext,
    pub is_streaming: bool,
    pub streaming_message: Option<AssistantMessage>,
    pub pending_tool_calls: Vec<String>,
    pub error_message: Option<String>,
}

#[derive(Clone)]
pub struct Agent {
    loop_driver: AgentLoop,
    control: LoopControl,
    state: Arc<RwLock<AgentState>>,
    active: Arc<AtomicBool>,
    event_capacity: usize,
}

impl Agent {
    pub fn new(options: AgentOptions) -> Self {
        Self {
            loop_driver: AgentLoop::new(options.loop_config),
            control: LoopControl {
                steering: PendingMessageQueue::new(options.steering_mode),
                follow_up: PendingMessageQueue::new(options.follow_up_mode),
            },
            state: Arc::new(RwLock::new(AgentState {
                context: options.initial_context,
                ..AgentState::default()
            })),
            active: Arc::new(AtomicBool::new(false)),
            event_capacity: options.event_capacity.max(1),
        }
    }

    pub fn state(&self) -> AgentState {
        self.state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn is_running(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    pub fn steer(&self, message: Message) {
        self.control.steering.enqueue(message);
    }

    pub fn follow_up(&self, message: Message) {
        self.control.follow_up.enqueue(message);
    }

    pub fn clear_queues(&self) {
        self.control.steering.clear();
        self.control.follow_up.clear();
    }

    pub fn start_text(&self, text: impl Into<String>) -> Result<AgentRun, AgentError> {
        self.start(vec![Message::user(text)])
    }

    pub fn start(&self, prompts: Vec<Message>) -> Result<AgentRun, AgentError> {
        if self
            .active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(AgentError::AlreadyRunning);
        }

        {
            let mut state = self.state.write().unwrap_or_else(|poisoned| poisoned.into_inner());
            state.is_streaming = true;
            state.streaming_message = None;
            state.pending_tool_calls.clear();
            state.error_message = None;
        }

        let (emitter, mut internal_events) = event_channel(self.event_capacity);
        let (external_events, events) = mpsc::channel(self.event_capacity);
        let cancellation = CancellationToken::new();
        let loop_driver = self.loop_driver.clone();
        let context = self.state().context;
        let control = self.control.clone();
        let active = Arc::clone(&self.active);
        let state = Arc::clone(&self.state);
        let observer_state = Arc::clone(&self.state);
        let task_cancellation = cancellation.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(event) = internal_events.recv().await {
                apply_event(&observer_state, &event);
                if external_events.send(event).await.is_err() {
                    break;
                }
            }
        });
        let completion = tokio::spawn(async move {
            let result = loop_driver
                .run(prompts, context, control, task_cancellation, emitter)
                .await;
            let _ = forwarder.await;
            settle_state(&state, &result);
            active.store(false, Ordering::Release);
            result
        });

        Ok(AgentRun {
            events,
            cancellation,
            completion,
        })
    }
}

pub struct AgentRun {
    pub events: mpsc::Receiver<AgentEvent>,
    cancellation: CancellationToken,
    completion: JoinHandle<Result<RunResult, AgentError>>,
}

impl AgentRun {
    pub fn abort(&self) {
        self.cancellation.cancel();
    }

    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    pub async fn result(mut self) -> Result<RunResult, AgentError> {
        let drain_events = async { while self.events.recv().await.is_some() {} };
        let ((), result) = tokio::join!(drain_events, self.completion);
        result.map_err(|error| AgentError::Join(error.to_string()))?
    }
}

fn settle_state(state: &RwLock<AgentState>, result: &Result<RunResult, AgentError>) {
    let mut state = state.write().unwrap_or_else(|poisoned| poisoned.into_inner());
    state.is_streaming = false;
    state.streaming_message = None;
    state.pending_tool_calls.clear();
    match result {
        Ok(result) => {
            state.context = result.context.clone();
            state.error_message = result.new_messages.iter().rev().find_map(|message| match message {
                Message::Assistant(message) => message.error_message.clone(),
                _ => None,
            });
        }
        Err(error) => state.error_message = Some(error.to_string()),
    }
}

fn apply_event(state: &RwLock<AgentState>, event: &AgentEvent) {
    let mut state = state.write().unwrap_or_else(|poisoned| poisoned.into_inner());
    match event {
        AgentEvent::MessageStart {
            message: Message::Assistant(message),
        } => state.streaming_message = Some(message.clone()),
        AgentEvent::MessageUpdate { message, .. } => state.streaming_message = Some(message.clone()),
        AgentEvent::StreamReset { .. } => state.streaming_message = None,
        AgentEvent::MessageEnd { message } => {
            state.streaming_message = None;
            state.context.messages.push(message.clone());
            if let Message::Assistant(message) = message {
                if let Some(error) = &message.error_message {
                    state.error_message = Some(error.clone());
                }
            }
        }
        AgentEvent::ToolExecutionStart { tool_call_id, .. } => {
            if !state.pending_tool_calls.contains(tool_call_id) {
                state.pending_tool_calls.push(tool_call_id.clone());
            }
        }
        AgentEvent::ToolExecutionEnd { tool_call_id, .. } => {
            state.pending_tool_calls.retain(|pending| pending != tool_call_id);
        }
        AgentEvent::AgentEnd { .. } => {
            state.streaming_message = None;
            state.pending_tool_calls.clear();
        }
        _ => {}
    }
}
