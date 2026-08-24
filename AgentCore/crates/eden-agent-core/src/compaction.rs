use crate::{ContentBlock, Message, UserContent, estimate_context_tokens, estimate_message_tokens};
use serde_json::{Value, json};
use std::collections::BTreeSet;

const SUMMARIZATION_SYSTEM_PROMPT: &str = "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.\n\nDo NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.";

const SUMMARIZATION_PROMPT: &str = r#"The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages."#;

const UPDATE_SUMMARIZATION_PROMPT: &str = r#"The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed tasks]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages."#;

pub fn should_compact(context_tokens: usize, context_window: usize, settings: &Value) -> bool {
    if settings.get("enabled").and_then(Value::as_bool) == Some(false) {
        return false;
    }
    let reserve = settings.get("reserveTokens").and_then(Value::as_u64).unwrap_or(16_384) as usize;
    context_tokens > context_window.saturating_sub(reserve)
}

fn message_from_entry(entry: &Value, include_compaction: bool) -> Option<Message> {
    match entry.get("type").and_then(Value::as_str) {
        Some("message") => serde_json::from_value(entry.get("message")?.clone()).ok(),
        Some("custom_message") => serde_json::from_value(json!({
            "role": "custom",
            "customType": entry.get("customType"),
            "content": entry.get("content"),
            "display": entry.get("display"),
            "details": entry.get("details"),
            "timestamp": 0,
        }))
        .ok(),
        Some("branch_summary") if entry.get("summary").and_then(Value::as_str).is_some() => {
            serde_json::from_value(json!({
                "role": "branchSummary",
                "summary": entry.get("summary"),
                "fromId": entry.get("fromId"),
                "timestamp": 0,
            }))
            .ok()
        }
        Some("compaction") if include_compaction => serde_json::from_value(json!({
            "role": "compactionSummary",
            "summary": entry.get("summary"),
            "tokensBefore": entry.get("tokensBefore"),
            "firstKeptEntryId": entry.get("firstKeptEntryId"),
            "details": entry.get("details"),
            "timestamp": 0,
        }))
        .ok(),
        _ => None,
    }
}

fn timestamp_ms(value: Option<&Value>) -> u64 {
    if let Some(number) = value.and_then(Value::as_u64) {
        return number;
    }
    let Some(text) = value.and_then(Value::as_str) else {
        return 0;
    };
    let text = text.strip_suffix('Z').unwrap_or(text);
    let Some((date, time_and_offset)) = text.split_once('T') else {
        return 0;
    };
    let date_parts = date
        .split('-')
        .filter_map(|part| part.parse::<i64>().ok())
        .collect::<Vec<_>>();
    if date_parts.len() != 3 {
        return 0;
    }
    let offset_index = time_and_offset
        .char_indices()
        .skip(1)
        .find_map(|(index, character)| matches!(character, '+' | '-').then_some(index));
    let (clock, offset) = offset_index.map_or((time_and_offset, None), |index| {
        (&time_and_offset[..index], Some(&time_and_offset[index..]))
    });
    let clock_parts = clock.split(':').collect::<Vec<_>>();
    if clock_parts.len() != 3 {
        return 0;
    }
    let Ok(hour) = clock_parts[0].parse::<i64>() else {
        return 0;
    };
    let Ok(minute) = clock_parts[1].parse::<i64>() else {
        return 0;
    };
    let (second_text, fraction) = clock_parts[2].split_once('.').unwrap_or((clock_parts[2], ""));
    let Ok(second) = second_text.parse::<i64>() else {
        return 0;
    };
    let millis = fraction.chars().take(3).collect::<String>().parse::<i64>().unwrap_or(0)
        * 10_i64.pow(3_u32.saturating_sub(fraction.chars().take(3).count() as u32));
    let offset_seconds = offset.map_or(0, |offset| {
        let sign = if offset.starts_with('-') { -1 } else { 1 };
        let parts = offset[1..]
            .split(':')
            .filter_map(|part| part.parse::<i64>().ok())
            .collect::<Vec<_>>();
        sign * (parts.first().copied().unwrap_or(0) * 3_600 + parts.get(1).copied().unwrap_or(0) * 60)
    });
    let (year, month, day) = (date_parts[0], date_parts[1], date_parts[2]);
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    let epoch_millis = (days * 86_400 + hour * 3_600 + minute * 60 + second - offset_seconds) * 1_000 + millis;
    epoch_millis.max(0) as u64
}

