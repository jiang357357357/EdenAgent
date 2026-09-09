use crate::NativeToolConfig;
use crate::common::{ensure_not_cancelled, fail, resolve_path};
use async_trait::async_trait;
use eden_agent_core::{ContentBlock, Tool, ToolCall, ToolCallContext, ToolDefinition, ToolFailure, ToolOutput};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

const DEFAULT_MODEL_PATCH_CHARS: usize = 12_000;
const MAX_MODEL_PATCH_CHARS: usize = 12_000;
const MAX_REVIEW_PATCH_CHARS: usize = 40_000;

fn git(cwd: &Path, arguments: &[&str]) -> Result<String, ToolFailure> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(cwd)
        .output()
        .map_err(|error| fail("git_unavailable", error.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(fail(
            "git_failed",
            if stderr.is_empty() {
                "Unable to inspect workspace diff".to_owned()
            } else {
                stderr
            },
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn patches_by_path(patch: &str) -> HashMap<String, String> {
    let mut sections = HashMap::new();
    let mut current_path: Option<String> = None;
    let mut current = String::new();
    for line in patch.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            if let Some(path) = current_path.take() {
                sections.insert(path, std::mem::take(&mut current));
            }
            let fields: Vec<&str> = line.trim_end().splitn(4, ' ').collect();
            current_path = fields
                .get(3)
                .and_then(|value| value.strip_prefix("b/"))
                .map(str::to_owned);
            current.push_str(line);
        } else if current_path.is_some() {
            current.push_str(line);
        }
    }
    if let Some(path) = current_path {
        sections.insert(path, current);
    }
    sections
}

fn line_counts(patch: &str) -> (usize, usize) {
    let mut additions = 0;
    let mut deletions = 0;
    for line in patch.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }
    (additions, deletions)
}

fn bounded_text(text: &str, limit: usize) -> (String, bool) {
    let count = text.chars().count();
    if count <= limit {
        return (text.to_owned(), false);
    }
    if limit == 0 {
        return (String::new(), true);
    }
    let marker = format!(
        "\n...[truncated {} diff chars; call get_diff with a narrower path]",
        count - limit
    );
    let marker_chars = marker.chars().count();
    if marker_chars >= limit {
        return (text.chars().take(limit).collect(), true);
    }
    let keep = limit - marker_chars;
    let mut bounded = text.chars().take(keep).collect::<String>();
    bounded.push_str(&marker);
    (bounded, true)
}

pub struct GetDiffTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl GetDiffTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for GetDiffTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let scope = call
            .arguments
            .get("scope")
            .and_then(Value::as_str)
            .unwrap_or("working_tree");
        if !matches!(scope, "working_tree" | "staged" | "all") {
            return Err(fail("invalid_arguments", "scope must be working_tree, staged, or all"));
        }
        let raw_path = call.arguments.get("path").and_then(Value::as_str).unwrap_or(".");
        let target = resolve_path(&self.config, raw_path)?;
        let probe = if target.is_dir() {
            target.as_path()
        } else {
            target.parent().unwrap_or(self.config.workspace_root())
        };
        let git_root_text = git(probe, &["rev-parse", "--show-toplevel"])?;
        let git_root =
            std::fs::canonicalize(git_root_text.trim()).map_err(|error| fail("git_root_invalid", error.to_string()))?;
        let relative_path = target
            .strip_prefix(&git_root)
            .map_err(|_| fail("path_outside_git_workspace", "path must be inside the Git workspace"))?;
        let relative = if relative_path.as_os_str().is_empty() {
            ".".to_owned()
        } else {
            relative_path.to_string_lossy().replace('\\', "/")
        };

        ensure_not_cancelled(&context.cancellation)?;
        let mut diff_arguments = vec!["diff", "--no-ext-diff", "--unified=3"];
        if scope == "staged" {
            diff_arguments.push("--cached");
        } else if scope == "all" {
            diff_arguments.push("HEAD");
        }
        diff_arguments.extend(["--", relative.as_str()]);
        let patch = git(&git_root, &diff_arguments)?;
        let sections = patches_by_path(&patch);
        let requested_model_chars = call
            .arguments
            .get("max_chars")
            .and_then(Value::as_u64)
            .map_or(DEFAULT_MODEL_PATCH_CHARS, |value| value as usize)
            .clamp(1_000, MAX_MODEL_PATCH_CHARS);
        let (model_patch, model_patch_truncated) = bounded_text(&patch, requested_model_chars);
        let status = git(
            &git_root,
            &["status", "--short", "--untracked-files=all", "--", relative.as_str()],
        )?;
        let mut files = Vec::new();
        let mut structured_files = Vec::new();
        let mut review_patch_chars = 0_usize;
        let mut review_truncated = false;
        for line in status.lines().filter(|line| line.len() >= 4) {
            let code = &line[..2];
            if (scope == "staged" && matches!(code.as_bytes()[0], b' ' | b'?'))
                || (scope == "working_tree" && code.as_bytes()[1] == b' ' && code != "??")
            {
                continue;
            }
            let relevant_code = match scope {
                "staged" => &code[..1],
                "working_tree" => &code[1..],
                _ => code,
            };
            let raw = &line[3..];
            let (path, move_path) = raw
                .split_once(" -> ")
                .map_or((raw, None), |(from, to)| (from, Some(to)));
            let effective = move_path.unwrap_or(path);
            let file_patch = sections
                .get(effective)
                .or_else(|| sections.get(path))
                .cloned()
                .unwrap_or_default();
            let (additions, deletions) = line_counts(&file_patch);
            let status_name = if relevant_code.contains('R') {
                "renamed"
            } else if relevant_code.contains('A') || relevant_code.contains('?') {
                "added"
            } else if relevant_code.contains('D') {
                "deleted"
            } else {
                "modified"
            };
            let remaining = MAX_REVIEW_PATCH_CHARS.saturating_sub(review_patch_chars);
            let (review_patch, file_patch_truncated) = bounded_text(&file_patch, remaining);
            review_patch_chars = review_patch_chars.saturating_add(review_patch.chars().count());
            review_truncated |= file_patch_truncated || (remaining == 0 && !file_patch.is_empty());
            files.push(json!({
                "path": path,
                "movePath": move_path,
                "status": status_name,
                "patch":review_patch,
                "patchChars":file_patch.chars().count(),
                "patchTruncated":file_patch_truncated || (remaining == 0 && !file_patch.is_empty()),
                "additions": additions,
                "deletions": deletions,
            }));
            structured_files.push(json!({
                "path":path,
                "movePath":move_path,
                "status":status_name,
                "patchChars":file_patch.chars().count(),
                "additions":additions,
                "deletions":deletions,
            }));
        }
        review_truncated |= review_patch_chars < patch.chars().count();
        let details = json!({
            "kind": "workspace_diff",
            "files": files,
            "scope": scope,
            "root": git_root.to_string_lossy(),
            "path": relative,
            "patchChars":patch.chars().count(),
            "patchTruncated":review_truncated,
        });
        let count = details["files"].as_array().map_or(0, Vec::len);
        let summary = if model_patch_truncated {
            format!("{count} changed file(s); diff preview was bounded to {requested_model_chars} characters")
        } else {
            format!("{count} changed file(s)")
        };
        let content = if model_patch.trim().is_empty() {
            summary
        } else {
            format!("{summary}\n\n{model_patch}")
        };
        Ok(ToolOutput {
            content: vec![ContentBlock::Text { text: content }],
            details,
            structured_content: Some(json!({
                "kind":"workspace_diff_summary",
                "files":structured_files,
                "scope":scope,
                "path":relative,
                "patchChars":patch.chars().count(),
                "patchPreviewTruncated":model_patch_truncated,
            })),
            success: true,
            ..ToolOutput::default()
        })
    }
}
