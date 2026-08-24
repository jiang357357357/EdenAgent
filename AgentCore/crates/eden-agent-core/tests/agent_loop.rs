use async_trait::async_trait;
use eden_agent_core::{
    AgentContext, AgentError, AgentEvent, AgentLoop, AgentLoopConfig, AssistantMessage, ContentBlock, EventEmitter,
    LoopControl, LoopHooks, LoopTurnContext, LoopTurnUpdate, Message, ModelAdapter, ModelError, ModelRequest,
    ModelSpec, QueueMode, Tool, ToolCall, ToolCallContext, ToolDefinition, ToolExecutionMode, ToolFailure, ToolOutput,
    event_channel,
};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

struct ScriptedModel {
    responses: Mutex<VecDeque<AssistantMessage>>,
    requests: Mutex<Vec<ModelRequest>>,
}

impl ScriptedModel {
    fn new(responses: Vec<AssistantMessage>) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
            requests: Mutex::new(Vec::new()),
        }
    }

    fn requests(&self) -> Vec<ModelRequest> {
        self.requests.lock().unwrap().clone()
    }
}

#[async_trait]
impl ModelAdapter for ScriptedModel {
    async fn generate(
        &self,
        request: ModelRequest,
        _events: EventEmitter,
        _cancellation: CancellationToken,
    ) -> Result<eden_agent_core::ModelOutput, ModelError> {
        self.requests.lock().unwrap().push(request);
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .map(eden_agent_core::ModelOutput::complete)
            .ok_or_else(|| ModelError::new("script_exhausted", "No scripted response"))
    }
}

struct HangingModel;

#[async_trait]
impl ModelAdapter for HangingModel {
    async fn generate(
        &self,
        _request: ModelRequest,
        _events: EventEmitter,
        _cancellation: CancellationToken,
    ) -> Result<eden_agent_core::ModelOutput, ModelError> {
        std::future::pending().await
    }
}

struct DynamicHooks {
    preparations: AtomicUsize,
}

#[async_trait]
impl LoopHooks for DynamicHooks {
    async fn prepare_model_context(
        &self,
        mut context: AgentContext,
        _cancellation: CancellationToken,
    ) -> Result<AgentContext, AgentError> {
        context.metadata["prepared"] = serde_json::Value::Bool(true);
        Ok(context)
    }

    async fn prepare_next_turn(
        &self,
        turn: LoopTurnContext,
        _cancellation: CancellationToken,
    ) -> Result<Option<LoopTurnUpdate>, AgentError> {
        if self.preparations.fetch_add(1, Ordering::SeqCst) != 0 {
            return Ok(None);
        }
        let mut context = turn.context;
        context.system_prompt = "updated prompt".to_owned();
        Ok(Some(LoopTurnUpdate {
            context: Some(context),
            model: Some(ModelSpec {
                id: "updated-model".to_owned(),
                provider: "updated-provider".to_owned(),
                ..ModelSpec::default()
            }),
            tools: None,
        }))
    }
}

struct StopAfterFirstTurn;

#[async_trait]
impl LoopHooks for StopAfterFirstTurn {
    async fn should_stop_after_turn(
        &self,
        _turn: LoopTurnContext,
        _cancellation: CancellationToken,
    ) -> Result<bool, AgentError> {
        Ok(true)
    }
}

struct EchoTool;

#[async_trait]
impl Tool for EchoTool {
    fn definition(&self) -> ToolDefinition {
        let mut definition = ToolDefinition::direct("echo", "Echo text");
        definition.parameters = serde_json::json!({
            "type":"object",
            "properties":{"text":{"type":"string"}},
            "required":["text"],
            "additionalProperties":false
        });
        definition
    }

    async fn execute(&self, call: &ToolCall, _context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        Ok(ToolOutput::text(
            call.arguments
                .get("text")
                .and_then(|value| value.as_str())
                .unwrap_or_default(),
        ))
    }
}

struct SlowTool;

#[async_trait]
impl Tool for SlowTool {
    fn definition(&self) -> ToolDefinition {
        let mut definition = ToolDefinition::direct("slow", "Exceed its execution deadline");
        definition.parameters = serde_json::json!({
            "type":"object",
            "properties":{"text":{"type":"string"}},
            "required":["text"],
            "additionalProperties":false
        });
        definition
    }

