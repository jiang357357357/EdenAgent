use async_trait::async_trait;
use mon_agent_core::{
    AfterToolCall, AfterToolCallResult, AgentContext, AgentError, AgentEvent, AssistantMessage, BeforeToolCall,
    EventEmitter, LoopHooks, LoopTurnContext, LoopTurnUpdate, Message, ModelAdapter, ModelError, ModelOutput,
    ModelRequest, ModelSpec, Tool, ToolCall, ToolCallContext, ToolDefinition, ToolErrorInfo, ToolFailure, ToolHooks,
    ToolOutput, ToolRegistry,
};
use mon_agent_protocol::{CallbackConfig, HookKind, OperationError, Response};
use mon_agent_tools::{NativeToolConfig, create_native_tool};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

enum ModelSignal {
    Update {
        message: AssistantMessage,
        delta: String,
        event: Option<Value>,
    },
    Complete(Result<AssistantMessage, OperationError>),
}

enum ToolSignal {
    Update(ToolOutput),
    Complete(Result<ToolOutput, OperationError>),
}

enum HookSignal {
    Complete(Result<Value, OperationError>),
}

#[derive(Clone)]
pub struct CallbackBridge {
    outgoing: mpsc::Sender<Response>,
    sequence: Arc<AtomicU64>,
    models: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<ModelSignal>>>>,
    tools: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<ToolSignal>>>>,
    hooks: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<HookSignal>>>>,
}

impl CallbackBridge {
    pub fn new(outgoing: mpsc::Sender<Response>) -> Self {
        Self {
            outgoing,
            sequence: Arc::new(AtomicU64::new(1)),
            models: Arc::new(Mutex::new(HashMap::new())),
            tools: Arc::new(Mutex::new(HashMap::new())),
            hooks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn operation_id(&self, kind: &str) -> String {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        format!("{kind}_{}_{sequence}", std::process::id())
    }

    pub fn model_update(
        &self,
        operation_id: &str,
        message: AssistantMessage,
        delta: String,
        event: Option<Value>,
    ) -> bool {
        self.models
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(operation_id)
            .is_some_and(|sender| sender.send(ModelSignal::Update { message, delta, event }).is_ok())
    }

    pub fn model_result(&self, operation_id: &str, result: Result<AssistantMessage, OperationError>) -> bool {
        self.models
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(operation_id)
            .is_some_and(|sender| sender.send(ModelSignal::Complete(result)).is_ok())
    }

    pub fn tool_update(&self, operation_id: &str, result: ToolOutput) -> bool {
        self.tools
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(operation_id)
            .is_some_and(|sender| sender.send(ToolSignal::Update(result)).is_ok())
    }

    pub fn tool_result(&self, operation_id: &str, result: Result<ToolOutput, OperationError>) -> bool {
        self.tools
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(operation_id)
            .is_some_and(|sender| sender.send(ToolSignal::Complete(result)).is_ok())
    }

    pub fn hook_result(&self, operation_id: &str, result: Result<Value, OperationError>) -> bool {
        self.hooks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(operation_id)
            .is_some_and(|sender| sender.send(HookSignal::Complete(result)).is_ok())
    }

    fn remove_model(&self, operation_id: &str) {
        self.models
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(operation_id);
    }

    fn remove_tool(&self, operation_id: &str) {
        self.tools
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(operation_id);
    }

    async fn call_hook(
        &self,
        session_id: &str,
        hook: HookKind,
        payload: Value,
        cancellation: CancellationToken,
    ) -> Result<Value, OperationError> {
        let operation_id = self.operation_id("hook");
        let (sender, mut receiver) = mpsc::unbounded_channel();
        self.hooks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(operation_id.clone(), sender);
        if self
            .outgoing
            .send(Response::HookCall {
                operation_id: operation_id.clone(),
                session_id: session_id.to_owned(),
                hook,
                payload,
            })
            .await
            .is_err()
        {
            self.hooks
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&operation_id);
            return Err(OperationError {
                code: "runtime_disconnected".to_owned(),
                message: "Server callback channel closed".to_owned(),
                retryable: false,
            });
        }
        tokio::select! {
            _ = cancellation.cancelled() => {
                self.hooks.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&operation_id);
                Err(OperationError {
                    code: "aborted".to_owned(),
                    message: "Operation aborted".to_owned(),
                    retryable: false,
                })
            }
            signal = receiver.recv() => match signal {
                Some(HookSignal::Complete(result)) => result,
                None => Err(OperationError {
                    code: "callback_closed".to_owned(),
                    message: "Hook callback closed without a result".to_owned(),
                    retryable: false,
                }),
            }
        }
    }
}