fn entry_message_value(entry: &Value, include_compaction: bool) -> Option<Value> {
    match entry.get("type").and_then(Value::as_str) {
        Some("message") => entry.get("message").cloned(),
        Some("custom_message") => Some(json!({
            "role": "custom",
            "customType": entry.get("customType"),
            "content": entry.get("content"),
            "display": entry.get("display"),
            "details": entry.get("details"),
            "timestamp": timestamp_ms(entry.get("timestamp")),
        })),
        Some("branch_summary") if entry.get("summary").and_then(Value::as_str).is_some() => Some(json!({
            "role": "branchSummary",
            "summary": entry.get("summary"),
            "fromId": entry.get("fromId"),
            "timestamp": timestamp_ms(entry.get("timestamp")),
        })),
        Some("compaction") if include_compaction => Some(json!({
            "role": "compactionSummary",
            "summary": entry.get("summary").and_then(Value::as_str).unwrap_or_default(),
            "tokensBefore": entry.get("tokensBefore").and_then(Value::as_u64).unwrap_or(0),
            "timestamp": timestamp_ms(entry.get("timestamp")),
        })),
        _ => None,
    }
}

pub fn build_session_context(entries: &[Value]) -> Value {
    let mut thinking_level = json!("off");
    let mut model = Value::Null;
    let mut active_tool_names = Value::Null;
    let mut compaction_index = None;
    for (index, entry) in entries.iter().enumerate() {
        match entry.get("type").and_then(Value::as_str) {
            Some("thinking_level_change") => {
                thinking_level = entry.get("thinkingLevel").cloned().unwrap_or_else(|| json!("off"));
            }
            Some("model_change") => {
                model = json!({"provider":entry.get("provider"),"modelId":entry.get("modelId")});
            }
            Some("message") if entry.pointer("/message/role").and_then(Value::as_str) == Some("assistant") => {
                model = json!({
                    "provider": entry.pointer("/message/provider"),
                    "modelId": entry.pointer("/message/model"),
                });
            }
            Some("active_tools_change") => {
                active_tool_names = entry.get("activeToolNames").cloned().unwrap_or_else(|| json!([]));
            }
            Some("compaction") => compaction_index = Some(index),
            _ => {}
        }
    }

    let mut messages = Vec::new();
    if let Some(index) = compaction_index {
        let compaction = &entries[index];
        if let Some(message) = entry_message_value(compaction, true) {
            messages.push(message);
        }
        let first_kept_id = compaction.get("firstKeptEntryId");
        let mut found = false;
        for entry in &entries[..index] {
            if entry.get("id") == first_kept_id {
                found = true;
            }
            if found {
                if let Some(message) = entry_message_value(entry, false) {
                    messages.push(message);
                }
            }
        }
        messages.extend(
            entries[index + 1..]
                .iter()
                .filter_map(|entry| entry_message_value(entry, false)),
        );
    } else {
        messages.extend(entries.iter().filter_map(|entry| entry_message_value(entry, false)));
    }
    json!({
        "messages": messages,
        "thinkingLevel": thinking_level,
        "model": model,
        "activeToolNames": active_tool_names,
    })
}

fn build_session_messages(entries: &[Value]) -> Vec<Message> {
    let messages =
        serde_json::from_value::<Vec<Message>>(build_session_context(entries)["messages"].clone()).unwrap_or_default();
    crate::sanitize_model_history(&messages)
}

fn valid_cut_points(entries: &[Value], start: usize, end: usize) -> Vec<usize> {
    (start..end)
        .filter(|&index| match entries[index].get("type").and_then(Value::as_str) {
            Some("message") => matches!(
                entries[index]
                    .get("message")
                    .and_then(|message| message.get("role"))
                    .and_then(Value::as_str),
                Some("bashExecution" | "custom" | "branchSummary" | "compactionSummary" | "user" | "assistant")
            ),
            Some("branch_summary" | "custom_message") => true,
            _ => false,
        })
        .collect()
}

fn entry_message_tokens(entry: &Value, model_id: Option<&str>) -> usize {
    message_from_entry(entry, false).map_or(0, |message| estimate_message_tokens(&message, model_id))
}

