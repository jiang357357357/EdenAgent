use crate::NativeToolConfig;
use crate::common::{ensure_not_cancelled, fail, required_string, resolve_path, text_output};
use async_trait::async_trait;
use eden_agent_core::{PermissionRequest, Tool, ToolCall, ToolCallContext, ToolDefinition, ToolFailure, ToolOutput};
use serde_json::{Value, json};
use similar::TextDiff;
use std::fs;
use std::sync::Mutex;

pub(crate) static FILE_MUTATION_LOCK: Mutex<()> = Mutex::new(());

fn unified_patch(path: &str, old: &str, new: &str) -> String {
    TextDiff::from_lines(old, new)
        .unified_diff()
        .context_radius(4)
        .header(path, path)
        .to_string()
}

fn workspace_diff(path: &str, status: &str, patch: String, first_changed_line: Option<usize>) -> Value {
    let mut additions = 0usize;
    let mut deletions = 0usize;
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
    let mut file = json!({
        "path": path,
        "status": status,
        "patch": patch,
        "additions": additions,
        "deletions": deletions,
    });
    if let Some(line) = first_changed_line {
        file["firstChangedLine"] = json!(line);
    }
    json!({ "kind": "workspace_diff", "files": [file], "patch": patch })
}

pub struct WriteTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl WriteTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for WriteTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    fn permission_request(&self, arguments: &Value) -> Option<PermissionRequest> {
        let path = arguments.get("path").and_then(Value::as_str).unwrap_or("<unknown>");
        Some(PermissionRequest {
            permission: "workspace.write".to_owned(),
            patterns: vec![path.to_owned()],
            always: vec![path.to_owned()],
        })
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let raw_path = required_string(&call.arguments, "path")?;
        let content = call
            .arguments
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| fail("invalid_arguments", "content is required and must be a string"))?;
        let path = resolve_path(&self.config, raw_path)?;
        let _guard = FILE_MUTATION_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        ensure_not_cancelled(&context.cancellation)?;
        let existed = path.is_file();
        let old = if existed {
            String::from_utf8_lossy(&fs::read(&path).map_err(|error| fail("read_failed", error.to_string()))?)
                .into_owned()
        } else {
            String::new()
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| fail("create_directory_failed", error.to_string()))?;
        }
        fs::write(&path, content.as_bytes()).map_err(|error| fail("write_failed", error.to_string()))?;
        let patch = unified_patch(raw_path, &old, content);
        let details = workspace_diff(raw_path, if existed { "modified" } else { "added" }, patch, None);
        Ok(text_output(
            format!("Successfully wrote {} bytes to {raw_path}", content.chars().count()),
            Some(details),
        ))
    }
}

#[derive(Debug)]
struct Edit {
    old_text: String,
    new_text: String,
}

fn edit_value<'a>(value: &'a Value, names: &[&str]) -> Option<&'a str> {
    names.iter().find_map(|name| value.get(*name).and_then(Value::as_str))
}

fn parse_edits(args: &Value) -> Result<Vec<Edit>, ToolFailure> {
    let mut raw_edits: Vec<Value> = match args.get("edits") {
        Some(Value::Array(values)) => values.clone(),
        Some(Value::String(encoded)) => serde_json::from_str::<Vec<Value>>(encoded).unwrap_or_default(),
        _ => Vec::new(),
    };
    if let (Some(old), Some(new)) = (
        edit_value(args, &["oldText", "oldString", "old_text"]),
        edit_value(args, &["newText", "newString", "new_text"]),
    ) {
        raw_edits.push(json!({ "oldText": old, "newText": new }));
    }
    if raw_edits.is_empty() {
        return Err(fail(
            "invalid_arguments",
            "Edit tool input is invalid. edits must contain at least one replacement.",
        ));
    }
    raw_edits
        .into_iter()
        .map(|value| {
            let old = edit_value(&value, &["oldText", "oldString", "old_text"]);
            let new = edit_value(&value, &["newText", "newString", "new_text"]);
            match (old, new) {
                (Some(old), Some(new)) => Ok(Edit {
                    old_text: normalize_lf(old),
                    new_text: normalize_lf(new),
                }),
                _ => Err(fail(
                    "invalid_arguments",
                    "Edit tool input is invalid. Each edit must contain oldText and newText strings.",
                )),
            }
        })
        .collect()
}

fn normalize_lf(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n")
}

fn occurrence_positions(content: &str, needle: &str) -> Vec<usize> {
    content.match_indices(needle).map(|(index, _)| index).collect()
}