#[derive(Clone)]
pub struct RemoteLoopHooks {
    session_id: String,
    callbacks: CallbackConfig,
    bridge: CallbackBridge,
    native_config: Option<NativeToolConfig>,
    native_names: Arc<HashSet<String>>,
}

impl RemoteLoopHooks {
    pub fn new(
        session_id: String,
        callbacks: CallbackConfig,
        bridge: CallbackBridge,
        native_config: Option<NativeToolConfig>,
        native_names: Arc<HashSet<String>>,
    ) -> Self {
        Self {
            session_id,
            callbacks,
            bridge,
            native_config,
            native_names,
        }
    }

    fn remote_tools(&self, definitions: Vec<ToolDefinition>) -> ToolRegistry {
        tool_registry(
            definitions,
            &self.session_id,
            &self.bridge,
            self.native_config.clone(),
            self.native_names.clone(),
        )
    }
}

pub fn tool_registry(
    definitions: Vec<ToolDefinition>,
    session_id: &str,
    bridge: &CallbackBridge,
    native_config: Option<NativeToolConfig>,
    native_names: Arc<HashSet<String>>,
) -> ToolRegistry {
    let mut tools = ToolRegistry::new();
    for definition in definitions {
        if native_names.contains(&definition.name)
            && let Some(config) = native_config.clone()
            && let Some(tool) = create_native_tool(definition.clone(), config)
        {
            tools.register(tool);
            continue;
        }
        tools.register(Arc::new(RemoteTool::new(
            definition,
            session_id.to_owned(),
            bridge.clone(),
        )));
    }
    tools
}

#[async_trait]
impl LoopHooks for RemoteLoopHooks {
    async fn prepare_model_context(
        &self,
        context: AgentContext,
        cancellation: CancellationToken,
    ) -> Result<AgentContext, AgentError> {
        if !self.callbacks.prepare_model_context {
            return Ok(context);
        }
        let value = self
            .bridge
            .call_hook(
                &self.session_id,
                HookKind::PrepareModelContext,
                serde_json::to_value(&context).map_err(|error| AgentError::Hook(error.to_string()))?,
                cancellation,
            )
            .await
            .map_err(|error| AgentError::Hook(error.message))?;
        serde_json::from_value(value).map_err(|error| AgentError::Hook(error.to_string()))
    }

    async fn prepare_next_turn(
        &self,
        turn: LoopTurnContext,
        cancellation: CancellationToken,
    ) -> Result<Option<LoopTurnUpdate>, AgentError> {
        if !self.callbacks.prepare_next_turn {
            return Ok(None);
        }
        let payload = turn_payload(&turn)?;
        let value = self
            .bridge
            .call_hook(&self.session_id, HookKind::PrepareNextTurn, payload, cancellation)
            .await
            .map_err(|error| AgentError::Hook(error.message))?;
        if value.is_null() {
            return Ok(None);
        }
        let context = value
            .get("context")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| AgentError::Hook(error.to_string()))?;
        let model = value
            .get("model")
            .cloned()
            .map(serde_json::from_value::<ModelSpec>)
            .transpose()
            .map_err(|error| AgentError::Hook(error.to_string()))?;
        let tools = value
            .get("tools")
            .cloned()
            .map(serde_json::from_value::<Vec<ToolDefinition>>)
            .transpose()
            .map_err(|error| AgentError::Hook(error.to_string()))?
            .map(|definitions| self.remote_tools(definitions));
        Ok(Some(LoopTurnUpdate { context, model, tools }))
    }

    async fn should_stop_after_turn(
        &self,
        turn: LoopTurnContext,
        cancellation: CancellationToken,
    ) -> Result<bool, AgentError> {
        if !self.callbacks.should_stop_after_turn {
            return Ok(false);
        }
        let value = self
            .bridge
            .call_hook(
                &self.session_id,
                HookKind::ShouldStopAfterTurn,
                turn_payload(&turn)?,
                cancellation,
            )
            .await
            .map_err(|error| AgentError::Hook(error.message))?;
        value
            .as_bool()
            .or_else(|| value.get("stop").and_then(Value::as_bool))
            .ok_or_else(|| AgentError::Hook("shouldStopAfterTurn must return a boolean".to_owned()))
    }
}