fn find_cut_point(
    entries: &[Value],
    start: usize,
    end: usize,
    keep_recent_tokens: usize,
    tail_turns: usize,
    model_id: Option<&str>,
) -> usize {
    let cut_points = valid_cut_points(entries, start, end);
    let Some(mut cut_index) = cut_points.last().copied() else {
        return start;
    };
    let turn_starts: Vec<usize> = (start..end)
        .filter(|&index| {
            entries[index].get("type").and_then(Value::as_str) == Some("message")
                && matches!(
                    entries[index]
                        .get("message")
                        .and_then(|message| message.get("role"))
                        .and_then(Value::as_str),
                    Some("user" | "bashExecution")
                )
        })
        .collect();
    let recent_start = turn_starts.len().saturating_sub(tail_turns);
    let recent = &turn_starts[recent_start..];
    let mut accumulated = 0usize;
    for position in (0..recent.len()).rev() {
        let turn_start = recent[position];
        let turn_end = recent.get(position + 1).copied().unwrap_or(end);
        let turn_tokens: usize = entries[turn_start..turn_end]
            .iter()
            .map(|entry| entry_message_tokens(entry, model_id))
            .sum();
        if accumulated + turn_tokens <= keep_recent_tokens {
            accumulated += turn_tokens;
            cut_index = turn_start;
            continue;
        }
        if accumulated > 0 {
            break;
        }
        for index in (turn_start..turn_end).rev() {
            if entries[index].get("type").and_then(Value::as_str) != Some("message") {
                continue;
            }
            accumulated += entry_message_tokens(&entries[index], model_id);
            if accumulated >= keep_recent_tokens {
                cut_index = cut_points
                    .iter()
                    .copied()
                    .find(|point| *point >= index)
                    .unwrap_or_else(|| *cut_points.last().expect("cut point"));
                break;
            }
        }
        break;
    }
    while cut_index > start
        && !matches!(
            entries[cut_index - 1].get("type").and_then(Value::as_str),
            Some("compaction" | "message")
        )
    {
        cut_index -= 1;
    }
    cut_index
}

#[derive(Default)]
struct FileOperations {
    read: BTreeSet<String>,
    written: BTreeSet<String>,
    edited: BTreeSet<String>,
}

fn extract_file_operations(messages: &[Message], operations: &mut FileOperations) {
    for message in messages {
        let Message::Assistant(assistant) = message else {
            continue;
        };
        for block in &assistant.content {
            let ContentBlock::ToolCall { name, arguments, .. } = block else {
                continue;
            };
            let Some(path) = arguments
                .get("path")
                .and_then(Value::as_str)
                .filter(|path| !path.is_empty())
            else {
                continue;
            };
            match name.as_str() {
                "read" => {
                    operations.read.insert(path.to_owned());
                }
                "write" => {
                    operations.written.insert(path.to_owned());
                }
                "edit" => {
                    operations.edited.insert(path.to_owned());
                }
                _ => {}
            }
        }
    }
}

