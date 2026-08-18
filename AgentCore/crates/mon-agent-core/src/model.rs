use crate::{AssistantMessage, EventEmitter, Message, ToolDefinition};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Map;
use serde_json::Value;
use thiserror::Error;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: String,
    pub provider: String,
    #[serde(default)]
    pub api: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug)]
pub struct ModelRequest {
    pub model: ModelSpec,
    pub system_prompt: String,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolDefinition>,
    pub session_id: Option<String>,
    pub metadata: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModelOutput {
    pub message: AssistantMessage,
    /// True when the adapter already emitted `message_start` while streaming.
    pub message_started: bool,
}

impl ModelOutput {
    pub fn complete(message: AssistantMessage) -> Self {
        Self {
            message,
            message_started: false,
        }
    }
}

#[derive(Clone, Debug, Error)]
#[error("{message}")]
pub struct ModelError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl ModelError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
        }
    }
}

#[async_trait]
pub trait ModelAdapter: Send + Sync {
    /// Generate one complete assistant message. Adapters may publish bounded
    /// deltas and retry notices through `events` while the request is running.
    async fn generate(
        &self,
        request: ModelRequest,
        events: EventEmitter,
        cancellation: CancellationToken,
    ) -> Result<ModelOutput, ModelError>;
}
