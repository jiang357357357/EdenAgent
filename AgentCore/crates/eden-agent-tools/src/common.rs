use eden_agent_core::{ContentBlock, ToolFailure, ToolOutput};
use serde_json::{Value, json};
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tokio_util::sync::CancellationToken;

pub const DEFAULT_MAX_LINES: usize = 2_000;
pub const DEFAULT_MAX_BYTES: usize = 50 * 1024;
pub const GREP_MAX_LINE_LENGTH: usize = 500;

pub fn fail(code: &str, message: impl Into<String>) -> ToolFailure {
    ToolFailure::new(code, message)
}

pub fn ensure_not_cancelled(cancellation: &CancellationToken) -> Result<(), ToolFailure> {
    if cancellation.is_cancelled() {
        Err(fail("operation_aborted", "Operation aborted"))
    } else {
        Ok(())
    }
}

pub fn required_string<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolFailure> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| fail("invalid_arguments", format!("{key} is required and must be a string")))
}

pub fn positive_limit(args: &Value, key: &str, default: usize) -> usize {
    args.get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

pub fn resolve_path(config: &crate::NativeToolConfig, raw: &str) -> Result<PathBuf, ToolFailure> {
    let mut value = raw.trim().trim_start_matches('@').replace('\u{202f}', " ");
    if value.is_empty() {
        value.push('.');
    }
    let root = canonicalize_allow_missing(config.workspace_root())?;
    let input = Path::new(&value);
    let candidate = if input.is_absolute() {
        input.to_path_buf()
    } else {
        root.join(input)
    };
    let resolved = canonicalize_allow_missing(&candidate)?;
    if !config.allow_outside_cwd && !resolved.starts_with(&root) {
        return Err(fail(
            "path_outside_workspace",
            format!(
                "Path is outside the workspace: {raw}. Workspace root: {}",
                root.display()
            ),
        ));
    }
    Ok(resolved)
}

fn canonicalize_allow_missing(path: &Path) -> Result<PathBuf, ToolFailure> {
    let absolute = absolute_lexical(path)?;
    let mut cursor = absolute.as_path();
    let mut missing: Vec<OsString> = Vec::new();
    while !cursor.exists() {
        let Some(name) = cursor.file_name() else {
            return Err(fail("invalid_path", format!("Cannot resolve path: {}", path.display())));
        };
        missing.push(name.to_os_string());
        let Some(parent) = cursor.parent() else {
            return Err(fail("invalid_path", format!("Cannot resolve path: {}", path.display())));
        };
        cursor = parent;
    }
    let mut resolved = fs::canonicalize(cursor).map_err(|error| fail("invalid_path", error.to_string()))?;
    for component in missing.into_iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

fn absolute_lexical(path: &Path) -> Result<PathBuf, ToolFailure> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| fail("cwd_error", error.to_string()))?
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Ok(normalized)
}

pub fn text_output(text: impl Into<String>, details: Option<Value>) -> ToolOutput {
    ToolOutput {
        content: vec![ContentBlock::Text { text: text.into() }],
        details: details.clone().unwrap_or_else(|| json!({})),
        structured_content: details,
        success: true,
        ..ToolOutput::default()
    }
}

#[derive(Debug)]
pub struct Truncation {
    pub content: String,
    pub truncated: bool,
    pub truncated_by: Option<&'static str>,
    pub output_lines: usize,
    pub output_bytes: usize,
    pub first_line_exceeds_limit: bool,
}

pub fn truncate_head(content: &str, max_lines: usize, max_bytes: usize) -> Truncation {
    let total_bytes = content.len();
    let lines: Vec<&str> = content.split('\n').collect();
    let total_lines = lines.len();
    if total_lines <= max_lines && total_bytes <= max_bytes {
        return Truncation {
            content: content.to_owned(),
            truncated: false,
            truncated_by: None,
            output_lines: total_lines,
            output_bytes: total_bytes,
            first_line_exceeds_limit: false,
        };
    }
    if lines.first().is_some_and(|line| line.len() > max_bytes) {
        return Truncation {
            content: String::new(),
            truncated: true,
            truncated_by: Some("bytes"),
            output_lines: 0,
            output_bytes: 0,
            first_line_exceeds_limit: true,
        };
    }
    let mut selected = Vec::new();
    let mut bytes = 0usize;
    let mut by = "lines";
    for (index, line) in lines.iter().take(max_lines).enumerate() {
        let next = line.len() + usize::from(index > 0);
        if bytes + next > max_bytes {
            by = "bytes";
            break;
        }
        selected.push(*line);
        bytes += next;
    }
    let output = selected.join("\n");
    Truncation {
        output_lines: selected.len(),
        output_bytes: output.len(),
        content: output,
        truncated: true,
        truncated_by: Some(by),
        first_line_exceeds_limit: false,
    }
}

pub fn format_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{bytes}B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1}KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

pub fn truncate_line(line: &str) -> (String, bool) {
    if line.chars().count() <= GREP_MAX_LINE_LENGTH {
        return (line.to_owned(), false);
    }
    let prefix: String = line.chars().take(GREP_MAX_LINE_LENGTH).collect();
    (format!("{prefix}... [truncated]"), true)
}