pub fn prepare_compaction(
    entries: &[Value],
    settings: &Value,
    model_id: Option<&str>,
) -> Result<Option<Value>, String> {
    if entries.is_empty()
        || entries
            .last()
            .and_then(|entry| entry.get("type"))
            .and_then(Value::as_str)
            == Some("compaction")
    {
        return Ok(None);
    }
    let previous_index =
        entries.iter().enumerate().rev().find_map(|(index, entry)| {
            (entry.get("type").and_then(Value::as_str) == Some("compaction")).then_some(index)
        });
    let mut previous_summary = None;
    let mut boundary_start = 0usize;
    if let Some(index) = previous_index {
        let previous = &entries[index];
        previous_summary = previous.get("summary").and_then(Value::as_str).map(str::to_owned);
        boundary_start = previous
            .get("firstKeptEntryId")
            .and_then(|id| entries.iter().position(|entry| entry.get("id") == Some(id)))
            .unwrap_or(index + 1);
    }
    let context = build_session_messages(entries);
    let tokens_before = estimate_context_tokens(&context, model_id).tokens;
    let keep_recent = settings
        .get("keepRecentTokens")
        .and_then(Value::as_u64)
        .unwrap_or(8_000) as usize;
    let tail_turns = settings.get("tailTurns").and_then(Value::as_u64).unwrap_or(2) as usize;
    let first_kept_index = find_cut_point(
        entries,
        boundary_start,
        entries.len(),
        keep_recent,
        tail_turns,
        model_id,
    );
    if first_kept_index <= boundary_start {
        return Ok(None);
    }
    let first_kept_id = entries[first_kept_index]
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "First kept entry has no UUID - session may need migration".to_owned())?;
    let messages: Vec<Message> = entries[boundary_start..first_kept_index]
        .iter()
        .filter_map(|entry| message_from_entry(entry, false))
        .collect();
    let mut operations = FileOperations::default();
    if let Some(index) = previous_index {
        let previous = &entries[index];
        if previous.get("fromHook").and_then(Value::as_bool) != Some(true) {
            if let Some(read) = previous.pointer("/details/readFiles").and_then(Value::as_array) {
                operations
                    .read
                    .extend(read.iter().filter_map(Value::as_str).map(str::to_owned));
            }
            if let Some(modified) = previous.pointer("/details/modifiedFiles").and_then(Value::as_array) {
                operations
                    .edited
                    .extend(modified.iter().filter_map(Value::as_str).map(str::to_owned));
            }
        }
    }
    extract_file_operations(&messages, &mut operations);
    Ok(Some(json!({
        "firstKeptEntryId": first_kept_id,
        "messagesToSummarize": messages,
        "turnPrefixMessages": [],
        "isSplitTurn": false,
        "tokensBefore": tokens_before,
        "previousSummary": previous_summary,
        "fileOps": {
            "read": operations.read,
            "written": operations.written,
            "edited": operations.edited,
        },
        "settings": settings,
    })))
}

fn text_blocks(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn user_content_text(content: &UserContent) -> String {
    match content {
        UserContent::Text(text) => text.clone(),
        UserContent::Blocks(blocks) => text_blocks(blocks),
    }
}

fn truncate_for_summary(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text.to_owned();
    }
    let prefix: String = text.chars().take(max_chars).collect();
    format!("{prefix}\n\n[... {} more characters truncated]", count - max_chars)
}

fn bash_execution_text(data: &serde_json::Map<String, Value>) -> String {
    let command = data.get("command").and_then(Value::as_str).unwrap_or_default();
    let output = data.get("output").and_then(Value::as_str).unwrap_or_default();
    let mut text = format!("Ran `{command}`\n");
    if output.is_empty() {
        text.push_str("(no output)");
    } else {
        text.push_str(&format!("```\n{output}\n```"));
    }
    if data.get("cancelled").and_then(Value::as_bool) == Some(true) {
        text.push_str("\n\n(command cancelled)");
    } else if let Some(code) = data.get("exitCode").and_then(Value::as_i64) {
        if code != 0 {
            text.push_str(&format!("\n\nCommand exited with code {code}"));
        }
    }
    if data.get("truncated").and_then(Value::as_bool) == Some(true) {
        if let Some(path) = data.get("fullOutputPath").and_then(Value::as_str) {
            text.push_str(&format!("\n\n[Output truncated. Full output: {path}]"));
        }
    }
    text
}