fn first_changed_line(old: &str, new: &str) -> Option<usize> {
    old.split('\n')
        .zip(new.split('\n'))
        .position(|(left, right)| left != right)
        .map(|index| index + 1)
        .or_else(|| (old != new).then(|| old.lines().count().min(new.lines().count()) + 1))
}

pub struct EditTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl EditTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for EditTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    fn permission_request(&self, arguments: &Value) -> Option<PermissionRequest> {
        let path = arguments.get("path").and_then(Value::as_str).unwrap_or("<unknown>");
        Some(PermissionRequest {
            permission: "workspace.write".to_owned(),
            patterns: vec![path.to_owned()],
            always: vec![path.to_owned()],
        })
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let raw_path = required_string(&call.arguments, "path")?;
        let edits = parse_edits(&call.arguments)?;
        let path = resolve_path(&self.config, raw_path)?;
        let _guard = FILE_MUTATION_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        ensure_not_cancelled(&context.cancellation)?;
        if !path.exists() {
            return Err(fail(
                "path_not_found",
                format!("Could not edit file: {raw_path}. Error code: ENOENT."),
            ));
        }
        if !path.is_file() {
            return Err(fail(
                "is_directory",
                format!("Could not edit file: {raw_path}. Error code: EISDIR."),
            ));
        }
        let raw = String::from_utf8_lossy(&fs::read(&path).map_err(|error| fail("read_failed", error.to_string()))?)
            .into_owned();
        let (bom, without_bom) = raw
            .strip_prefix('\u{feff}')
            .map_or(("", raw.as_str()), |value| ("\u{feff}", value));
        let ending = if without_bom
            .find("\r\n")
            .is_some_and(|crlf| without_bom.find('\n').is_some_and(|lf| crlf < lf))
        {
            "\r\n"
        } else {
            "\n"
        };
        let base = normalize_lf(without_bom);
        let mut replacements = Vec::with_capacity(edits.len());
        for (index, edit) in edits.iter().enumerate() {
            if edit.old_text.is_empty() {
                let message = if edits.len() == 1 {
                    format!("oldText must not be empty in {raw_path}.")
                } else {
                    format!("edits[{index}].oldText must not be empty in {raw_path}.")
                };
                return Err(fail("empty_old_text", message));
            }
            let positions = occurrence_positions(&base, &edit.old_text);
            if positions.is_empty() {
                let message = if edits.len() == 1 {
                    format!(
                        "Could not find the exact text in {raw_path}. The old text must match exactly including all whitespace and newlines."
                    )
                } else {
                    format!(
                        "Could not find edits[{index}] in {raw_path}. The oldText must match exactly including all whitespace and newlines."
                    )
                };
                return Err(fail("text_not_found", message));
            }
            if positions.len() > 1 {
                let message = if edits.len() == 1 {
                    format!(
                        "Found {} occurrences of the text in {raw_path}. The text must be unique. Please provide more context to make it unique.",
                        positions.len()
                    )
                } else {
                    format!(
                        "Found {} occurrences of edits[{index}] in {raw_path}. Each oldText must be unique. Please provide more context to make it unique.",
                        positions.len()
                    )
                };
                return Err(fail("ambiguous_text", message));
            }
            replacements.push((positions[0], index));
        }
        replacements.sort_by_key(|(position, _)| *position);
        for pair in replacements.windows(2) {
            let (previous_position, previous_index) = pair[0];
            let (current_position, current_index) = pair[1];
            if previous_position + edits[previous_index].old_text.len() > current_position {
                return Err(fail(
                    "overlapping_edits",
                    format!(
                        "edits[{previous_index}] and edits[{current_index}] overlap in {raw_path}. Merge them into one edit or target disjoint regions."
                    ),
                ));
            }
        }
        let mut result = base.clone();
        for (position, index) in replacements.into_iter().rev() {
            let edit = &edits[index];
            result.replace_range(position..position + edit.old_text.len(), &edit.new_text);
        }
        if result == base {
            return Err(fail(
                "no_change",
                format!("No changes made to {raw_path}. The replacements produced identical content."),
            ));
        }
        let changed_line = first_changed_line(&base, &result);
        let restored = if ending == "\r\n" {
            result.replace('\n', "\r\n")
        } else {
            result.clone()
        };
        fs::write(&path, format!("{bom}{restored}").as_bytes())
            .map_err(|error| fail("write_failed", error.to_string()))?;
        ensure_not_cancelled(&context.cancellation)?;
        let patch = unified_patch(raw_path, &base, &result);
        let details = workspace_diff(raw_path, "modified", patch, changed_line);
        Ok(text_output(
            format!("Successfully replaced {} block(s) in {raw_path}.", edits.len()),
            Some(details),
        ))
    }
}
