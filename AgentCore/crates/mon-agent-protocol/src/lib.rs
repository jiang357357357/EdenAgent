//! Versioned wire contract between Mon Server and the native agent runtime.

use mon_agent_core::{
    AgentContext, AgentEvent, AssistantMessage, ContextTokenEstimate, Message, ModelSpec, QueueMode, ToolCall,
    ToolDefinition, ToolExecutionMode, ToolOutput,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    pub model: ModelSpec,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub messages: Vec<Message>,
    #[serde(default)]
    pub tools: Vec<ToolDefinition>,
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub native_tools: Vec<String>,
    #[serde(default)]
    pub metadata: Value,
    #[serde(default = "default_max_steps")]
    pub max_steps: u32,
    #[serde(default)]
    pub tool_execution: ToolExecutionMode,
    #[serde(default)]
    pub callbacks: CallbackConfig,
    #[serde(default)]
    pub steering_mode: QueueMode,
    #[serde(default)]
    pub follow_up_mode: QueueMode,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CallbackConfig {
    #[serde(default)]
    pub prepare_model_context: bool,
    #[serde(default)]
    pub prepare_next_turn: bool,
    #[serde(default)]
    pub should_stop_after_turn: bool,
    #[serde(default)]
    pub before_tool_call: bool,
    #[serde(default)]
    pub after_tool_call: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HookKind {
    PrepareModelContext,
    PrepareNextTurn,
    ShouldStopAfterTurn,
    BeforeToolCall,
    AfterToolCall,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationError {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum Request {
    #[serde(rename = "runtime.initialize")]
    Initialize {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "serverVersion")]
        server_version: String,
    },
    #[serde(rename = "runtime.ping")]
    Ping {
        #[serde(rename = "requestID")]
        request_id: String,
    },
    #[serde(rename = "context.estimate")]
    ContextEstimate {
        #[serde(rename = "requestID")]
        request_id: String,
        messages: Vec<Message>,
        #[serde(rename = "modelID", default)]
        model_id: Option<String>,
    },
    #[serde(rename = "compaction.prepare")]
    CompactionPrepare {
        #[serde(rename = "requestID")]
        request_id: String,
        entries: Vec<Value>,
        #[serde(default)]
        settings: Value,
        #[serde(rename = "modelID", default)]
        model_id: Option<String>,
    },
    #[serde(rename = "compaction.buildSummaryRequest")]
    CompactionBuildSummaryRequest {
        #[serde(rename = "requestID")]
        request_id: String,
        preparation: Value,
        #[serde(default)]
        model: Value,
        #[serde(rename = "cacheContext", default)]
        cache_context: Option<Value>,
        #[serde(rename = "customInstructions", default)]
        custom_instructions: Option<String>,
        #[serde(rename = "thinkingLevel", default)]
        thinking_level: Option<String>,
    },
    #[serde(rename = "compaction.finalize")]
    CompactionFinalize {
        #[serde(rename = "requestID")]
        request_id: String,
        preparation: Value,
        response: Value,
    },
    #[serde(rename = "session.context")]
    SessionContext {
        #[serde(rename = "requestID")]
        request_id: String,
        entries: Vec<Value>,
    },
    #[serde(rename = "skills.load")]
    SkillsLoad {
        #[serde(rename = "requestID")]
        request_id: String,
        directories: Vec<String>,
    },
    #[serde(rename = "agent.control")]
    AgentControl {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "rootSessionID")]
        root_session_id: String,
        action: String,
        #[serde(default)]
        payload: Value,
    },
    #[serde(rename = "runtime.shutdown")]
    Shutdown {
        #[serde(rename = "requestID")]
        request_id: String,
    },
    #[serde(rename = "session.create")]
    SessionCreate {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
        config: SessionConfig,
    },
    #[serde(rename = "session.close")]
    SessionClose {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    #[serde(rename = "turn.start")]
    TurnStart {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
        prompts: Vec<Message>,
    },
    #[serde(rename = "turn.cancel")]
    TurnCancel {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    #[serde(rename = "turn.steer")]
    TurnSteer {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
        message: Message,
    },
    #[serde(rename = "turn.followUp")]
    TurnFollowUp {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
        message: Message,
    },
    #[serde(rename = "model.update")]
    ModelUpdate {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "operationID")]
        operation_id: String,
        message: AssistantMessage,
        #[serde(default)]
        delta: String,
        #[serde(default)]
        event: Option<Value>,
    },
    #[serde(rename = "model.result")]
    ModelResult {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "operationID")]
        operation_id: String,
        #[serde(default)]
        message: Option<AssistantMessage>,
        #[serde(default)]
        error: Option<OperationError>,
    },
    #[serde(rename = "tool.update")]
    ToolUpdate {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "operationID")]
        operation_id: String,
        result: ToolOutput,
    },
    #[serde(rename = "tool.result")]
    ToolResult {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "operationID")]
        operation_id: String,
        #[serde(default)]
        result: Option<ToolOutput>,
        #[serde(default)]
        error: Option<OperationError>,
    },
    #[serde(rename = "hook.result")]
    HookResult {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "operationID")]
        operation_id: String,
        #[serde(default)]
        result: Value,
        #[serde(default)]
        error: Option<OperationError>,
    },
}