pub fn serialize_conversation(messages: &[Message]) -> String {
    let mut parts = Vec::new();
    for message in messages {
        match message {
            Message::User { content, .. } => {
                let text = user_content_text(content);
                if !text.is_empty() {
                    parts.push(format!("[User]: {text}"));
                }
            }
            Message::Assistant(assistant) => {
                let mut text_parts = Vec::new();
                let mut thinking_parts = Vec::new();
                let mut tool_calls = Vec::new();
                for block in &assistant.content {
                    match block {
                        ContentBlock::Text { text } => text_parts.push(text.clone()),
                        ContentBlock::Thinking { thinking, .. } => thinking_parts.push(thinking.clone()),
                        ContentBlock::ToolCall { name, arguments, .. } => {
                            let args = arguments
                                .as_object()
                                .map(|arguments| {
                                    arguments
                                        .iter()
                                        .map(|(key, value)| {
                                            let encoded = serde_json::to_string(value)
                                                .unwrap_or_else(|_| "[unserializable]".to_owned());
                                            format!("{key}={encoded}")
                                        })
                                        .collect::<Vec<_>>()
                                        .join(", ")
                                })
                                .unwrap_or_default();
                            tool_calls.push(format!("{name}({args})"));
                        }
                        _ => {}
                    }
                }
                if !thinking_parts.is_empty() {
                    parts.push(format!("[Assistant thinking]: {}", thinking_parts.join("\n")));
                }
                if !text_parts.is_empty() {
                    parts.push(format!("[Assistant]: {}", text_parts.join("\n")));
                }
                if !tool_calls.is_empty() {
                    parts.push(format!("[Assistant tool calls]: {}", tool_calls.join("; ")));
                }
            }
            Message::ToolResult(result) => {
                let text = text_blocks(&result.content);
                if !text.is_empty() {
                    parts.push(format!("[Tool result]: {}", truncate_for_summary(&text, 2_000)));
                }
            }
            Message::BashExecution { data } => {
                if data.get("excludeFromContext").and_then(Value::as_bool) != Some(true) {
                    parts.push(format!("[User]: {}", bash_execution_text(data)));
                }
            }
            Message::Custom { data } => {
                let text = match data.get("content") {
                    Some(Value::String(text)) => text.clone(),
                    Some(Value::Array(blocks)) => blocks
                        .iter()
                        .filter_map(|block| block.get("text").and_then(Value::as_str))
                        .collect(),
                    _ => String::new(),
                };
                if !text.is_empty() {
                    parts.push(format!("[User]: {text}"));
                }
            }
            Message::BranchSummary { data } => {
                let summary = data.get("summary").and_then(Value::as_str).unwrap_or_default();
                parts.push(format!("[User]: The following is a summary of a branch that this conversation came back from:\n\n<summary>\n{summary}</summary>"));
            }
            Message::CompactionSummary { data } => {
                let summary = data.get("summary").and_then(Value::as_str).unwrap_or_default();
                parts.push(format!("[User]: The conversation history before this point was compacted into the following summary:\n\n<summary>\n{summary}\n</summary>"));
            }
        }
    }
    parts.join("\n\n")
}

pub fn build_compaction_summary_request(
    preparation: &Value,
    model: &Value,
    cache_context: Option<&Value>,
    custom_instructions: Option<&str>,
    thinking_level: Option<&str>,
) -> Result<Value, String> {
    let messages: Vec<Message> = serde_json::from_value(
        preparation
            .get("messagesToSummarize")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|error| format!("invalid compaction messages: {error}"))?;
    let previous_summary = preparation.get("previousSummary").and_then(Value::as_str);
    let mut base_prompt = if previous_summary.is_some() {
        UPDATE_SUMMARIZATION_PROMPT.to_owned()
    } else {
        SUMMARIZATION_PROMPT.to_owned()
    };
    if let Some(instructions) = custom_instructions.filter(|value| !value.is_empty()) {
        base_prompt.push_str("\n\nAdditional focus: ");
        base_prompt.push_str(instructions);
    }
    let replay_system_prompt = cache_context
        .and_then(|context| context.get("systemPrompt"))
        .and_then(Value::as_str)
        .filter(|prompt| !prompt.is_empty());
    let (system_prompt, request_messages) = if let Some(system_prompt) = replay_system_prompt {
        let mut replay_messages = Vec::new();
        if let Some(summary) = previous_summary {
            replay_messages.push(
                serde_json::from_value(json!({
                    "role": "compactionSummary",
                    "summary": summary,
                    "timestamp": 0,
                }))
                .map_err(|error| format!("invalid previous compaction summary: {error}"))?,
            );
        }
        replay_messages.extend(messages.clone());
        replay_messages.push(Message::user(base_prompt));
        (system_prompt.to_owned(), replay_messages)
    } else {
        let conversation = serialize_conversation(&messages);
        let mut prompt = format!("<conversation>\n{conversation}\n</conversation>\n\n");
        if let Some(summary) = previous_summary {
            prompt.push_str(&format!("<previous-summary>\n{summary}\n</previous-summary>\n\n"));
        }
        prompt.push_str(&base_prompt);
        (SUMMARIZATION_SYSTEM_PROMPT.to_owned(), vec![Message::user(prompt)])
    };

    let reserve = preparation
        .pointer("/settings/reserveTokens")
        .and_then(Value::as_u64)
        .unwrap_or(16_384);
    let mut max_tokens = reserve.saturating_mul(4) / 5;
    if let Some(model_max) = model.get("maxTokens").and_then(Value::as_u64) {
        max_tokens = max_tokens.min(model_max);
    }
    let mut options = json!({"maxTokens": max_tokens});
    if model.get("reasoning").and_then(Value::as_bool) == Some(true) {
        if let Some(level) = thinking_level.filter(|level| *level != "off") {
            options["reasoning"] = json!(level);
        }
    }
    Ok(json!({
        "context": {
            "systemPrompt": system_prompt,
            "messages": request_messages,
        },
        "options": options,
    }))
}

