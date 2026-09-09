use crate::NativeToolConfig;
use crate::common::{
    DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, ensure_not_cancelled, fail, format_size, positive_limit, required_string,
    resolve_path, text_output, truncate_head,
};
use async_trait::async_trait;
use base64::Engine;
use eden_agent_core::{ContentBlock, Tool, ToolCall, ToolCallContext, ToolDefinition, ToolFailure, ToolOutput};
use serde_json::json;
use std::fs;

const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

pub struct ReadTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl ReadTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for ReadTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let raw_path = required_string(&call.arguments, "path")?;
        if raw_path.starts_with("builtin://") {
            return Err(fail(
                "invalid_path",
                "builtin:// is an internal resource identifier, not a filesystem path. Use load_skill with the skill ID to load built-in skill instructions.",
            ));
        }
        let path = resolve_path(&self.config, raw_path)?;
        if !path.exists() {
            return Err(fail("path_not_found", format!("Path not found: {}", path.display())));
        }
        if path.is_dir() {
            return Err(fail("is_directory", format!("Is a directory: {}", path.display())));
        }

        let mime = mime_guess::from_path(&path)
            .first_raw()
            .unwrap_or("application/octet-stream");
        if self.config.auto_images && mime.starts_with("image/") {
            let bytes = fs::read(&path).map_err(|error| fail("read_failed", error.to_string()))?;
            ensure_not_cancelled(&context.cancellation)?;
            if bytes.len() > MAX_IMAGE_BYTES {
                return Ok(text_output(
                    format!(
                        "Read image file [{mime}]\nImage is too large to attach ({} bytes; limit {MAX_IMAGE_BYTES} bytes).",
                        bytes.len()
                    ),
                    Some(json!({ "imageTooLarge": true, "size": bytes.len(), "maxBytes": MAX_IMAGE_BYTES })),
                ));
            }
            return Ok(ToolOutput {
                content: vec![
                    ContentBlock::Text {
                        text: format!("Read image file [{mime}]"),
                    },
                    ContentBlock::Image {
                        data: base64::engine::general_purpose::STANDARD.encode(bytes),
                        mime_type: mime.to_owned(),
                        source: None,
                    },
                ],
                success: true,
                ..ToolOutput::default()
            });
        }

        let bytes = fs::read(&path).map_err(|error| fail("read_failed", error.to_string()))?;
        ensure_not_cancelled(&context.cancellation)?;
        let text = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = text.split('\n').collect();
        let offset = call
            .arguments
            .get("offset")
            .and_then(|value| value.as_u64())
            .unwrap_or(1);
        let start = usize::try_from(offset.saturating_sub(1)).unwrap_or(usize::MAX);
        if start >= lines.len() {
            return Err(fail(
                "offset_out_of_range",
                format!("Offset {offset} is beyond end of file ({} lines total)", lines.len()),
            ));
        }
        let requested_limit = call
            .arguments
            .get("limit")
            .and_then(|value| value.as_u64())
            .and_then(|value| usize::try_from(value).ok());
        let end = requested_limit.map_or(lines.len(), |limit| start.saturating_add(limit).min(lines.len()));
        let selected = lines[start..end].join("\n");
        let truncated = truncate_head(&selected, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);
        let start_display = start + 1;
        let mut end_display = start_display + truncated.output_lines.saturating_sub(1);
        let mut next_offset = None;
        let mut was_truncated = false;
        let output = if truncated.first_line_exceeds_limit {
            end_display = start_display;
            was_truncated = true;
            format!(
                "[Line {start_display} is {}, exceeds {} limit. Use bash: sed -n '{start_display}p' {raw_path} | head -c {DEFAULT_MAX_BYTES}]",
                format_size(lines[start].len()),
                format_size(DEFAULT_MAX_BYTES)
            )
        } else if truncated.truncated {
            was_truncated = true;
            next_offset = Some(end_display + 1);
            let suffix = if truncated.truncated_by == Some("lines") {
                format!(
                    "\n\n[Showing lines {start_display}-{end_display} of {}. Use offset={} to continue.]",
                    lines.len(),
                    next_offset.unwrap_or_default()
                )
            } else {
                format!(
                    "\n\n[Showing lines {start_display}-{end_display} of {} ({} limit). Use offset={} to continue.]",
                    lines.len(),
                    format_size(DEFAULT_MAX_BYTES),
                    next_offset.unwrap_or_default()
                )
            };
            format!("{}{suffix}", truncated.content)
        } else if requested_limit.is_some() && end < lines.len() {
            was_truncated = true;
            next_offset = Some(end + 1);
            format!(
                "{}\n\n[{} more lines in file. Use offset={} to continue.]",
                truncated.content,
                lines.len() - end,
                next_offset.unwrap_or_default()
            )
        } else {
            truncated.content.clone()
        };
        let by = if truncated.truncated {
            truncated.truncated_by
        } else if next_offset.is_some() {
            Some("limit")
        } else {
            None
        };
        Ok(text_output(
            output,
            Some(json!({
                "path": path.to_string_lossy(),
                "start_line": start_display,
                "end_line": end_display,
                "total_lines": lines.len(),
                "truncated": was_truncated,
                "truncated_by": by,
                "next_offset": next_offset,
                "output_lines": truncated.output_lines,
                "output_bytes": truncated.output_bytes,
            })),
        ))
    }
}

pub struct LsTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl LsTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for LsTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let raw = call
            .arguments
            .get("path")
            .and_then(|value| value.as_str())
            .unwrap_or(".");
        let limit = positive_limit(&call.arguments, "limit", 500);
        let path = resolve_path(&self.config, raw)?;
        if !path.exists() {
            return Err(fail("path_not_found", format!("Path not found: {}", path.display())));
        }
        if !path.is_dir() {
            return Err(fail("not_directory", format!("Not a directory: {}", path.display())));
        }
        let mut names = Vec::new();
        for entry in fs::read_dir(&path).map_err(|error| fail("list_failed", error.to_string()))? {
            ensure_not_cancelled(&context.cancellation)?;
            let entry = entry.map_err(|error| fail("list_failed", error.to_string()))?;
            let mut name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                name.push('/');
            }
            names.push(name);
        }
        names.sort();
        if names.is_empty() {
            return Ok(text_output("(empty directory)", None));
        }
        let entry_limited = names.len() > limit;
        let selected = names.into_iter().take(limit).collect::<Vec<_>>().join("\n");
        let truncated = truncate_head(&selected, usize::MAX, DEFAULT_MAX_BYTES);
        let mut output = truncated.content;
        let mut notices = Vec::new();
        let mut details = serde_json::Map::new();
        if entry_limited {
            notices.push(format!(
                "{limit} entries limit reached. Use limit={} for more",
                limit.saturating_mul(2)
            ));
            details.insert("entryLimitReached".into(), json!(limit));
        }
        if truncated.truncated {
            notices.push(format!("{} limit reached", format_size(DEFAULT_MAX_BYTES)));
            details.insert("truncation".into(), json!({ "truncatedBy": truncated.truncated_by }));
        }
        if !notices.is_empty() {
            output.push_str(&format!("\n\n[{}]", notices.join(". ")));
        }
        let details = (!details.is_empty()).then_some(serde_json::Value::Object(details));
        Ok(text_output(output, details))
    }
}
