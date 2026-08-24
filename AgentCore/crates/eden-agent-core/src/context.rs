use crate::{ContentBlock, Message, UserContent};
use serde_json::{Map, Value, json};
use std::collections::HashSet;

pub const MAX_CONTEXT_TEXT_CHARS: usize = 40_000;
pub const MAX_CONTEXT_TOOL_RESULT_CHARS: usize = 12_000;
pub const MAX_CONTEXT_STRUCTURED_CHARS: usize = 12_000;
pub const CONTEXT_TOOL_RESULT_TAIL_CHARS: usize = 2_000;

/// Produce deterministic, provider-safe model history without mutating the
/// durable event log. Failed assistant messages, orphan results and dangling
/// tool calls are removed; oversized payloads retain explicit continuation
/// metadata and the useful tail of tool output.
#[must_use]
pub fn sanitize_model_history(messages: &[Message]) -> Vec<Message> {
    let result_ids = messages
        .iter()
        .filter_map(|message| match message {
            Message::ToolResult(result) if !result.tool_call_id.is_empty() => Some(result.tool_call_id.clone()),
            _ => None,
        })
        .collect::<HashSet<_>>();
    let mut available_calls = HashSet::new();
    let mut sanitized = Vec::with_capacity(messages.len());

    for message in messages.iter().cloned() {
        match message {
            Message::Assistant(mut assistant) => {
                if assistant.is_terminal_failure() || assistant.error_message.is_some() {
                    continue;
                }
                assistant.content.retain_mut(|block| match block {
                    ContentBlock::ToolCall { id, arguments, .. } => {
                        if id.is_empty() || !result_ids.contains(id) {
                            return false;
                        }
                        truncate_arguments(arguments);
                        available_calls.insert(id.clone());
                        true
                    }
                    block => {
                        truncate_block(block, MAX_CONTEXT_TEXT_CHARS, 0);
                        true
                    }
                });
                if !assistant.content.is_empty() {
                    sanitized.push(Message::Assistant(assistant));
                }
            }
            Message::ToolResult(mut result) => {
                if !available_calls.remove(&result.tool_call_id) {
                    continue;
                }
                let mut truncated = false;
                for block in &mut result.content {
                    truncated |= truncate_block(block, MAX_CONTEXT_TOOL_RESULT_CHARS, CONTEXT_TOOL_RESULT_TAIL_CHARS);
                }
                for block in &mut result.external_context {
                    truncated |= truncate_block(block, MAX_CONTEXT_TOOL_RESULT_CHARS, CONTEXT_TOOL_RESULT_TAIL_CHARS);
                }
                if let Some(structured) = &mut result.structured_content {
                    truncated |= truncate_structured_content(structured, MAX_CONTEXT_STRUCTURED_CHARS);
                }
                if truncated {
                    if !result.details.is_object() {
                        result.details = json!({});
                    }
                    let details = result.details.as_object_mut().expect("object assigned");
                    details.insert(
                        "contextTruncation".to_owned(),
                        json!({
                            "truncated":true,
                            "maxChars":MAX_CONTEXT_TOOL_RESULT_CHARS,
                            "tailChars":CONTEXT_TOOL_RESULT_TAIL_CHARS,
                            "continuation":result.structured_content.as_ref().and_then(continuation_metadata),
                        }),
                    );
                }
                sanitized.push(Message::ToolResult(result));
            }
            Message::User {
                mut content,
                timestamp,
                extra,
            } => {
                match &mut content {
                    UserContent::Text(text) => {
                        *text = truncate_text(text, MAX_CONTEXT_TEXT_CHARS, 0).0;
                    }
                    UserContent::Blocks(blocks) => {
                        for block in blocks {
                            truncate_block(block, MAX_CONTEXT_TEXT_CHARS, 0);
                        }
                    }
                }
                sanitized.push(Message::User {
                    content,
                    timestamp,
                    extra,
                });
            }
            Message::BashExecution { mut data } => {
                truncate_map_field(
                    &mut data,
                    "output",
                    MAX_CONTEXT_TOOL_RESULT_CHARS,
                    CONTEXT_TOOL_RESULT_TAIL_CHARS,
                );
                sanitized.push(Message::BashExecution { data });
            }
            Message::Custom { mut data } => {
                truncate_dynamic_content(&mut data, MAX_CONTEXT_TEXT_CHARS);
                sanitized.push(Message::Custom { data });
            }
            message => sanitized.push(message),
        }
    }
    sanitized
}

