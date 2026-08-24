use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("agent is already processing a prompt")]
    AlreadyRunning,
    #[error("event consumer disconnected")]
    EventConsumerDisconnected,
    #[error("agent loop exceeded the configured limit of {0} model steps")]
    StepLimitExceeded(u32),
    #[error("cannot continue without message history")]
    EmptyHistory,
    #[error("cannot continue from an assistant message")]
    ContinueFromAssistant,
    #[error("agent task failed: {0}")]
    Join(String),
    #[error("agent loop hook failed: {0}")]
    Hook(String),
}
