use crate::{AgentContext, AgentError, AssistantMessage, Message, ModelSpec, ToolRegistry, ToolResultMessage};
use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug)]
pub struct LoopTurnContext {
    pub message: AssistantMessage,
    pub tool_results: Vec<ToolResultMessage>,
    pub context: AgentContext,
    pub new_messages: Vec<Message>,
}

#[derive(Clone, Default)]
pub struct LoopTurnUpdate {
    pub context: Option<AgentContext>,
    pub model: Option<ModelSpec>,
    pub tools: Option<ToolRegistry>,
}

#[async_trait]
pub trait LoopHooks: Send + Sync {
    /// Transform and filter the provider-visible context without mutating the
    /// durable agent context.
    async fn prepare_model_context(
        &self,
        context: AgentContext,
        _cancellation: CancellationToken,
    ) -> Result<AgentContext, AgentError> {
        Ok(context)
    }

    /// Apply dynamic context/model/tool changes after a completed turn.
    async fn prepare_next_turn(
        &self,
        _turn: LoopTurnContext,
        _cancellation: CancellationToken,
    ) -> Result<Option<LoopTurnUpdate>, AgentError> {
        Ok(None)
    }

    async fn should_stop_after_turn(
        &self,
        _turn: LoopTurnContext,
        _cancellation: CancellationToken,
    ) -> Result<bool, AgentError> {
        Ok(false)
    }
}

#[derive(Debug, Default)]
pub struct NoopLoopHooks;

#[async_trait]
impl LoopHooks for NoopLoopHooks {}