impl Request {
    pub fn request_id(&self) -> &str {
        match self {
            Self::Initialize { request_id, .. }
            | Self::Ping { request_id }
            | Self::ContextEstimate { request_id, .. }
            | Self::CompactionPrepare { request_id, .. }
            | Self::CompactionBuildSummaryRequest { request_id, .. }
            | Self::CompactionFinalize { request_id, .. }
            | Self::SessionContext { request_id, .. }
            | Self::SkillsLoad { request_id, .. }
            | Self::AgentControl { request_id, .. }
            | Self::Shutdown { request_id }
            | Self::SessionCreate { request_id, .. }
            | Self::SessionClose { request_id, .. }
            | Self::TurnStart { request_id, .. }
            | Self::TurnCancel { request_id, .. }
            | Self::TurnSteer { request_id, .. }
            | Self::TurnFollowUp { request_id, .. }
            | Self::ModelUpdate { request_id, .. }
            | Self::ModelResult { request_id, .. }
            | Self::ToolUpdate { request_id, .. }
            | Self::ToolResult { request_id, .. }
            | Self::HookResult { request_id, .. } => request_id,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum Response {
    #[serde(rename = "runtime.initialized")]
    Initialized {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "runtimeVersion")]
        runtime_version: String,
        capabilities: Vec<String>,
    },
    #[serde(rename = "runtime.pong")]
    Pong {
        #[serde(rename = "requestID")]
        request_id: String,
    },
    #[serde(rename = "context.estimated")]
    ContextEstimated {
        #[serde(rename = "requestID")]
        request_id: String,
        estimate: ContextTokenEstimate,
    },
    #[serde(rename = "compaction.prepared")]
    CompactionPrepared {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        preparation: Option<Value>,
    },
    #[serde(rename = "compaction.summaryRequestBuilt")]
    CompactionSummaryRequestBuilt {
        #[serde(rename = "requestID")]
        request_id: String,
        request: Value,
    },
    #[serde(rename = "compaction.finalized")]
    CompactionFinalized {
        #[serde(rename = "requestID")]
        request_id: String,
        compaction: Value,
    },
    #[serde(rename = "session.contextBuilt")]
    SessionContextBuilt {
        #[serde(rename = "requestID")]
        request_id: String,
        context: Value,
    },
    #[serde(rename = "skills.loaded")]
    SkillsLoaded {
        #[serde(rename = "requestID")]
        request_id: String,
        result: Value,
    },
    #[serde(rename = "agent.controlled")]
    AgentControlled {
        #[serde(rename = "requestID")]
        request_id: String,
        result: Value,
    },
    #[serde(rename = "runtime.shutdownComplete")]
    ShutdownComplete {
        #[serde(rename = "requestID")]
        request_id: String,
    },
    #[serde(rename = "runtime.accepted")]
    Accepted {
        #[serde(rename = "requestID")]
        request_id: String,
    },
    #[serde(rename = "session.created")]
    SessionCreated {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    #[serde(rename = "session.closed")]
    SessionClosed {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    #[serde(rename = "turn.started")]
    TurnStarted {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    #[serde(rename = "turn.cancelled")]
    TurnCancelled {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    #[serde(rename = "turn.event")]
    TurnEvent {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
        event: AgentEvent,
    },
    #[serde(rename = "turn.completed")]
    TurnCompleted {
        #[serde(rename = "requestID")]
        request_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
        #[serde(rename = "newMessages")]
        new_messages: Vec<Message>,
        context: AgentContext,
        turns: u32,
    },
    #[serde(rename = "model.call")]
    ModelCall {
        #[serde(rename = "operationID")]
        operation_id: String,
        #[serde(rename = "sessionID", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        model: ModelSpec,
        #[serde(rename = "systemPrompt")]
        system_prompt: String,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
        metadata: Value,
    },
    #[serde(rename = "tool.call")]
    ToolCall {
        #[serde(rename = "operationID")]
        operation_id: String,
        #[serde(rename = "sessionID", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        call: ToolCall,
    },
    #[serde(rename = "hook.call")]
    HookCall {
        #[serde(rename = "operationID")]
        operation_id: String,
        #[serde(rename = "sessionID")]
        session_id: String,
        hook: HookKind,
        payload: Value,
    },
    #[serde(rename = "runtime.error")]
    Error {
        #[serde(rename = "requestID", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<Value>,
    },
}

impl Response {
    pub fn error(request_id: Option<String>, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Error {
            request_id,
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }
}

fn default_max_steps() -> u32 {
    128
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_round_trip_uses_compatibility_field_names() {
        let input = r#"{"type":"runtime.initialize","requestID":"req_1","protocolVersion":1,"serverVersion":"dev"}"#;
        let request: Request = serde_json::from_str(input).expect("request should decode");
        assert_eq!(request.request_id(), "req_1");

        let response = Response::Initialized {
            request_id: request.request_id().to_owned(),
            protocol_version: PROTOCOL_VERSION,
            runtime_version: "0.1.0".to_owned(),
            capabilities: vec!["agent.turn".to_owned()],
        };
        let encoded = serde_json::to_value(response).expect("response should encode");
        assert_eq!(encoded["type"], "runtime.initialized");
        assert_eq!(encoded["requestID"], "req_1");
        assert_eq!(encoded["protocolVersion"], 1);
    }

    #[test]
    fn turn_request_decodes_python_compatible_messages() {
        let request: Request = serde_json::from_str(
            r#"{"type":"turn.start","requestID":"req_2","sessionID":"s1","prompts":[{"role":"user","content":"hello","timestamp":1}]}"#,
        )
        .expect("turn should decode");
        let Request::TurnStart { prompts, .. } = request else {
            panic!("wrong request variant");
        };
        assert_eq!(prompts.len(), 1);
    }

    #[test]
    fn callback_error_is_camel_case() {
        let request: Request = serde_json::from_str(
            r#"{"type":"model.result","requestID":"req_3","operationID":"op_1","error":{"code":"bad_gateway","message":"failed","retryable":true}}"#,
        )
        .expect("result should decode");
        assert_eq!(request.request_id(), "req_3");
    }
}
