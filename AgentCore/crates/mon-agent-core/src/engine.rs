use crate::event::AgentEvent;
use crate::message::now_ms;
use crate::tool::{AfterToolCall, BeforeToolCall, ToolFailure};
use crate::{
    AgentError, AssistantMessage, ContentBlock, EventEmitter, LoopHooks, LoopTurnContext, Message, ModelAdapter,
    ModelRequest, ModelSpec, NoopLoopHooks, NoopToolHooks, PendingMessageQueue, QueueMode, ToolCall, ToolCallContext,
    ToolErrorInfo, ToolExecutionMode, ToolHooks, ToolOutput, ToolRegistry, ToolResultMessage,
};
use futures::future::join_all;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentContext {
    pub system_prompt: String,
    pub messages: Vec<Message>,
    pub metadata: Value,
}

#[derive(Clone)]
pub struct AgentLoopConfig {
    pub model_spec: ModelSpec,
    pub model: Arc<dyn ModelAdapter>,
    pub tools: ToolRegistry,
    pub hooks: Arc<dyn ToolHooks>,
    pub loop_hooks: Arc<dyn LoopHooks>,
    pub tool_execution: ToolExecutionMode,
    pub session_id: Option<String>,
    pub max_steps: u32,
}

impl AgentLoopConfig {
    pub fn new(model_spec: ModelSpec, model: Arc<dyn ModelAdapter>) -> Self {
        Self {
            model_spec,
            model,
            tools: ToolRegistry::new(),
            hooks: Arc::new(NoopToolHooks),
            loop_hooks: Arc::new(NoopLoopHooks),
            tool_execution: ToolExecutionMode::Parallel,
            session_id: None,
            max_steps: 128,
        }
    }
}

#[derive(Clone, Debug)]
pub struct LoopControl {
    pub steering: PendingMessageQueue,
    pub follow_up: PendingMessageQueue,
}