    fn timeout(&self) -> Option<Duration> {
        Some(Duration::from_millis(10))
    }

    async fn execute(&self, _call: &ToolCall, _context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        tokio::time::sleep(Duration::from_secs(1)).await;
        Ok(ToolOutput::text("too late"))
    }
}

struct SchemaTool {
    executions: AtomicUsize,
    require_output: bool,
}

#[async_trait]
impl Tool for SchemaTool {
    fn definition(&self) -> ToolDefinition {
        let mut definition = ToolDefinition::direct("schema", "Validate input and output");
        definition.parameters = serde_json::json!({
            "type": "object",
            "properties": {"count": {"type": "integer"}},
            "required": ["count"],
            "additionalProperties": false
        });
        if self.require_output {
            definition.output_schema = Some(serde_json::json!({
                "type": "object",
                "required": ["ok"],
                "properties": {"ok": {"type": "boolean"}}
            }));
        }
        definition
    }

    async fn execute(&self, _call: &ToolCall, _context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        self.executions.fetch_add(1, Ordering::SeqCst);
        Ok(ToolOutput::text("executed"))
    }
}

struct ConcurrencyTool {
    active: AtomicUsize,
    maximum: AtomicUsize,
    mode: ToolExecutionMode,
}

impl ConcurrencyTool {
    fn new(mode: ToolExecutionMode) -> Self {
        Self {
            active: AtomicUsize::new(0),
            maximum: AtomicUsize::new(0),
            mode,
        }
    }
}

#[async_trait]
impl Tool for ConcurrencyTool {
    fn definition(&self) -> ToolDefinition {
        let mut definition = ToolDefinition::direct("work", "Observe scheduling");
        definition.parameters = serde_json::json!({
            "type":"object",
            "properties":{"text":{"type":"string"}},
            "required":["text"],
            "additionalProperties":false
        });
        definition.execution_mode = self.mode;
        definition
    }

    async fn execute(&self, _call: &ToolCall, _context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.maximum.fetch_max(active, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(20)).await;
        self.active.fetch_sub(1, Ordering::SeqCst);
        Ok(ToolOutput::text("done"))
    }
}

fn assistant_with_calls(calls: &[(&str, &str)]) -> AssistantMessage {
    AssistantMessage {
        content: calls
            .iter()
            .map(|(id, name)| ContentBlock::ToolCall {
                id: (*id).to_owned(),
                name: (*name).to_owned(),
                arguments: serde_json::json!({"text": id}),
                provider_item_id: None,
            })
            .collect(),
        stop_reason: "tool_calls".to_owned(),
        ..AssistantMessage::text("")
    }
}

async fn run_and_collect(driver: AgentLoop, control: LoopControl) -> (eden_agent_core::RunResult, Vec<AgentEvent>) {
    let (emitter, mut receiver) = event_channel(64);
    let collector = tokio::spawn(async move {
        let mut events = Vec::new();
        while let Some(event) = receiver.recv().await {
            events.push(event);
        }
        events
    });
    let result = driver
        .run(
            vec![Message::user("hello")],
            AgentContext::default(),
            control,
            CancellationToken::new(),
            emitter,
        )
        .await
        .expect("agent loop should complete");
    let events = collector.await.expect("collector should complete");
    (result, events)
}

#[tokio::test]
async fn tool_result_is_added_and_sent_back_to_model() {
    let model = Arc::new(ScriptedModel::new(vec![
        assistant_with_calls(&[("call_1", "echo")]),
        AssistantMessage::text("finished"),
    ]));
    let mut config = AgentLoopConfig::new(ModelSpec::default(), model.clone());
    config.tools.register(Arc::new(EchoTool));
    let (result, events) = run_and_collect(AgentLoop::new(config), LoopControl::default()).await;

    assert_eq!(result.turns, 2);
    assert!(matches!(result.new_messages[2], Message::ToolResult(_)));
    assert!(
        model.requests()[1]
            .messages
            .iter()
            .any(|message| matches!(message, Message::ToolResult(_)))
    );
    assert!(
        events
            .iter()
            .any(|event| matches!(event, AgentEvent::ToolExecutionEnd { .. }))
    );
    assert!(matches!(events.last(), Some(AgentEvent::AgentEnd { .. })));
    assert!(matches!(events.first(), Some(AgentEvent::AgentStart)));
    assert!(matches!(events.get(1), Some(AgentEvent::TurnStart { turn: 1 })));
}