#[async_trait]
impl ToolHooks for RemoteLoopHooks {
    async fn before(&self, context: BeforeToolCall, cancellation: CancellationToken) -> Result<(), ToolFailure> {
        if !self.callbacks.before_tool_call {
            return Ok(());
        }
        let assistant = serde_json::to_value(Message::Assistant(context.assistant_message))
            .map_err(|error| ToolFailure::new("serialization_error", error.to_string()))?;
        let value = self
            .bridge
            .call_hook(
                &self.session_id,
                HookKind::BeforeToolCall,
                json!({
                    "assistantMessage": assistant,
                    "toolCall": context.call,
                    "args": context.call.arguments,
                    "context": context.context,
                    "tool": context.definition,
                    "permissionRequest": context.permission_request,
                }),
                cancellation,
            )
            .await
            .map_err(|error| ToolFailure::new(error.code, error.message))?;
        if value.get("block").and_then(Value::as_bool).unwrap_or(false) {
            return Err(ToolFailure::new(
                "blocked",
                value
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("Tool execution was blocked"),
            ));
        }
        Ok(())
    }

    async fn after(
        &self,
        context: AfterToolCall,
        cancellation: CancellationToken,
    ) -> Result<AfterToolCallResult, ToolFailure> {
        if !self.callbacks.after_tool_call {
            return Ok(AfterToolCallResult {
                output: context.output,
                is_error: context.is_error,
                error: None,
            });
        }
        let original_output = context.output.clone();
        let original_is_error = context.is_error;
        let assistant = serde_json::to_value(Message::Assistant(context.assistant_message))
            .map_err(|error| ToolFailure::new("serialization_error", error.to_string()))?;
        let value = self
            .bridge
            .call_hook(
                &self.session_id,
                HookKind::AfterToolCall,
                json!({
                    "assistantMessage": assistant,
                    "toolCall": context.call,
                    "args": context.call.arguments,
                    "result": context.output,
                    "isError": context.is_error,
                    "context": context.context,
                }),
                cancellation,
            )
            .await
            .map_err(|error| ToolFailure::new(error.code, error.message))?;
        if value.is_null() {
            return Ok(AfterToolCallResult {
                output: original_output,
                is_error: original_is_error,
                error: None,
            });
        }
        let mut merged = serde_json::to_value(original_output)
            .map_err(|error| ToolFailure::new("serialization_error", error.to_string()))?;
        let Some(update) = value.as_object() else {
            return Err(ToolFailure::new(
                "invalid_hook_result",
                "afterToolCall must return an object or null",
            ));
        };
        let Some(merged_object) = merged.as_object_mut() else {
            return Err(ToolFailure::new(
                "serialization_error",
                "tool output did not serialize as an object",
            ));
        };
        for key in [
            "content",
            "details",
            "structuredContent",
            "externalContext",
            "terminate",
            "success",
        ] {
            if let Some(field) = update.get(key) {
                merged_object.insert(key.to_owned(), field.clone());
            }
        }
        let output = serde_json::from_value(merged)
            .map_err(|error| ToolFailure::new("invalid_hook_result", error.to_string()))?;
        let is_error = update
            .get("isError")
            .and_then(Value::as_bool)
            .unwrap_or(original_is_error);
        let error = update
            .get("error")
            .cloned()
            .map(serde_json::from_value::<ToolErrorInfo>)
            .transpose()
            .map_err(|error| ToolFailure::new("invalid_hook_result", error.to_string()))?;
        Ok(AfterToolCallResult {
            output,
            is_error,
            error,
        })
    }
}

fn turn_payload(turn: &LoopTurnContext) -> Result<Value, AgentError> {
    let message = serde_json::to_value(Message::Assistant(turn.message.clone()))
        .map_err(|error| AgentError::Hook(error.to_string()))?;
    Ok(json!({
        "message": message,
        "toolResults": turn.tool_results,
        "context": turn.context,
        "newMessages": turn.new_messages,
    }))
}

#[derive(Clone)]
pub struct RemoteModel {
    bridge: CallbackBridge,
}

impl RemoteModel {
    pub fn new(bridge: CallbackBridge) -> Self {
        Self { bridge }
    }
}

