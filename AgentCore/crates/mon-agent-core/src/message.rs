use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<Value>,
    },
    #[serde(rename = "thinking")]
    Thinking {
        #[serde(default)]
        thinking: String,
        #[serde(flatten)]
        extra: Map<String, Value>,
    },
    #[serde(rename = "redactedThinking")]
    RedactedThinking {
        #[serde(flatten)]
        data: Map<String, Value>,
    },
    #[serde(rename = "toolCall")]
    ToolCall {
        id: String,
        name: String,
        #[serde(default)]
        arguments: Value,
        #[serde(rename = "providerItemId", default, skip_serializing_if = "Option::is_none")]
        provider_item_id: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum UserContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "role")]
pub enum Message {
    #[serde(rename = "user")]
    User {
        content: UserContent,
        #[serde(default = "now_ms", deserialize_with = "deserialize_timestamp")]
        timestamp: u64,
        #[serde(flatten)]
        extra: Map<String, Value>,
    },
    #[serde(rename = "assistant")]
    Assistant(AssistantMessage),
    #[serde(rename = "toolResult")]
    ToolResult(ToolResultMessage),
    #[serde(rename = "bashExecution")]
    BashExecution {
        #[serde(flatten)]
        data: Map<String, Value>,
    },
    #[serde(rename = "custom")]
    Custom {
        #[serde(flatten)]
        data: Map<String, Value>,
    },
    #[serde(rename = "branchSummary")]
    BranchSummary {
        #[serde(flatten)]
        data: Map<String, Value>,
    },
    #[serde(rename = "compactionSummary")]
    CompactionSummary {
        #[serde(flatten)]
        data: Map<String, Value>,
    },
}

impl Message {
    pub fn user(text: impl Into<String>) -> Self {
        Self::User {
            content: UserContent::Blocks(vec![ContentBlock::Text { text: text.into() }]),
            timestamp: now_ms(),
            extra: Map::new(),
        }
    }

    pub fn is_assistant(&self) -> bool {
        matches!(self, Self::Assistant(_))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantMessage {
    #[serde(default)]
    pub content: Vec<ContentBlock>,
    #[serde(default)]
    pub api: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
    #[serde(default = "default_stop_reason")]
    pub stop_reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default = "now_ms", deserialize_with = "deserialize_timestamp")]
    pub timestamp: u64,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl AssistantMessage {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            content: vec![ContentBlock::Text { text: text.into() }],
            api: String::new(),
            provider: String::new(),
            model: String::new(),
            usage: None,
            stop_reason: "stop".to_owned(),
            error_message: None,
            timestamp: now_ms(),
            extra: Map::new(),
        }
    }

    pub fn failure(reason: impl Into<String>, aborted: bool) -> Self {
        Self {
            content: vec![ContentBlock::Text { text: String::new() }],
            stop_reason: if aborted { "aborted" } else { "error" }.to_owned(),
            error_message: Some(reason.into()),
            ..Self::text("")
        }
    }

    pub fn tool_calls(&self) -> Vec<ToolCall> {
        self.content
            .iter()
            .filter_map(|block| match block {
                ContentBlock::ToolCall {
                    id, name, arguments, ..
                } => Some(ToolCall {
                    id: id.clone(),
                    name: name.clone(),
                    arguments: arguments.clone(),
                }),
                _ => None,
            })
            .collect()
    }

    pub fn is_terminal_failure(&self) -> bool {
        matches!(self.stop_reason.as_str(), "error" | "aborted")
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultMessage {
    pub tool_call_id: String,
    pub tool_name: String,
    #[serde(default)]
    pub content: Vec<ContentBlock>,
    #[serde(default)]
    pub details: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<Value>,
    pub success: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub external_context: Vec<ContentBlock>,
    pub is_error: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ToolErrorInfo>,
    #[serde(default = "now_ms", deserialize_with = "deserialize_timestamp")]
    pub timestamp: u64,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolErrorInfo {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn deserialize_timestamp<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<u64>::deserialize(deserializer)?.unwrap_or_default())
}

fn default_stop_reason() -> String {
    "stop".to_owned()
}

pub(crate) fn empty_object() -> Value {
    Value::Object(Map::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assistant_message_matches_wire_shape() {
        let value = serde_json::to_value(Message::Assistant(AssistantMessage::text("hello")))
            .expect("message should serialize");
        assert_eq!(value["role"], "assistant");
        assert_eq!(value["content"][0]["type"], "text");
        assert_eq!(value["content"][0]["text"], "hello");
        assert_eq!(value["stopReason"], "stop");
    }

    #[test]
    fn tool_call_uses_camel_case_discriminator() {
        let value = serde_json::to_value(ContentBlock::ToolCall {
            id: "call_1".to_owned(),
            name: "read".to_owned(),
            arguments: serde_json::json!({"path": "README.md"}),
            provider_item_id: None,
        })
        .expect("content should serialize");
        assert_eq!(value["type"], "toolCall");
    }

    #[test]
    fn compaction_messages_round_trip_without_losing_fields() {
        let input = serde_json::json!({
            "role": "compactionSummary",
            "summary": "prior context",
            "tokensBefore": 42,
            "timestamp": 7,
        });
        let message: Message = serde_json::from_value(input.clone()).expect("summary should decode");
        assert_eq!(serde_json::to_value(message).expect("summary should encode"), input);
    }

    #[test]
    fn thinking_blocks_round_trip_with_provider_signatures() {
        let value = serde_json::json!({
            "role": "assistant",
            "content": [{
                "type": "thinking",
                "thinking": "private reasoning",
                "thinkingSignature": "signed"
            }],
            "provider": "test",
            "model": "reasoner",
            "stopReason": "stop"
        });
        let message: Message = serde_json::from_value(value.clone()).expect("thinking message decodes");
        let encoded = serde_json::to_value(message).expect("thinking message encodes");
        assert_eq!(encoded["content"][0]["thinking"], "private reasoning");
        assert_eq!(encoded["content"][0]["thinkingSignature"], "signed");
    }
}