fn compute_file_lists(preparation: &Value) -> (Vec<String>, Vec<String>) {
    let values = |name: &str| {
        preparation
            .pointer(&format!("/fileOps/{name}"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect::<BTreeSet<_>>()
    };
    let read = values("read");
    let modified = values("written")
        .union(&values("edited"))
        .cloned()
        .collect::<BTreeSet<_>>();
    let read_only = read.difference(&modified).cloned().collect();
    (read_only, modified.into_iter().collect())
}

fn format_file_operations(read: &[String], modified: &[String]) -> String {
    let mut sections = Vec::new();
    if !read.is_empty() {
        sections.push(format!("<read-files>\n{}\n</read-files>", read.join("\n")));
    }
    if !modified.is_empty() {
        sections.push(format!("<modified-files>\n{}\n</modified-files>", modified.join("\n")));
    }
    if sections.is_empty() {
        String::new()
    } else {
        format!("\n\n{}", sections.join("\n\n"))
    }
}

pub fn finalize_compaction(preparation: &Value, response: &Value) -> Result<Value, String> {
    let first_kept_id = preparation
        .get("firstKeptEntryId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "First kept entry has no UUID - session may need migration".to_owned())?;
    match response.get("stopReason").and_then(Value::as_str) {
        Some("aborted") => {
            return Err(response
                .get("errorMessage")
                .and_then(Value::as_str)
                .unwrap_or("Summarization aborted")
                .to_owned());
        }
        Some("error") => {
            let message = response
                .get("errorMessage")
                .and_then(Value::as_str)
                .unwrap_or("Unknown error");
            return Err(format!("Summarization failed: {message}"));
        }
        _ => {}
    }
    let mut summary = response
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    let (read_files, modified_files) = compute_file_lists(preparation);
    summary.push_str(&format_file_operations(&read_files, &modified_files));
    Ok(json!({
        "summary": summary,
        "firstKeptEntryId": first_kept_id,
        "tokensBefore": preparation.get("tokensBefore").and_then(Value::as_u64).unwrap_or(0),
        "details": {"readFiles": read_files, "modifiedFiles": modified_files},
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(index: usize, role: &str, content: Value) -> Value {
        let message = if role == "toolResult" {
            json!({
                "role": role,
                "toolCallId": format!("call-{index}"),
                "toolName": "read",
                "content": content,
                "details": {},
                "success": true,
                "isError": false,
                "timestamp": index,
            })
        } else {
            json!({"role": role, "content": content, "timestamp": index})
        };
        json!({
            "type": "message",
            "id": format!("e{index}"),
            "message": message
        })
    }

    #[test]
    fn prepares_history_boundary_and_file_operations() {
        let entries = vec![
            entry(0, "user", json!("old question ".repeat(50))),
            entry(
                1,
                "assistant",
                json!([{"type":"toolCall","id":"r1","name":"read","arguments":{"path":"old.txt"}}]),
            ),
            entry(2, "toolResult", json!([{"type":"text","text":"old result"}])),
            entry(3, "user", json!("recent question")),
            entry(4, "assistant", json!([{"type":"text","text":"recent answer"}])),
        ];
        let preparation = prepare_compaction(&entries, &json!({"keepRecentTokens": 4, "tailTurns": 1}), None)
            .expect("planning succeeds")
            .expect("planning exists");
        assert_eq!(preparation["firstKeptEntryId"], "e3");
        assert_eq!(
            preparation["messagesToSummarize"].as_array().expect("messages").len(),
            3
        );
        assert_eq!(preparation["fileOps"]["read"], json!(["old.txt"]));
    }

    #[test]
    fn skips_when_latest_entry_is_already_a_compaction() {
        assert_eq!(
            prepare_compaction(&[json!({"type":"compaction","id":"c1"})], &json!({}), None).expect("planning succeeds"),
            None
        );
    }

    #[test]
    fn skips_when_every_message_is_inside_the_recent_context_tail() {
        let entries = vec![
            entry(1, "user", json!("only question")),
            entry(2, "assistant", json!([{"type":"text","text":"only answer"}])),
        ];
        assert_eq!(
            prepare_compaction(&entries, &json!({"keepRecentTokens":8_000,"tailTurns":2}), None,)
                .expect("planning succeeds"),
            None
        );
    }

    #[test]
    fn builds_summary_request_and_finalizes_file_lists() {
        let preparation = json!({
            "firstKeptEntryId": "e3",
            "messagesToSummarize": [
                {"role":"user","content":"hello","timestamp":1},
                {"role":"assistant","content":[
                    {"type":"thinking","thinking":"inspect"},
                    {"type":"toolCall","id":"c1","name":"read","arguments":{"path":"a.txt"}}
                ],"timestamp":2}
            ],
            "tokensBefore": 99,
            "previousSummary": "earlier",
            "fileOps": {"read":["a.txt","changed.txt"],"written":["changed.txt"],"edited":[]},
            "settings": {"reserveTokens":100}
        });
        let request = build_compaction_summary_request(
            &preparation,
            &json!({"maxTokens": 50, "reasoning": true}),
            None,
            Some("focus on paths"),
            Some("medium"),
        )
        .expect("summary request");
        let prompt = request["context"]["messages"][0]["content"][0]["text"]
            .as_str()
            .expect("prompt text");
        assert!(prompt.contains("[Assistant thinking]: inspect"));
        assert!(prompt.contains("<previous-summary>\nearlier\n</previous-summary>"));
        assert!(prompt.contains("Additional focus: focus on paths"));
        assert_eq!(request["options"], json!({"maxTokens":50,"reasoning":"medium"}));

        let replay = build_compaction_summary_request(
            &preparation,
            &json!({"maxTokens": 50}),
            Some(&json!({"systemPrompt": "stable agent system"})),
            Some("focus on paths"),
            None,
        )
        .expect("replayed summary request");
        assert_eq!(replay["context"]["systemPrompt"], "stable agent system");
        let replay_messages = replay["context"]["messages"].as_array().expect("replay messages");
        assert_eq!(replay_messages[0]["role"], "compactionSummary");
        assert_eq!(replay_messages[1]["role"], "user");
        assert_eq!(replay_messages[1]["content"], "hello");
        assert!(
            replay_messages.last().expect("instruction")["content"][0]["text"]
                .as_str()
                .expect("instruction text")
                .contains("Additional focus: focus on paths")
        );

        let result = finalize_compaction(
            &preparation,
            &json!({"stopReason":"stop","content":[{"type":"text","text":"checkpoint"}]}),
        )
        .expect("final result");
        assert_eq!(result["firstKeptEntryId"], "e3");
        assert_eq!(result["details"]["readFiles"], json!(["a.txt"]));
        assert_eq!(result["details"]["modifiedFiles"], json!(["changed.txt"]));
        assert_eq!(
            result["summary"],
            "checkpoint\n\n<read-files>\na.txt\n</read-files>\n\n<modified-files>\nchanged.txt\n</modified-files>"
        );
    }

    #[test]
    fn rebuilds_session_context_from_latest_compaction() {
        let entries = vec![
            json!({"type":"thinking_level_change","thinkingLevel":"high"}),
            entry(0, "user", json!("old")),
            entry(1, "assistant", json!([{"type":"text","text":"kept"}])),
            entry(2, "user", json!("new")),
            json!({
                "type":"compaction","id":"c1","summary":"checkpoint","tokensBefore":123,
                "firstKeptEntryId":"e1","timestamp":"1970-01-01T08:00:01+08:00"
            }),
        ];
        let context = build_session_context(&entries);
        assert_eq!(context["thinkingLevel"], "high");
        assert_eq!(context["messages"].as_array().expect("messages").len(), 3);
        assert_eq!(context["messages"][0]["role"], "compactionSummary");
        assert_eq!(context["messages"][0]["timestamp"], 1_000);
        assert_eq!(context["messages"][1]["content"][0]["text"], "kept");
        assert_eq!(context["messages"][2]["content"], "new");
    }
}