fn truncate_structured_content(value: &mut Value, limit: usize) -> bool {
    let encoded = serde_json::to_string(value).unwrap_or_else(|_| "null".to_owned());
    let original_chars = encoded.chars().count();
    if original_chars <= limit {
        return false;
    }
    let continuation = continuation_metadata(value);
    let mut preview_chars = limit.saturating_div(2);
    loop {
        let preview = encoded.chars().take(preview_chars).collect::<String>();
        let replacement = json!({
            "truncated":true,
            "originalChars":original_chars,
            "preview":preview,
            "continuation":continuation,
        });
        let replacement_chars = serde_json::to_string(&replacement)
            .map(|value| value.chars().count())
            .unwrap_or(usize::MAX);
        if replacement_chars <= limit || preview_chars == 0 {
            *value = replacement;
            return true;
        }
        preview_chars /= 2;
    }
}

fn truncate_dynamic_content(data: &mut Map<String, Value>, limit: usize) {
    if let Some(Value::String(text)) = data.get_mut("content") {
        *text = truncate_text(text, limit, 0).0;
    } else if let Some(Value::Array(blocks)) = data.get_mut("content") {
        for block in blocks {
            if let Some(text) = block.get("text").and_then(Value::as_str).map(str::to_owned) {
                block["text"] = Value::String(truncate_text(&text, limit, 0).0);
            }
        }
    }
}

fn truncate_map_field(data: &mut Map<String, Value>, key: &str, limit: usize, tail: usize) -> bool {
    let Some(Value::String(text)) = data.get_mut(key) else {
        return false;
    };
    let (bounded, truncated) = truncate_text(text, limit, tail);
    *text = bounded;
    truncated
}

fn truncate_block(block: &mut ContentBlock, limit: usize, tail: usize) -> bool {
    match block {
        ContentBlock::Text { text } => {
            let (bounded, truncated) = truncate_text(text, limit, tail);
            *text = bounded;
            truncated
        }
        ContentBlock::Thinking { thinking, .. } => {
            let (bounded, truncated) = truncate_text(thinking, limit, tail);
            *thinking = bounded;
            truncated
        }
        ContentBlock::ToolCall { arguments, .. } => {
            let before = serde_json::to_string(arguments).unwrap_or_default();
            truncate_arguments(arguments);
            before != serde_json::to_string(arguments).unwrap_or_default()
        }
        ContentBlock::Image { .. } | ContentBlock::RedactedThinking { .. } => false,
    }
}

fn truncate_arguments(arguments: &mut Value) {
    let encoded = serde_json::to_string(arguments).unwrap_or_default();
    if encoded.chars().count() > MAX_CONTEXT_TOOL_RESULT_CHARS {
        *arguments = json!({
            "truncated":true,
            "preview":encoded.chars().take(MAX_CONTEXT_TOOL_RESULT_CHARS).collect::<String>(),
        });
    }
}

fn continuation_metadata(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    let mut continuation = Map::new();
    for key in [
        "next_offset",
        "nextOffset",
        "offset",
        "cursor",
        "continuation",
        "path",
        "truncated",
    ] {
        if let Some(value) = object.get(key) {
            continuation.insert(key.to_owned(), value.clone());
        }
    }
    (!continuation.is_empty()).then_some(Value::Object(continuation))
}