#[tokio::test]
async fn tool_timeout_becomes_a_structured_result_and_the_loop_recovers() {
    let model = Arc::new(ScriptedModel::new(vec![
        assistant_with_calls(&[("slow_1", "slow")]),
        AssistantMessage::text("recovered"),
    ]));
    let mut config = AgentLoopConfig::new(ModelSpec::default(), model);
    config.tools.register(Arc::new(SlowTool));
    let (result, _) = run_and_collect(AgentLoop::new(config), LoopControl::default()).await;
    let Message::ToolResult(error) = &result.new_messages[2] else {
        panic!("expected timeout tool result")
    };
    assert!(error.is_error);
    assert_eq!(error.error.as_ref().map(|error| error.code.as_str()), Some("timeout"));
    assert_eq!(result.turns, 2);
}

#[tokio::test]
async fn invalid_tool_arguments_are_returned_without_executing() {
    let mut invalid_call = assistant_with_calls(&[("invalid_1", "schema")]);
    if let ContentBlock::ToolCall { arguments, .. } = &mut invalid_call.content[0] {
        *arguments = serde_json::json!({"count": "not-an-integer"});
    }
    let model = Arc::new(ScriptedModel::new(vec![
        invalid_call,
        AssistantMessage::text("recovered"),
    ]));
    let tool = Arc::new(SchemaTool {
        executions: AtomicUsize::new(0),
        require_output: false,
    });
    let mut config = AgentLoopConfig::new(ModelSpec::default(), model.clone());
    config.tools.register(tool.clone());
    let (result, _) = run_and_collect(AgentLoop::new(config), LoopControl::default()).await;
    assert_eq!(tool.executions.load(Ordering::SeqCst), 0);
    let Message::ToolResult(error) = &result.new_messages[2] else {
        panic!("expected validation tool result")
    };
    assert!(error.is_error);
    assert_eq!(
        error.error.as_ref().map(|error| error.code.as_str()),
        Some("invalid_arguments")
    );
}

#[tokio::test]
async fn declared_output_schema_requires_structured_content() {
    let mut call = assistant_with_calls(&[("output_1", "schema")]);
    if let ContentBlock::ToolCall { arguments, .. } = &mut call.content[0] {
        *arguments = serde_json::json!({"count": 1});
    }
    let model = Arc::new(ScriptedModel::new(vec![call, AssistantMessage::text("recovered")]));
    let tool = Arc::new(SchemaTool {
        executions: AtomicUsize::new(0),
        require_output: true,
    });
    let mut config = AgentLoopConfig::new(ModelSpec::default(), model);
    config.tools.register(tool.clone());
    let (result, _) = run_and_collect(AgentLoop::new(config), LoopControl::default()).await;
    assert_eq!(tool.executions.load(Ordering::SeqCst), 1);
    let Message::ToolResult(error) = &result.new_messages[2] else {
        panic!("expected output validation result")
    };
    assert_eq!(
        error.error.as_ref().map(|error| error.code.as_str()),
        Some("invalid_tool_output")
    );
}

