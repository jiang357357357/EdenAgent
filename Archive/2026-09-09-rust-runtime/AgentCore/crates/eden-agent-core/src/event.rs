use crate::{AssistantMessage, Message, ToolCall, ToolErrorInfo, ToolOutput, ToolResultMessage};
use serde::{Deserialize, Serialize, Serializer};
use tokio::sync::mpsc;

use crate::AgentError;

pub const DEFAULT_EVENT_CAPACITY: usize = 256;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    AgentStart,
    AgentEnd {
        messages: Vec<Message>,
    },
    TurnStart {
        turn: u32,
    },
    TurnEnd {
        turn: u32,
        #[serde(serialize_with = "serialize_assistant_message")]
        message: AssistantMessage,
        #[serde(rename = "toolResults")]
        tool_results: Vec<ToolResultMessage>,
    },
    MessageStart {
        message: Message,
    },
    MessageUpdate {
        #[serde(serialize_with = "serialize_assistant_message")]
        message: AssistantMessage,
        delta: String,
        #[serde(rename = "assistantMessageEvent", skip_serializing_if = "Option::is_none")]
        assistant_message_event: Option<serde_json::Value>,
    },
    /// Retract provider-visible provisional content before a safe stream retry.
    /// The message is the empty replacement for the active assistant message.
    StreamReset {
        #[serde(serialize_with = "serialize_assistant_message")]
        message: AssistantMessage,
        reason: String,
    },
    MessageEnd {
        message: Message,
    },
    ModelRetry {
        attempt: u32,
        #[serde(rename = "maxAttempts")]
        max_attempts: u32,
        #[serde(rename = "delayMs")]
        delay_ms: u64,
        reason: String,
        #[serde(rename = "statusCode", skip_serializing_if = "Option::is_none")]
        status_code: Option<u16>,
    },
    ToolExecutionStart {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        args: serde_json::Value,
    },
    ToolExecutionUpdate {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(rename = "partialResult")]
        partial_result: ToolOutput,
    },
    ToolExecutionEnd {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        result: ToolOutput,
        #[serde(rename = "isError")]
        is_error: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<ToolErrorInfo>,
    },
    ToolCallObserved {
        call: ToolCall,
    },
}

#[derive(Clone, Debug)]
pub struct EventEmitter {
    sender: mpsc::Sender<AgentEvent>,
}

impl EventEmitter {
    pub async fn emit(&self, event: AgentEvent) -> Result<(), AgentError> {
        self.sender
            .send(event)
            .await
            .map_err(|_| AgentError::EventConsumerDisconnected)
    }

    pub fn capacity(&self) -> usize {
        self.sender.capacity()
    }
}

pub fn event_channel(capacity: usize) -> (EventEmitter, mpsc::Receiver<AgentEvent>) {
    let (sender, receiver) = mpsc::channel(capacity.max(1));
    (EventEmitter { sender }, receiver)
}

fn serialize_assistant_message<S>(message: &AssistantMessage, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut value = serde_json::to_value(message).map_err(serde::ser::Error::custom)?;
    if let serde_json::Value::Object(object) = &mut value {
        object.insert("role".to_owned(), serde_json::Value::String("assistant".to_owned()));
    }
    value.serialize(serializer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_assistant_event_fields_keep_the_wire_role() {
        let event = AgentEvent::MessageUpdate {
            message: AssistantMessage::text("partial"),
            delta: "partial".to_owned(),
            assistant_message_event: None,
        };
        let value = serde_json::to_value(event).expect("event should serialize");
        assert_eq!(value["message"]["role"], "assistant");
    }

    #[test]
    fn stream_reset_serializes_an_empty_assistant_replacement() {
        let event = AgentEvent::StreamReset {
            message: AssistantMessage::text(""),
            reason: "incomplete stream".to_owned(),
        };
        let value = serde_json::to_value(event).expect("event should serialize");
        assert_eq!(value["type"], "stream_reset");
        assert_eq!(value["message"]["role"], "assistant");
        assert_eq!(value["message"]["content"][0]["text"], "");
    }
}
