use crate::{ContentBlock, Message, ToolDefinition, UserContent};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tiktoken_rs::{CoreBPE, bpe_for_model, o200k_base_singleton};

fn normalized_model_id(model_id: Option<&str>) -> &str {
    model_id
        .unwrap_or_default()
        .trim()
        .rsplit_once('/')
        .map_or_else(|| model_id.unwrap_or_default().trim(), |(_, model)| model)
}

fn encoding(model_id: Option<&str>) -> &'static CoreBPE {
    let normalized = normalized_model_id(model_id);
    if normalized.is_empty() {
        return o200k_base_singleton();
    }
    bpe_for_model(normalized).unwrap_or_else(|_| o200k_base_singleton())
}

pub fn tokenizer_name(model_id: Option<&str>) -> &'static str {
    let model = normalized_model_id(model_id).to_ascii_lowercase();
    if model.starts_with("gpt-4") && !model.starts_with("gpt-4o") && !model.starts_with("gpt-4.1")
        || model.starts_with("gpt-3.5")
        || model.starts_with("text-embedding")
    {
        "cl100k_base"
    } else {
        "o200k_base"
    }
}

pub fn count_text_tokens(text: &str, model_id: Option<&str>) -> usize {
    if text.is_empty() {
        0
    } else {
        encoding(model_id).count_ordinary(text)
    }
}

pub fn count_json_tokens(value: &Value, model_id: Option<&str>) -> usize {
    let encoded = serde_json::to_string(value).unwrap_or_else(|_| "null".to_owned());
    count_text_tokens(&encoded, model_id)
}

fn content_tokens(blocks: &[ContentBlock], model_id: Option<&str>) -> usize {
    blocks
        .iter()
        .map(|block| match block {
            ContentBlock::Text { text } => count_text_tokens(text, model_id),
            ContentBlock::Image { .. } => 1_200,
            ContentBlock::Thinking { thinking, .. } => count_text_tokens(thinking, model_id),
            ContentBlock::RedactedThinking { .. } => 0,
            ContentBlock::ToolCall { name, arguments, .. } => {
                count_text_tokens(name, model_id) + count_json_tokens(arguments, model_id)
            }
        })
        .sum()
}

fn dynamic_content_tokens(data: &serde_json::Map<String, Value>, model_id: Option<&str>) -> usize {
    match data.get("content") {
        Some(Value::String(text)) => count_text_tokens(text, model_id),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .map(|block| match block {
                Value::Object(block) if block.get("type").and_then(Value::as_str) == Some("text") => block
                    .get("text")
                    .and_then(Value::as_str)
                    .map_or(0, |text| count_text_tokens(text, model_id)),
                Value::Object(block) if block.get("type").and_then(Value::as_str) == Some("image") => 1_200,
                _ => 0,
            })
            .sum(),
        _ => 0,
    }
}

