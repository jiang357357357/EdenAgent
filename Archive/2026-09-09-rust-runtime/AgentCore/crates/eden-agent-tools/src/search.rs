use crate::NativeToolConfig;
use crate::common::{
    DEFAULT_MAX_BYTES, ensure_not_cancelled, fail, format_size, positive_limit, required_string, resolve_path,
    text_output, truncate_head, truncate_line,
};
use async_trait::async_trait;
use eden_agent_core::{Tool, ToolCall, ToolCallContext, ToolDefinition, ToolFailure, ToolOutput};
use globset::{Glob, GlobMatcher};
use ignore::WalkBuilder;
use regex::{Regex, RegexBuilder};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

fn glob_matcher(pattern: &str) -> Result<GlobMatcher, ToolFailure> {
    Glob::new(pattern)
        .map(|glob| glob.compile_matcher())
        .map_err(|error| fail("invalid_glob", error.to_string()))
}

fn matches_glob(matcher: &GlobMatcher, relative: &Path) -> bool {
    matcher.is_match(relative)
        || relative
            .file_name()
            .is_some_and(|name| matcher.is_match(Path::new(name)))
}

fn files_under(root: &Path, cancellation: &tokio_util::sync::CancellationToken) -> Result<Vec<PathBuf>, ToolFailure> {
    if root.is_file() {
        return Ok(vec![root.to_path_buf()]);
    }
    let mut files = Vec::new();
    for result in WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .ignore(true)
        .require_git(false)
        .follow_links(false)
        .build()
    {
        ensure_not_cancelled(cancellation)?;
        let Ok(entry) = result else { continue };
        if entry.file_type().is_some_and(|kind| kind.is_file()) {
            files.push(entry.into_path());
        }
    }
    files.sort();
    Ok(files)
}

fn relative_display(path: &Path, root: &Path) -> String {
    if root.is_dir() {
        path.strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    } else {
        path.file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy()
            .into_owned()
    }
}

pub struct FindTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl FindTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for FindTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let pattern = required_string(&call.arguments, "pattern")?;
        let matcher = glob_matcher(pattern)?;
        let raw = call
            .arguments
            .get("path")
            .and_then(|value| value.as_str())
            .unwrap_or(".");
        let limit = positive_limit(&call.arguments, "limit", 1_000);
        let root = resolve_path(&self.config, raw)?;
        if !root.exists() {
            return Err(fail("path_not_found", format!("Path not found: {}", root.display())));
        }
        let mut results = Vec::new();
        let mut limit_reached = false;
        for path in files_under(&root, &context.cancellation)? {
            let relative = relative_display(&path, &root);
            if !matches_glob(&matcher, Path::new(&relative)) {
                continue;
            }
            if results.len() == limit {
                limit_reached = true;
                break;
            }
            results.push(relative);
        }
        if results.is_empty() {
            return Ok(text_output("No files found matching pattern", None));
        }
        let truncated = truncate_head(&results.join("\n"), usize::MAX, DEFAULT_MAX_BYTES);
        let mut output = truncated.content;
        let mut notices = Vec::new();
        let mut details = serde_json::Map::new();
        if limit_reached {
            notices.push(format!(
                "{limit} results limit reached. Use limit={} for more, or refine pattern",
                limit.saturating_mul(2)
            ));
            details.insert("resultLimitReached".into(), json!(limit));
        }
        if truncated.truncated {
            notices.push(format!("{} limit reached", format_size(DEFAULT_MAX_BYTES)));
            details.insert("truncation".into(), json!({ "truncatedBy": truncated.truncated_by }));
        }
        if !notices.is_empty() {
            output.push_str(&format!("\n\n[{}]", notices.join(". ")));
        }
        Ok(text_output(output, (!details.is_empty()).then_some(details.into())))
    }
}

pub struct GrepTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl GrepTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

fn compile_pattern(pattern: &str, literal: bool, ignore_case: bool) -> Result<Regex, ToolFailure> {
    let source = if literal {
        regex::escape(pattern)
    } else {
        pattern.to_owned()
    };
    RegexBuilder::new(&source)
        .case_insensitive(ignore_case)
        .build()
        .map_err(|error| fail("invalid_pattern", error.to_string()))
}