#[tokio::test]
async fn parallel_tools_overlap_but_results_keep_model_order() {
    let model = Arc::new(ScriptedModel::new(vec![
        assistant_with_calls(&[("first", "work"), ("second", "work")]),
        AssistantMessage::text("finished"),
    ]));
    let tool = Arc::new(ConcurrencyTool::new(ToolExecutionMode::Parallel));
    let mut config = AgentLoopConfig::new(ModelSpec::default(), model);
    config.tools.register(tool.clone());
    let (result, _) = run_and_collect(AgentLoop::new(config), LoopControl::default()).await;

    assert_eq!(tool.maximum.load(Ordering::SeqCst), 2);
    let ids: Vec<_> = result
        .new_messages
        .iter()
        .filter_map(|message| match message {
            Message::ToolResult(result) => Some(result.tool_call_id.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(ids, ["first", "second"]);
}

#[tokio::test]
async fn a_sequential_tool_turns_the_batch_into_a_barrier() {
    let model = Arc::new(ScriptedModel::new(vec![
        assistant_with_calls(&[("first", "work"), ("second", "work")]),
        AssistantMessage::text("finished"),
    ]));
    let tool = Arc::new(ConcurrencyTool::new(ToolExecutionMode::Sequential));
    let mut config = AgentLoopConfig::new(ModelSpec::default(), model);
    config.tools.register(tool.clone());
    run_and_collect(AgentLoop::new(config), LoopControl::default()).await;
    assert_eq!(tool.maximum.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn queued_follow_up_opens_another_turn() {
    let model = Arc::new(ScriptedModel::new(vec![
        AssistantMessage::text("first"),
        AssistantMessage::text("second"),
    ]));
    let config = AgentLoopConfig::new(ModelSpec::default(), model.clone());
    let control = LoopControl {
        steering: eden_agent_core::PendingMessageQueue::new(QueueMode::OneAtATime),
        follow_up: eden_agent_core::PendingMessageQueue::new(QueueMode::OneAtATime),
    };
    control.follow_up.enqueue(Message::user("follow up"));
    let (result, _) = run_and_collect(AgentLoop::new(config), control).await;

    assert_eq!(result.turns, 2);
    assert!(model.requests()[1].messages.iter().any(|message| {
        match message {
            Message::User {
                content: eden_agent_core::UserContent::Blocks(blocks),
                ..
            } => blocks
                .iter()
                .any(|block| matches!(block, ContentBlock::Text { text } if text == "follow up")),
            _ => false,
        }
    }));
}

#[tokio::test]
async fn cancellation_interrupts_an_uncooperative_model_future() {
    let config = AgentLoopConfig::new(ModelSpec::default(), Arc::new(HangingModel));
    let driver = AgentLoop::new(config);
    let cancellation = CancellationToken::new();
    let task_cancellation = cancellation.clone();
    let (emitter, mut receiver) = event_channel(32);
    let collector = tokio::spawn(async move {
        let mut events = Vec::new();
        while let Some(event) = receiver.recv().await {
            events.push(event);
        }
        events
    });
    let task = tokio::spawn(async move {
        driver
            .run(
                vec![Message::user("wait")],
                AgentContext::default(),
                LoopControl::default(),
                task_cancellation,
                emitter,
            )
            .await
    });
    tokio::task::yield_now().await;
    cancellation.cancel();
    let result = tokio::time::timeout(Duration::from_secs(1), task)
        .await
        .expect("cancellation should be prompt")
        .expect("task should not panic")
        .expect("loop should settle cleanly");
    let events = collector.await.expect("collector should complete");

    assert!(
        matches!(result.new_messages.last(), Some(Message::Assistant(message)) if message.stop_reason == "aborted")
    );
    assert!(matches!(events.last(), Some(AgentEvent::AgentEnd { .. })));
}

#[tokio::test]
async fn dynamic_loop_hooks_transform_provider_context_and_next_turn() {
    let model = Arc::new(ScriptedModel::new(vec![
        assistant_with_calls(&[("call_1", "echo")]),
        AssistantMessage::text("finished"),
    ]));
    let mut config = AgentLoopConfig::new(ModelSpec::default(), model.clone());
    config.tools.register(Arc::new(EchoTool));
    config.loop_hooks = Arc::new(DynamicHooks {
        preparations: AtomicUsize::new(0),
    });

    let (result, _) = run_and_collect(AgentLoop::new(config), LoopControl::default()).await;
    let requests = model.requests();
    assert_eq!(result.turns, 2);
    assert_eq!(requests[0].metadata["prepared"], true);
    assert_eq!(requests[1].system_prompt, "updated prompt");
    assert_eq!(requests[1].model.id, "updated-model");
}

#[tokio::test]
async fn should_stop_hook_ends_even_when_a_tool_requested_another_model_step() {
    let model = Arc::new(ScriptedModel::new(vec![assistant_with_calls(&[("call_1", "echo")])]));
    let mut config = AgentLoopConfig::new(ModelSpec::default(), model.clone());
    config.tools.register(Arc::new(EchoTool));
    config.loop_hooks = Arc::new(StopAfterFirstTurn);

    let (result, events) = run_and_collect(AgentLoop::new(config), LoopControl::default()).await;
    assert_eq!(result.turns, 1);
    assert_eq!(model.requests().len(), 1);
    assert!(matches!(events.last(), Some(AgentEvent::AgentEnd { .. })));
}
