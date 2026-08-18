use crate::message::empty_object;
use crate::{AgentContext, AssistantMessage, ContentBlock, EventEmitter, ToolCall, ToolErrorInfo};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolExecutionMode {
    Sequential,
    #[default]
    Parallel,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub parameters: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default = "default_namespace")]
    pub namespace: String,
    #[serde(default)]
    pub execution_mode: ToolExecutionMode,
    #[serde(default)]
    pub exposure: ToolExposure,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolExposure {
    #[default]
    Direct,
    Deferred,
    Hidden,
}

impl ToolDefinition {
    pub fn direct(name: impl Into<String>, description: impl Into<String>) -> Self {
        let name = name.into();
        Self {
            label: name.clone(),
            name,
            description: description.into(),
            parameters: empty_object(),
            output_schema: None,
            source: default_source(),
            version: default_version(),
            namespace: default_namespace(),
            execution_mode: ToolExecutionMode::Parallel,
            exposure: ToolExposure::Direct,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutput {
    #[serde(default)]
    pub content: Vec<ContentBlock>,
    #[serde(default)]
    pub details: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<Value>,
    #[serde(default)]
    pub external_context: Vec<ContentBlock>,
    #[serde(default)]
    pub terminate: bool,
    #[serde(default = "default_success")]
    pub success: bool,
}

impl ToolOutput {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            content: vec![ContentBlock::Text { text: text.into() }],
            details: empty_object(),
            structured_content: None,
            external_context: Vec::new(),
            terminate: false,
            success: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub permission: String,
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub always: Vec<String>,
}

#[derive(Clone)]
pub struct ToolCallContext {
    pub cancellation: CancellationToken,
    pub events: EventEmitter,
}

#[derive(Clone, Debug, Error)]
#[error("{message}")]
pub struct ToolFailure {
    pub info: ToolErrorInfo,
    pub message: String,
    pub details: Value,
}

impl ToolFailure {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            info: ToolErrorInfo {
                code: code.into(),
                message: message.clone(),
                retryable: false,
            },
            message,
            details: empty_object(),
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = details;
        self
    }
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;

    fn timeout(&self) -> Option<Duration> {
        None
    }

    fn permission_request(&self, _arguments: &Value) -> Option<PermissionRequest> {
        None
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure>;
}

#[derive(Clone, Debug)]
pub struct BeforeToolCall {
    pub assistant_message: AssistantMessage,
    pub call: ToolCall,
    pub definition: ToolDefinition,
    pub permission_request: Option<PermissionRequest>,
    pub context: AgentContext,
}

#[derive(Clone, Debug)]
pub struct AfterToolCall {
    pub assistant_message: AssistantMessage,
    pub call: ToolCall,
    pub output: ToolOutput,
    pub is_error: bool,
    pub context: AgentContext,
}

#[derive(Clone, Debug)]
pub struct AfterToolCallResult {
    pub output: ToolOutput,
    pub is_error: bool,
    pub error: Option<ToolErrorInfo>,
}

#[async_trait]
pub trait ToolHooks: Send + Sync {
    async fn before(&self, _context: BeforeToolCall, _cancellation: CancellationToken) -> Result<(), ToolFailure> {
        Ok(())
    }

    async fn after(
        &self,
        context: AfterToolCall,
        _cancellation: CancellationToken,
    ) -> Result<AfterToolCallResult, ToolFailure> {
        Ok(AfterToolCallResult {
            output: context.output,
            is_error: context.is_error,
            error: None,
        })
    }
}

#[derive(Debug, Default)]
pub struct NoopToolHooks;

#[async_trait]
impl ToolHooks for NoopToolHooks {}

#[derive(Clone, Default)]
pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
    order: Vec<String>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) -> Option<Arc<dyn Tool>> {
        let name = tool.definition().name.clone();
        if !self.tools.contains_key(&name) {
            self.order.push(name.clone());
        }
        self.tools.insert(name, tool)
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    pub fn direct_definitions(&self) -> Vec<ToolDefinition> {
        self.order
            .iter()
            .filter_map(|name| self.tools.get(name))
            .map(|tool| tool.definition())
            .filter(|definition| definition.exposure == ToolExposure::Direct)
            .collect()
    }
}

fn default_source() -> String {
    "runtime".to_owned()
}

fn default_version() -> String {
    "1".to_owned()
}

fn default_namespace() -> String {
    "general".to_owned()
}

fn default_success() -> bool {
    true
}
