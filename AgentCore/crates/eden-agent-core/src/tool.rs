use crate::message::empty_object;
use crate::{AgentContext, AssistantMessage, ContentBlock, EventEmitter, ToolCall, ToolErrorInfo};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
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
    #[serde(default = "empty_tool_parameters_schema")]
    pub parameters: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default = "default_namespace")]
    pub namespace: String,
    /// Runtime profiles in which this tool may be advertised and executed.
    /// An empty list means the host has not imposed a profile restriction.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub profiles: Vec<String>,
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
            parameters: empty_tool_parameters_schema(),
            output_schema: None,
            source: default_source(),
            version: default_version(),
            namespace: default_namespace(),
            profiles: Vec::new(),
            execution_mode: ToolExecutionMode::Parallel,
            exposure: ToolExposure::Direct,
        }
    }
}

/// Return the canonical input schema for a function tool that accepts no
/// arguments. Function tools always receive a JSON object, even when that
/// object has no properties.
#[must_use]
pub fn empty_tool_parameters_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false,
    })
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
    pub session_id: Option<String>,
    pub metadata: Value,
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

/// A reloadable collection of tools whose definitions and implementations may
/// change while the host remains running. Static registry entries always win
/// name collisions, so a dynamic source can never replace a host tool.
pub trait DynamicToolSource: Send + Sync {
    fn get(&self, name: &str) -> Option<Arc<dyn Tool>>;
    fn direct_definitions(&self) -> Vec<ToolDefinition>;
}

#[derive(Clone, Debug, Default)]
pub struct BeforeToolCallResult {
    pub cached_output: Option<ToolOutput>,
    pub metadata: Value,
}

#[derive(Clone, Debug)]
pub struct AfterToolCall {
    pub assistant_message: AssistantMessage,
    pub call: ToolCall,
    pub output: ToolOutput,
    pub is_error: bool,
    pub error: Option<ToolErrorInfo>,
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
    async fn before(
        &self,
        _context: BeforeToolCall,
        _cancellation: CancellationToken,
    ) -> Result<BeforeToolCallResult, ToolFailure> {
        Ok(BeforeToolCallResult::default())
    }

    async fn after(
        &self,
        context: AfterToolCall,
        _cancellation: CancellationToken,
    ) -> Result<AfterToolCallResult, ToolFailure> {
        Ok(AfterToolCallResult {
            output: context.output,
            is_error: context.is_error,
            error: context.error,
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
    dynamic_sources: Vec<Arc<dyn DynamicToolSource>>,
    allowed: Option<HashSet<String>>,
    excluded: HashSet<String>,
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

    pub fn register_dynamic_source(&mut self, source: Arc<dyn DynamicToolSource>) {
        self.dynamic_sources.push(source);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        if !self.allows(name) {
            return None;
        }
        self.tools
            .get(name)
            .cloned()
            .or_else(|| self.dynamic_sources.iter().find_map(|source| source.get(name)))
    }

    #[must_use]
    pub fn without<I, S>(&self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let excluded = names
            .into_iter()
            .map(|name| name.as_ref().to_owned())
            .collect::<std::collections::HashSet<_>>();
        let mut filtered = Self::new();
        for name in &self.order {
            if !excluded.contains(name) {
                if let Some(tool) = self.tools.get(name) {
                    filtered.register(Arc::clone(tool));
                }
            }
        }
        filtered.dynamic_sources = self.dynamic_sources.clone();
        filtered.allowed = self.allowed.clone();
        filtered.excluded = self.excluded.union(&excluded).cloned().collect();
        filtered
    }

    /// Return a snapshot view that exposes only the named tools, including
    /// tools supplied later by reloadable dynamic sources.
    #[must_use]
    pub fn only<I, S>(&self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let requested = names
            .into_iter()
            .map(|name| name.as_ref().to_owned())
            .collect::<HashSet<_>>();
        let mut filtered = self.clone();
        filtered.allowed = Some(match &self.allowed {
            Some(current) => current.intersection(&requested).cloned().collect(),
            None => requested,
        });
        filtered
    }

    pub fn direct_definitions(&self) -> Vec<ToolDefinition> {
        let mut definitions = self
            .order
            .iter()
            .filter_map(|name| self.tools.get(name))
            .map(|tool| tool.definition())
            .filter(|definition| definition.exposure == ToolExposure::Direct && self.allows(&definition.name))
            .collect::<Vec<_>>();
        let mut names = definitions
            .iter()
            .map(|definition| definition.name.clone())
            .collect::<HashSet<_>>();
        for source in &self.dynamic_sources {
            for definition in source.direct_definitions() {
                if definition.exposure == ToolExposure::Direct
                    && self.allows(&definition.name)
                    && names.insert(definition.name.clone())
                {
                    definitions.push(definition);
                }
            }
        }
        definitions
    }

    fn allows(&self, name: &str) -> bool {
        !self.excluded.contains(name) && self.allowed.as_ref().is_none_or(|allowed| allowed.contains(name))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_tools_use_a_strict_empty_object_schema() {
        let definition = ToolDefinition::direct("list_items", "List items");
        assert_eq!(definition.parameters, empty_tool_parameters_schema());
        assert_eq!(definition.parameters["type"], "object");
        assert_eq!(definition.parameters["properties"], json!({}));
        assert_eq!(definition.parameters["additionalProperties"], false);
    }

    #[test]
    fn deserialized_tools_without_parameters_receive_the_strict_default() {
        let definition: ToolDefinition = serde_json::from_value(json!({
            "name":"list_items",
            "label":"list_items",
            "description":"List items"
        }))
        .expect("tool definition");
        assert_eq!(definition.parameters, empty_tool_parameters_schema());
    }
}