pub fn estimate_message_tokens(message: &Message, model_id: Option<&str>) -> usize {
    match message {
        Message::User { content, .. } => match content {
            UserContent::Text(text) => count_text_tokens(text, model_id),
            UserContent::Blocks(blocks) => content_tokens(blocks, model_id),
        },
        Message::Assistant(message) => content_tokens(&message.content, model_id),
        Message::ToolResult(message) => {
            content_tokens(&message.content, model_id)
                + message
                    .structured_content
                    .as_ref()
                    .map_or(0, |value| count_json_tokens(value, model_id))
        }
        Message::BashExecution { data } => {
            data.get("command")
                .and_then(Value::as_str)
                .map_or(0, |text| count_text_tokens(text, model_id))
                + data
                    .get("output")
                    .and_then(Value::as_str)
                    .map_or(0, |text| count_text_tokens(text, model_id))
        }
        Message::Custom { data } => dynamic_content_tokens(data, model_id),
        Message::BranchSummary { data } | Message::CompactionSummary { data } => data
            .get("summary")
            .and_then(Value::as_str)
            .map_or(0, |text| count_text_tokens(text, model_id)),
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextTokenEstimate {
    pub tokens: usize,
    pub usage_tokens: usize,
    pub trailing_tokens: usize,
    pub last_usage_index: Option<usize>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptTokenBreakdown {
    pub identity: usize,
    pub system: usize,
    pub skills: usize,
    pub tools: usize,
    pub history: usize,
    pub total: usize,
}

#[must_use]
pub fn estimate_prompt_token_breakdown(
    system_prompt: &str,
    identity_context: &str,
    skill_context: &str,
    tools: &[ToolDefinition],
    messages: &[Message],
    model_id: Option<&str>,
) -> PromptTokenBreakdown {
    let identity = count_text_tokens(identity_context, model_id);
    let skills = count_text_tokens(skill_context, model_id);
    let all_system = count_text_tokens(system_prompt, model_id);
    let system = all_system.saturating_sub(identity).saturating_sub(skills);
    let tools = count_json_tokens(
        &serde_json::to_value(tools).unwrap_or_else(|_| Value::Array(Vec::new())),
        model_id,
    );
    let history = messages
        .iter()
        .map(|message| estimate_message_tokens(message, model_id))
        .sum();
    PromptTokenBreakdown {
        identity,
        system,
        skills,
        tools,
        history,
        total: all_system.saturating_add(tools).saturating_add(history),
    }
}

fn assistant_usage(message: &Message) -> Option<usize> {
    let Message::Assistant(assistant) = message else {
        return None;
    };
    if matches!(assistant.stop_reason.as_str(), "aborted" | "error") {
        return None;
    }
    let usage = assistant.usage.as_ref()?.as_object()?;
    let number = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or_default() as usize;
    let total = number("totalTokens");
    let tokens = if total > 0 {
        total
    } else {
        number("input") + number("output") + number("cacheRead") + number("cacheWrite")
    };
    (tokens > 0).then_some(tokens)
}

pub fn estimate_context_tokens(messages: &[Message], model_id: Option<&str>) -> ContextTokenEstimate {
    let usage = messages
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, message)| assistant_usage(message).map(|tokens| (index, tokens)));
    if let Some((index, usage_tokens)) = usage {
        let trailing_tokens = messages[index + 1..]
            .iter()
            .map(|message| estimate_message_tokens(message, model_id))
            .sum();
        ContextTokenEstimate {
            tokens: usage_tokens + trailing_tokens,
            usage_tokens,
            trailing_tokens,
            last_usage_index: Some(index),
        }
    } else {
        let tokens = messages
            .iter()
            .map(|message| estimate_message_tokens(message, model_id))
            .sum();
        ContextTokenEstimate {
            tokens,
            usage_tokens: 0,
            trailing_tokens: tokens,
            last_usage_index: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AssistantMessage;
    use serde_json::json;

    #[test]
    fn o200k_counts_match_reference_tiktoken_fixtures() {
        assert_eq!(count_text_tokens("hello", None), 1);
        assert_eq!(count_text_tokens("你好，世界", None), 3);
        assert_eq!(count_text_tokens("function main() { return 42; }", None), 9);
        assert_eq!(count_text_tokens("emoji 😀 test", None), 3);
        assert_eq!(count_json_tokens(&json!({"path": "文档/a.txt", "n": 3}), None), 12);
        assert_eq!(tokenizer_name(None), "o200k_base");
        assert_eq!(tokenizer_name(Some("openai/gpt-4")), "cl100k_base");
    }

    #[test]
    fn context_estimation_anchors_on_latest_provider_usage() {
        let first = Message::user("earlier text");
        let mut assistant = AssistantMessage::text("answer");
        assistant.usage = Some(json!({"input": 80, "output": 20, "totalTokens": 100}));
        let trailing = Message::user("hello");
        let estimate = estimate_context_tokens(&[first, Message::Assistant(assistant), trailing], None);
        assert_eq!(estimate.tokens, 101);
        assert_eq!(estimate.usage_tokens, 100);
        assert_eq!(estimate.trailing_tokens, 1);
        assert_eq!(estimate.last_usage_index, Some(1));
    }

    #[test]
    fn prompt_breakdown_accounts_for_all_cache_components() {
        let tools = vec![ToolDefinition::direct("read", "Read a file")];
        let breakdown = estimate_prompt_token_breakdown(
            "identity system skills",
            "identity",
            "skills",
            &tools,
            &[Message::user("history")],
            None,
        );
        assert!(breakdown.identity > 0);
        assert!(breakdown.system > 0);
        assert!(breakdown.skills > 0);
        assert!(breakdown.tools > 0);
        assert!(breakdown.history > 0);
        assert_eq!(
            breakdown.total,
            breakdown.identity + breakdown.system + breakdown.skills + breakdown.tools + breakdown.history
        );
    }
}
