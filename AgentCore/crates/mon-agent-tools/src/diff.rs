use crate::NativeToolConfig;
use crate::common::{ensure_not_cancelled, fail, resolve_path, text_output};
use async_trait::async_trait;
use mon_agent_core::{Tool, ToolCall, ToolCallContext, ToolDefinition, ToolFailure, ToolOutput};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

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
        let status = git(
            &git_root,
            &["status", "--short", "--untracked-files=all", "--", relative.as_str()],
        )?;
        let mut files = Vec::new();
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
            files.push(json!({
                "path": path,
                "movePath": move_path,
                "status": status_name,
                "patch": file_patch,
                "additions": additions,
                "deletions": deletions,
            }));
        }
        let details = json!({
            "kind": "workspace_diff",
            "files": files,
            "patch": patch,
            "scope": scope,
            "root": git_root.to_string_lossy(),
            "path": relative,
        });
        let count = details["files"].as_array().map_or(0, Vec::len);
        Ok(text_output(format!("{count} changed file(s)"), Some(details)))
    }
}
