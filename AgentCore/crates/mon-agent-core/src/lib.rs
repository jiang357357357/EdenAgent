//! Native agent runtime primitives for Mon.

mod agent;
mod cache;
mod compaction;
mod context;
mod engine;
mod error;
mod event;
mod hooks;
mod message;
mod model;
mod multi_agent;
mod queue;
mod token_counting;
mod tool;
mod validation;

pub use agent::{Agent, AgentOptions, AgentRun, AgentState};
pub use cache::{PROMPT_FINGERPRINT_VERSION, advance_prompt_prefix, prompt_prefix_state};
pub use compaction::{
    build_compaction_summary_request, build_session_context, finalize_compaction, prepare_compaction,
    serialize_conversation, should_compact,
};
pub use context::{
    CONTEXT_TOOL_RESULT_TAIL_CHARS, MAX_CONTEXT_STRUCTURED_CHARS, MAX_CONTEXT_TEXT_CHARS,
    MAX_CONTEXT_TOOL_RESULT_CHARS, sanitize_model_history,
};
pub use engine::{AgentContext, AgentLoop, AgentLoopConfig, LoopControl, RunResult};
pub use error::AgentError;
pub use event::{AgentEvent, EventEmitter, event_channel};
pub use hooks::{LoopHooks, LoopTurnContext, LoopTurnUpdate, NoopLoopHooks};
pub use message::{
    AssistantMessage, ContentBlock, Message, ToolCall, ToolErrorInfo, ToolResultMessage, UserContent, now_ms,
};
pub use model::{ModelAdapter, ModelError, ModelOutput, ModelRequest, ModelSpec};
pub use mon_agent_domain::{
    AgentId, BlobId, ItemId, OperationId, PermissionRequestId, QuestionRequestId, SessionId, ToolCallId, TurnId,
};
pub use multi_agent::{AgentResult, AgentSnapshot, AgentStatus, InterAgentMessage, MultiAgentControl};
pub use queue::{PendingMessageQueue, QueueMode};
pub use token_counting::{
    ContextTokenEstimate, PromptTokenBreakdown, count_json_tokens, count_text_tokens, estimate_context_tokens,
    estimate_message_tokens, estimate_prompt_token_breakdown, tokenizer_name,
};
pub use tool::{
    AfterToolCall, AfterToolCallResult, BeforeToolCall, BeforeToolCallResult, DynamicToolSource, NoopToolHooks,
    PermissionRequest, Tool, ToolCallContext, ToolDefinition, ToolExecutionMode, ToolExposure, ToolFailure, ToolHooks,
    ToolOutput, ToolRegistry, empty_tool_parameters_schema,
};
pub use validation::{
    ValidationError, validate_json_schema, validate_tool_definitions, validate_tool_parameters_schema,
};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