#[async_trait]
impl ModelAdapter for RemoteModel {
    async fn generate(
        &self,
        request: ModelRequest,
        events: EventEmitter,
        cancellation: CancellationToken,
    ) -> Result<ModelOutput, ModelError> {
        let operation_id = self.bridge.operation_id("model");
        let (sender, mut receiver) = mpsc::unbounded_channel();
        self.bridge
            .models
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(operation_id.clone(), sender);

        let frame = Response::ModelCall {
            operation_id: operation_id.clone(),
            session_id: request.session_id,
            model: request.model,
            system_prompt: request.system_prompt,
            messages: request.messages,
            tools: request.tools,
            metadata: request.metadata,
        };
        if self.bridge.outgoing.send(frame).await.is_err() {
            self.bridge.remove_model(&operation_id);
            return Err(ModelError::new(
                "runtime_disconnected",
                "Server callback channel closed",
            ));
        }

        let mut message_started = false;
        loop {
            tokio::select! {
                _ = cancellation.cancelled() => {
                    self.bridge.remove_model(&operation_id);
                    return Err(ModelError::new("aborted", "Operation aborted"));
                }
                signal = receiver.recv() => match signal {
                    Some(ModelSignal::Update { message, delta, event }) => {
                        if event.as_ref().and_then(|value| value.get("type")).and_then(Value::as_str) == Some("provider_retry") {
                            let retry = event.as_ref().expect("retry event exists");
                            events.emit(AgentEvent::ModelRetry {
                                attempt: retry.get("attempt").and_then(Value::as_u64).unwrap_or(1) as u32,
                                max_attempts: retry.get("maxAttempts").and_then(Value::as_u64).unwrap_or(1) as u32,
                                delay_ms: retry.get("delayMs").and_then(Value::as_u64).unwrap_or(0),
                                reason: retry.get("reason").and_then(Value::as_str).unwrap_or_default().to_owned(),
                                status_code: retry.get("statusCode").and_then(Value::as_u64).and_then(|value| u16::try_from(value).ok()),
                            }).await.map_err(|error| ModelError::new("event_disconnected", error.to_string()))?;
                            continue;
                        }
                        if !message_started {
                            events.emit(AgentEvent::MessageStart {
                                message: Message::Assistant(message.clone()),
                            }).await.map_err(|error| ModelError::new("event_disconnected", error.to_string()))?;
                            message_started = true;
                        }
                        if event.as_ref().and_then(|value| value.get("type")).and_then(Value::as_str) == Some("start") {
                            continue;
                        }
                        events.emit(AgentEvent::MessageUpdate {
                            message,
                            delta,
                            assistant_message_event: event,
                        }).await
                            .map_err(|error| ModelError::new("event_disconnected", error.to_string()))?;
                    }
                    Some(ModelSignal::Complete(Ok(message))) => return Ok(ModelOutput { message, message_started }),
                    Some(ModelSignal::Complete(Err(error))) => {
                        return Err(ModelError {
                            code: error.code,
                            message: error.message,
                            retryable: error.retryable,
                        });
                    }
                    None => return Err(ModelError::new("callback_closed", "Model callback closed without a result")),
                }
            }
        }
    }
}

pub struct RemoteTool {
    definition: ToolDefinition,
    session_id: String,
    bridge: CallbackBridge,
}

impl RemoteTool {
    pub fn new(definition: ToolDefinition, session_id: String, bridge: CallbackBridge) -> Self {
        Self {
            definition,
            session_id,
            bridge,
        }
    }
}

#[async_trait]
impl Tool for RemoteTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        let operation_id = self.bridge.operation_id("tool");
        let (sender, mut receiver) = mpsc::unbounded_channel();
        self.bridge
            .tools
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(operation_id.clone(), sender);

        let frame = Response::ToolCall {
            operation_id: operation_id.clone(),
            session_id: Some(self.session_id.clone()),
            call: call.clone(),
        };
        if self.bridge.outgoing.send(frame).await.is_err() {
            self.bridge.remove_tool(&operation_id);
            return Err(ToolFailure::new(
                "runtime_disconnected",
                "Server callback channel closed",
            ));
        }

        loop {
            tokio::select! {
                _ = context.cancellation.cancelled() => {
                    self.bridge.remove_tool(&operation_id);
                    return Err(ToolFailure::new("aborted", "Operation aborted"));
                }
                signal = receiver.recv() => match signal {
                    Some(ToolSignal::Update(result)) => {
                        context.events.emit(AgentEvent::ToolExecutionUpdate {
                            tool_call_id: call.id.clone(),
                            tool_name: call.name.clone(),
                            partial_result: result,
                        }).await.map_err(|error| ToolFailure::new("event_disconnected", error.to_string()))?;
                    }
                    Some(ToolSignal::Complete(Ok(result))) => return Ok(result),
                    Some(ToolSignal::Complete(Err(error))) => {
                        return Err(ToolFailure::new(error.code, error.message));
                    }
                    None => return Err(ToolFailure::new("callback_closed", "Tool callback closed without a result")),
                }
            }
        }
    }
}