fn truncate_text(text: &str, limit: usize, tail_chars: usize) -> (String, bool) {
    let count = text.chars().count();
    if count <= limit {
        return (text.to_owned(), false);
    }
    let tail_chars = tail_chars.min(limit / 2);
    let head_chars = limit.saturating_sub(tail_chars);
    let omitted = count.saturating_sub(head_chars + tail_chars);
    let head = text.chars().take(head_chars).collect::<String>();
    if tail_chars == 0 {
        return (
            format!("{head}\n...[truncated {omitted} chars; continuation metadata preserved]"),
            true,
        );
    }
    let tail = text
        .chars()
        .rev()
        .take(tail_chars)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    (
        format!("{head}\n...[truncated {omitted} chars; tail preserved]...\n{tail}"),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AssistantMessage, ToolResultMessage, estimate_message_tokens};

    fn tool_result(id: &str, text: String, structured: Option<Value>) -> Message {
        Message::ToolResult(ToolResultMessage {
            tool_call_id: id.to_owned(),
            tool_name: "read".to_owned(),
            content: vec![ContentBlock::Text { text }],
            details: json!({}),
            structured_content: structured,
            success: true,
            external_context: Vec::new(),
            is_error: false,
            error: None,
            timestamp: 0,
            extra: Map::new(),
        })
    }

    #[test]
    fn removes_failures_orphans_and_incomplete_tool_history() {
        let mut valid = AssistantMessage::text("working");
        valid.content.push(ContentBlock::ToolCall {
            id: "valid".to_owned(),
            name: "read".to_owned(),
            arguments: json!({}),
            provider_item_id: None,
        });
        valid.content.push(ContentBlock::ToolCall {
            id: "dangling".to_owned(),
            name: "write".to_owned(),
            arguments: json!({}),
            provider_item_id: None,
        });
        let history = vec![
            Message::user("request"),
            Message::Assistant(AssistantMessage::failure("EOF", false)),
            Message::Assistant(valid),
            tool_result("orphan", "bad".to_owned(), None),
            tool_result("valid", "ok".to_owned(), None),
        ];
        let cleaned = sanitize_model_history(&history);
        assert_eq!(cleaned.len(), 3);
        let Message::Assistant(assistant) = &cleaned[1] else {
            panic!("assistant expected")
        };
        assert_eq!(assistant.tool_calls()[0].id, "valid");
        assert_eq!(assistant.tool_calls().len(), 1);
        let Message::ToolResult(result) = &cleaned[2] else {
            panic!("result expected")
        };
        assert_eq!(result.tool_call_id, "valid");
    }

    #[test]
    fn long_tool_result_keeps_tail_and_continuation() {
        let marker = "[Use offset=2001 to continue.]";
        let text = format!("{}{}", "x".repeat(20_000), marker);
        let mut assistant = AssistantMessage::text("");
        assistant.content = vec![ContentBlock::ToolCall {
            id: "read-1".to_owned(),
            name: "read".to_owned(),
            arguments: json!({}),
            provider_item_id: None,
        }];
        let cleaned = sanitize_model_history(&[
            Message::Assistant(assistant),
            tool_result("read-1", text, Some(json!({"truncated":true,"next_offset":2001}))),
        ]);
        let Message::ToolResult(result) = &cleaned[1] else {
            panic!("result expected")
        };
        let ContentBlock::Text { text } = &result.content[0] else {
            panic!("text expected")
        };
        assert!(text.contains("tail preserved"));
        assert!(text.ends_with(marker));
        assert_eq!(result.details["contextTruncation"]["continuation"]["next_offset"], 2001);
    }

    #[test]
    fn oversized_structured_tool_result_is_bounded_for_model_history() {
        let mut assistant = AssistantMessage::text("");
        assistant.content = vec![ContentBlock::ToolCall {
            id: "diff-1".to_owned(),
            name: "get_diff".to_owned(),
            arguments: json!({}),
            provider_item_id: None,
        }];
        let cleaned = sanitize_model_history(&[
            Message::Assistant(assistant),
            tool_result(
                "diff-1",
                "71 changed file(s)".to_owned(),
                Some(json!({"patch":"x".repeat(600_000),"path":"."})),
            ),
        ]);
        let Message::ToolResult(result) = &cleaned[1] else {
            panic!("result expected")
        };
        let structured = result.structured_content.as_ref().expect("structured output");
        assert_eq!(structured["truncated"], true);
        assert_eq!(structured["continuation"]["path"], ".");
        assert!(serde_json::to_string(structured).expect("JSON").chars().count() <= MAX_CONTEXT_STRUCTURED_CHARS);
        assert!(estimate_message_tokens(&cleaned[1], Some("deepseek-v4-flash")) < 5_000);
        assert_eq!(result.details["contextTruncation"]["truncated"], true);
    }
}