#[async_trait]
impl Tool for GrepTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let pattern = required_string(&call.arguments, "pattern")?;
        let ignore_case = call
            .arguments
            .get("ignoreCase")
            .or_else(|| call.arguments.get("ignore_case"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let literal = call
            .arguments
            .get("literal")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let regex = compile_pattern(pattern, literal, ignore_case)?;
        let glob = call
            .arguments
            .get("glob")
            .and_then(|value| value.as_str())
            .map(glob_matcher)
            .transpose()?;
        let raw = call
            .arguments
            .get("path")
            .and_then(|value| value.as_str())
            .unwrap_or(".");
        let root = resolve_path(&self.config, raw)?;
        if !root.exists() {
            return Err(fail("path_not_found", format!("Path not found: {}", root.display())));
        }
        let match_limit = positive_limit(&call.arguments, "limit", 100);
        let context_lines = call
            .arguments
            .get("context")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as usize;
        let mut output_lines = Vec::new();
        let mut matches = 0usize;
        let mut match_limit_reached = false;
        let mut lines_truncated = false;

        'files: for path in files_under(&root, &context.cancellation)? {
            let relative = relative_display(&path, &root);
            if glob
                .as_ref()
                .is_some_and(|matcher| !matches_glob(matcher, Path::new(&relative)))
            {
                continue;
            }
            let bytes = match fs::read(&path) {
                Ok(bytes) if !bytes.contains(&0) => bytes,
                _ => continue,
            };
            let text = String::from_utf8_lossy(&bytes);
            let lines: Vec<&str> = text.lines().collect();
            for (index, line) in lines.iter().enumerate() {
                ensure_not_cancelled(&context.cancellation)?;
                if !regex.is_match(line) {
                    continue;
                }
                if matches == match_limit {
                    match_limit_reached = true;
                    break 'files;
                }
                matches += 1;
                let line_number = index + 1;
                if context_lines == 0 {
                    let (line, was_truncated) = truncate_line(line.trim_end_matches('\r'));
                    lines_truncated |= was_truncated;
                    output_lines.push(format!("{relative}:{line_number}: {line}"));
                    continue;
                }
                let start = index.saturating_sub(context_lines);
                let end = index.saturating_add(context_lines + 1).min(lines.len());
                for (current, context_line) in lines.iter().enumerate().take(end).skip(start) {
                    let (line, was_truncated) = truncate_line(context_line.trim_end_matches('\r'));
                    lines_truncated |= was_truncated;
                    let number = current + 1;
                    let separator = if current == index { ':' } else { '-' };
                    output_lines.push(format!("{relative}{separator}{number}{separator} {line}"));
                }
            }
        }
        if matches == 0 {
            return Ok(text_output("No matches found", None));
        }
        let truncated = truncate_head(&output_lines.join("\n"), usize::MAX, DEFAULT_MAX_BYTES);
        let mut output = truncated.content;
        let mut notices = Vec::new();
        let mut details = serde_json::Map::new();
        if match_limit_reached {
            notices.push(format!(
                "{match_limit} matches limit reached. Use limit={} for more, or refine pattern",
                match_limit.saturating_mul(2)
            ));
            details.insert("matchLimitReached".into(), json!(match_limit));
        }
        if truncated.truncated {
            notices.push(format!("{} limit reached", format_size(DEFAULT_MAX_BYTES)));
            details.insert("truncation".into(), json!({ "truncatedBy": truncated.truncated_by }));
        }
        if lines_truncated {
            notices.push("Some lines truncated to 500 chars. Use read tool to see full lines".to_owned());
            details.insert("linesTruncated".into(), json!(true));
        }
        if !notices.is_empty() {
            output.push_str(&format!("\n\n[{}]", notices.join(". ")));
        }
        Ok(text_output(output, (!details.is_empty()).then_some(details.into())))
    }
}