impl Default for LoopControl {
    fn default() -> Self {
        Self {
            steering: PendingMessageQueue::new(QueueMode::OneAtATime),
            follow_up: PendingMessageQueue::new(QueueMode::OneAtATime),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RunResult {
    pub new_messages: Vec<Message>,
    pub context: AgentContext,
    pub turns: u32,
}

#[derive(Clone)]
pub struct AgentLoop {
    config: AgentLoopConfig,
}

impl AgentLoop {
    pub fn new(config: AgentLoopConfig) -> Self {
        Self { config }
    }

    pub async fn run(
        &self,
        prompts: Vec<Message>,
        mut context: AgentContext,
        control: LoopControl,
        cancellation: CancellationToken,
        events: EventEmitter,
    ) -> Result<RunResult, AgentError> {
        let new_messages = prompts.clone();
        context.messages.extend(prompts.clone());

        events.emit(AgentEvent::AgentStart).await?;
        events.emit(AgentEvent::TurnStart { turn: 1 }).await?;
        for prompt in prompts {
            emit_message(&events, prompt).await?;
        }
        self.run_inner(context, new_messages, control, cancellation, events)
            .await
    }

    pub async fn continue_from(
        &self,
        context: AgentContext,
        control: LoopControl,
        cancellation: CancellationToken,
        events: EventEmitter,
    ) -> Result<RunResult, AgentError> {
        let Some(last) = context.messages.last() else {
            return Err(AgentError::EmptyHistory);
        };
        if last.is_assistant() {
            return Err(AgentError::ContinueFromAssistant);
        }
        events.emit(AgentEvent::AgentStart).await?;
        events.emit(AgentEvent::TurnStart { turn: 1 }).await?;
        self.run_inner(context, Vec::new(), control, cancellation, events).await
    }

    async fn run_inner(
        &self,
        mut context: AgentContext,
        mut new_messages: Vec<Message>,
        control: LoopControl,
        cancellation: CancellationToken,
        events: EventEmitter,
    ) -> Result<RunResult, AgentError> {
        let mut pending_messages = control.steering.drain();
        let mut has_more_tool_calls = true;
        let mut turns = 0_u32;
        let mut model_spec = self.config.model_spec.clone();
        let mut tools = self.config.tools.clone();

        loop {
            while has_more_tool_calls || !pending_messages.is_empty() {
                turns = turns.saturating_add(1);
                if turns > self.config.max_steps {
                    let error = AgentError::StepLimitExceeded(self.config.max_steps);
                    self.finish_with_failure(
                        &mut context,
                        &mut new_messages,
                        turns,
                        error.to_string(),
                        false,
                        &events,
                    )
                    .await?;
                    return Ok(RunResult {
                        new_messages,
                        context,
                        turns,
                    });
                }

                if turns > 1 {
                    events.emit(AgentEvent::TurnStart { turn: turns }).await?;
                }
                for message in pending_messages.drain(..) {
                    emit_message(&events, message.clone()).await?;
                    context.messages.push(message.clone());
                    new_messages.push(message);
                }

                if cancellation.is_cancelled() {
                    self.finish_with_failure(
                        &mut context,
                        &mut new_messages,
                        turns,
                        "Operation aborted".to_owned(),
                        true,
                        &events,
                    )
                    .await?;
                    return Ok(RunResult {
                        new_messages,
                        context,
                        turns,
                    });
                }

                let model_hook_cancellation = cancellation.child_token();
                let prepared_context = tokio::select! {
                    _ = cancellation.cancelled() => Err(AgentError::Hook("Operation aborted".to_owned())),
                    result = self.config.loop_hooks.prepare_model_context(context.clone(), model_hook_cancellation) => result,
                };
                let prepared_context = match prepared_context {
                    Ok(context) => context,
                    Err(error) => {
                        self.finish_with_failure(
                            &mut context,
                            &mut new_messages,
                            turns,
                            error.to_string(),
                            cancellation.is_cancelled(),
                            &events,
                        )
                        .await?;
                        return Ok(RunResult {
                            new_messages,
                            context,
                            turns,
                        });
                    }
                };
                let request = ModelRequest {
                    model: model_spec.clone(),
                    system_prompt: prepared_context.system_prompt,
                    messages: prepared_context.messages,
                    tools: tools.direct_definitions(),
                    session_id: self.config.session_id.clone(),
                    metadata: prepared_context.metadata,
                };

                let model_cancellation = cancellation.child_token();
                let generation = self
                    .config
                    .model
                    .generate(request, events.clone(), model_cancellation.clone());
                let generated = tokio::select! {
                    _ = cancellation.cancelled() => {
                        model_cancellation.cancel();
                        crate::ModelOutput::complete(AssistantMessage::failure("Operation aborted", true))
                    }
                    result = generation => match result {
                        Ok(output) => output,
                        Err(error) => crate::ModelOutput::complete(AssistantMessage::failure(error.message, cancellation.is_cancelled())),
                    }
                };
                let assistant = generated.message;
                let assistant_message = Message::Assistant(assistant.clone());
                if generated.message_started {
                    events
                        .emit(AgentEvent::MessageEnd {
                            message: assistant_message.clone(),
                        })
                        .await?;
                } else {
                    emit_message(&events, assistant_message.clone()).await?;
                }
                context.messages.push(assistant_message.clone());
                new_messages.push(assistant_message);

                if assistant.is_terminal_failure() {
                    events
                        .emit(AgentEvent::TurnEnd {
                            turn: turns,
                            message: assistant,
                            tool_results: Vec::new(),
                        })
                        .await?;
                    events
                        .emit(AgentEvent::AgentEnd {
                            messages: new_messages.clone(),
                        })
                        .await?;
                    return Ok(RunResult {
                        new_messages,
                        context,
                        turns,
                    });
                }

                let calls = assistant.tool_calls();
                let batch = self
                    .execute_tool_calls(
                        &context,
                        &tools,
                        &assistant,
                        calls,
                        cancellation.child_token(),
                        events.clone(),
                    )
                    .await?;
                has_more_tool_calls = !batch.messages.is_empty() && !batch.terminate;

                for result in &batch.messages {
                    let message = Message::ToolResult(result.clone());
                    emit_message(&events, message.clone()).await?;
                    context.messages.push(message.clone());
                    new_messages.push(message);
                }

                events
                    .emit(AgentEvent::TurnEnd {
                        turn: turns,
                        message: assistant.clone(),
                        tool_results: batch.messages.clone(),
                    })
                    .await?;

                let turn_context = LoopTurnContext {
                    message: assistant,
                    tool_results: batch.messages.clone(),
                    context: context.clone(),
                    new_messages: new_messages.clone(),
                };
                let prepare_cancellation = cancellation.child_token();
                let update = tokio::select! {
                    _ = cancellation.cancelled() => None,
                    result = self.config.loop_hooks.prepare_next_turn(turn_context.clone(), prepare_cancellation) => {
                        match result {
                            Ok(update) => update,
                            Err(error) => {
                                self.finish_with_failure(
                                    &mut context,
                                    &mut new_messages,
                                    turns,
                                    error.to_string(),
                                    false,
                                    &events,
                                ).await?;
                                return Ok(RunResult { new_messages, context, turns });
                            }
                        }
                    }
                };
                if let Some(update) = update {
                    if let Some(next_context) = update.context {
                        context = next_context;
                    }
                    if let Some(next_model) = update.model {
                        model_spec = next_model;
                    }
                    if let Some(next_tools) = update.tools {
                        tools = next_tools;
                    }
                }

                let stop_cancellation = cancellation.child_token();
                let should_stop = tokio::select! {
                    _ = cancellation.cancelled() => false,
                    result = self.config.loop_hooks.should_stop_after_turn(turn_context, stop_cancellation) => {
                        match result {
                            Ok(stop) => stop,
                            Err(error) => {
                                self.finish_with_failure(
                                    &mut context,
                                    &mut new_messages,
                                    turns,
                                    error.to_string(),
                                    false,
                                    &events,
                                ).await?;
                                return Ok(RunResult { new_messages, context, turns });
                            }
                        }
                    }
                };
                if should_stop {
                    events
                        .emit(AgentEvent::AgentEnd {
                            messages: new_messages.clone(),
                        })
                        .await?;
                    return Ok(RunResult {
                        new_messages,
                        context,
                        turns,
                    });
                }

                if cancellation.is_cancelled() {
                    has_more_tool_calls = false;
                }
                pending_messages = control.steering.drain();
            }

            let follow_up_messages = control.follow_up.drain();
            if follow_up_messages.is_empty() {
                break;
            }
            pending_messages = follow_up_messages;
            has_more_tool_calls = false;
        }

        events
            .emit(AgentEvent::AgentEnd {
                messages: new_messages.clone(),
            })
            .await?;
        Ok(RunResult {
            new_messages,
            context,
            turns,
        })
    }

    async fn finish_with_failure(
        &self,
        context: &mut AgentContext,
        new_messages: &mut Vec<Message>,
        turn: u32,
        reason: String,
        aborted: bool,
        events: &EventEmitter,
    ) -> Result<(), AgentError> {
        let assistant = AssistantMessage::failure(reason, aborted);
        let message = Message::Assistant(assistant.clone());
        emit_message(events, message.clone()).await?;
        context.messages.push(message.clone());
        new_messages.push(message);
        events
            .emit(AgentEvent::TurnEnd {
                turn,
                message: assistant,
                tool_results: Vec::new(),
            })
            .await?;
        events
            .emit(AgentEvent::AgentEnd {
                messages: new_messages.clone(),
            })
            .await
    }

    async fn execute_tool_calls(
        &self,
        context: &AgentContext,
        tools: &ToolRegistry,
        assistant: &AssistantMessage,
        calls: Vec<ToolCall>,
        cancellation: CancellationToken,
        events: EventEmitter,
    ) -> Result<ToolBatch, AgentError> {
        if calls.is_empty() {
            return Ok(ToolBatch::default());
        }

        let force_sequential = self.config.tool_execution == ToolExecutionMode::Sequential
            || calls.iter().any(|call| {
                tools
                    .get(&call.name)
                    .is_some_and(|tool| tool.definition().execution_mode == ToolExecutionMode::Sequential)
            });

        let outcomes = if force_sequential {
            let mut outcomes = Vec::with_capacity(calls.len());
            for call in calls {
                outcomes.push(
                    self.execute_tool_call(
                        context,
                        tools,
                        assistant.clone(),
                        call,
                        cancellation.child_token(),
                        events.clone(),
                    )
                    .await?,
                );
                if cancellation.is_cancelled() {
                    break;
                }
            }
            outcomes
        } else {
            join_all(calls.into_iter().map(|call| {
                self.execute_tool_call(
                    context,
                    tools,
                    assistant.clone(),
                    call,
                    cancellation.child_token(),
                    events.clone(),
                )
            }))
            .await
            .into_iter()
            .collect::<Result<Vec<_>, _>>()?
        };

        let terminate = !outcomes.is_empty() && outcomes.iter().all(|outcome| outcome.output.terminate);
        Ok(ToolBatch {
            messages: outcomes.into_iter().map(|outcome| outcome.message).collect(),
            terminate,
        })
    }

    async fn execute_tool_call(
        &self,
        context: &AgentContext,
        tools: &ToolRegistry,
        assistant: AssistantMessage,
        call: ToolCall,
        cancellation: CancellationToken,
        events: EventEmitter,
    ) -> Result<ToolOutcome, AgentError> {
        events.emit(AgentEvent::ToolCallObserved { call: call.clone() }).await?;
        events
            .emit(AgentEvent::ToolExecutionStart {
                tool_call_id: call.id.clone(),
                tool_name: call.name.clone(),
                args: call.arguments.clone(),
            })
            .await?;

        let Some(tool) = tools.get(&call.name) else {
            let message = format!("Tool {} not found", call.name);
            return self
                .finish_tool_failure(call, ToolFailure::new("tool_not_found", message), events)
                .await;
        };
        let definition = tool.definition();
        if let Err(error) = crate::validate_json_schema(&call.arguments, &definition.parameters, "arguments") {
            return self
                .finish_tool_failure(call, ToolFailure::new("invalid_arguments", error.to_string()), events)
                .await;
        }
        let before = BeforeToolCall {
            assistant_message: assistant.clone(),
            call: call.clone(),
            permission_request: tool.permission_request(&call.arguments),
            definition: definition.clone(),
            context: context.clone(),
        };
        let before_cancellation = cancellation.child_token();
        let before_result = tokio::select! {
            _ = cancellation.cancelled() => Err(ToolFailure::new("aborted", "Operation aborted")),
            result = self.config.hooks.before(before, before_cancellation) => result,
        };
        let before_result = match before_result {
            Ok(result) => result,
            Err(error) => return self.finish_tool_failure(call, error, events).await,
        };
        if cancellation.is_cancelled() {
            return self
                .finish_tool_failure(call, ToolFailure::new("aborted", "Operation aborted"), events)
                .await;
        }

        if let Some(mut cached) = before_result.cached_output {
            cached.success = true;
            return self.finish_tool(call, cached, false, None, events).await;
        }

        let mut tool_context = context.clone();
        if let (Some(target), Some(extra)) = (
            tool_context.metadata.as_object_mut(),
            before_result.metadata.as_object(),
        ) {
            target.extend(extra.clone());
        }

        let tool_cancellation = cancellation.child_token();
        let execution = tool.execute(
            &call,
            ToolCallContext {
                cancellation: tool_cancellation.clone(),
                events: events.clone(),
                session_id: self.config.session_id.clone(),
                metadata: tool_context.metadata.clone(),
            },
        );
        let executed = match tool.timeout() {
            Some(limit) => tokio::select! {
                _ = cancellation.cancelled() => {
                    tool_cancellation.cancel();
                    Err(ToolFailure::new("aborted", "Operation aborted"))
                }
                result = timeout(limit, execution) => match result {
                    Ok(result) => result,
                    Err(_) => {
                        tool_cancellation.cancel();
                        Err(ToolFailure::new(
                            "timeout",
                            format!("Tool timed out after {} ms", limit.as_millis()),
                        ))
                    }
                }
            },
            None => tokio::select! {
                _ = cancellation.cancelled() => {
                    tool_cancellation.cancel();
                    Err(ToolFailure::new("aborted", "Operation aborted"))
                }
                result = execution => result,
            },
        };

        let (mut output, mut is_error, mut tool_error) = match executed {
            Ok(output) => (output, false, None),
            Err(failure) => {
                let mut output = ToolOutput::text(failure.message);
                output.success = false;
                output.details = failure.details.clone();
                if !failure.details.is_null() && failure.details.as_object().is_none_or(|value| !value.is_empty()) {
                    output.structured_content = Some(failure.details);
                }
                (output, true, Some(failure.info))
            }
        };
        if !is_error && let Some(schema) = &definition.output_schema {
            let validation_error = match &output.structured_content {
                Some(structured) => crate::validate_json_schema(structured, schema, "output")
                    .err()
                    .map(|error| error.to_string()),
                None => Some(format!(
                    "Tool {} declares output_schema but returned no structuredContent",
                    definition.name
                )),
            };
            if let Some(message) = validation_error {
                is_error = true;
                tool_error = Some(crate::ToolErrorInfo {
                    code: "invalid_tool_output".to_owned(),
                    message: message.clone(),
                    retryable: false,
                });
                output = ToolOutput::text(message);
            }
        }
        output.success = !is_error;
        let after = AfterToolCall {
            assistant_message: assistant,
            call: call.clone(),
            output,
            is_error,
            error: tool_error,
            context: tool_context,
        };
        let after_cancellation = cancellation.child_token();
        let after_result = tokio::select! {
            _ = cancellation.cancelled() => Err(ToolFailure::new("aborted", "Operation aborted")),
            result = self.config.hooks.after(after, after_cancellation) => result,
        };
        let mut finalized = match after_result {
            Ok(result) => result,
            Err(error) => return self.finish_tool_failure(call, error, events).await,
        };
        finalized.output.success = !finalized.is_error;
        self.finish_tool(call, finalized.output, finalized.is_error, finalized.error, events)
            .await
    }

    async fn finish_tool_failure(
        &self,
        call: ToolCall,
        failure: ToolFailure,
        events: EventEmitter,
    ) -> Result<ToolOutcome, AgentError> {
        let mut output = ToolOutput::text(failure.message);
        output.success = false;
        output.details = failure.details.clone();
        if !failure.details.is_null() && failure.details.as_object().is_none_or(|value| !value.is_empty()) {
            output.structured_content = Some(failure.details);
        }
        self.finish_tool(call, output, true, Some(failure.info), events).await
    }

    async fn finish_tool(
        &self,
        call: ToolCall,
        output: ToolOutput,
        is_error: bool,
        error: Option<ToolErrorInfo>,
        events: EventEmitter,
    ) -> Result<ToolOutcome, AgentError> {
        events
            .emit(AgentEvent::ToolExecutionEnd {
                tool_call_id: call.id.clone(),
                tool_name: call.name.clone(),
                result: output.clone(),
                is_error,
                error: error.clone(),
            })
            .await?;
        let message = ToolResultMessage {
            tool_call_id: call.id,
            tool_name: call.name,
            content: output.content.clone(),
            details: output.details.clone(),
            structured_content: output.structured_content.clone(),
            success: !is_error,
            external_context: output.external_context.clone(),
            is_error,
            error,
            timestamp: now_ms(),
            extra: serde_json::Map::new(),
        };
        Ok(ToolOutcome { output, message })
    }
}

#[derive(Default)]
struct ToolBatch {
    messages: Vec<ToolResultMessage>,
    terminate: bool,
}

struct ToolOutcome {
    output: ToolOutput,
    message: ToolResultMessage,
}

async fn emit_message(events: &EventEmitter, message: Message) -> Result<(), AgentError> {
    events
        .emit(AgentEvent::MessageStart {
            message: message.clone(),
        })
        .await?;
    events.emit(AgentEvent::MessageEnd { message }).await
}

#[allow(dead_code)]
fn _text_blocks(value: &str) -> Vec<ContentBlock> {
    vec![ContentBlock::Text { text: value.to_owned() }]
}
