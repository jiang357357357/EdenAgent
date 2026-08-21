use crate::NativeToolConfig;
use crate::common::{ensure_not_cancelled, fail, required_string, resolve_path, text_output};
use crate::mutation::FILE_MUTATION_LOCK;
use async_trait::async_trait;
use mon_agent_core::{PermissionRequest, Tool, ToolCall, ToolCallContext, ToolDefinition, ToolFailure, ToolOutput};
use serde_json::{Value, json};
use similar::TextDiff;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug)]
struct PatchChunk {
    old_lines: Vec<String>,
    new_lines: Vec<String>,
    context: Option<String>,
    end_of_file: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HunkKind {
    Add,
    Update,
    Delete,
}

#[derive(Clone, Debug)]
struct PatchHunk {
    kind: HunkKind,
    path: String,
    contents: String,
    move_path: Option<String>,
    chunks: Vec<PatchChunk>,
}

fn parse_patch(patch: &str) -> Result<Vec<PatchHunk>, ToolFailure> {
    let normalized = patch.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.trim().split('\n').collect();
    let begin = lines
        .iter()
        .position(|line| *line == "*** Begin Patch")
        .ok_or_else(|| fail("invalid_patch", "Invalid patch format: missing Begin/End markers"))?;
    let end = lines
        .iter()
        .enumerate()
        .skip(begin + 1)
        .find_map(|(index, line)| (*line == "*** End Patch").then_some(index))
        .ok_or_else(|| fail("invalid_patch", "Invalid patch format: missing Begin/End markers"))?;
    if begin + 1 == end {
        return Err(fail("empty_patch", "Patch is empty"));
    }
    let mut hunks = Vec::new();
    let mut index = begin + 1;
    while index < end {
        let line = lines[index];
        if let Some(raw_path) = line.strip_prefix("*** Add File:") {
            let path = raw_path.trim();
            if path.is_empty() {
                return Err(fail("invalid_patch", "Add File path is required"));
            }
            index += 1;
            let mut content = Vec::new();
            while index < end && !lines[index].starts_with("*** ") {
                let Some(value) = lines[index].strip_prefix('+') else {
                    return Err(fail(
                        "invalid_patch",
                        format!("Invalid add-file line for {path}: {}", lines[index]),
                    ));
                };
                content.push(value);
                index += 1;
            }
            hunks.push(PatchHunk {
                kind: HunkKind::Add,
                path: path.to_owned(),
                contents: if content.is_empty() {
                    String::new()
                } else {
                    format!("{}\n", content.join("\n"))
                },
                move_path: None,
                chunks: Vec::new(),
            });
            continue;
        }
        if let Some(raw_path) = line.strip_prefix("*** Delete File:") {
            let path = raw_path.trim();
            if path.is_empty() {
                return Err(fail("invalid_patch", "Delete File path is required"));
            }
            hunks.push(PatchHunk {
                kind: HunkKind::Delete,
                path: path.to_owned(),
                contents: String::new(),
                move_path: None,
                chunks: Vec::new(),
            });
            index += 1;
            continue;
        }
        if let Some(raw_path) = line.strip_prefix("*** Update File:") {
            let path = raw_path.trim();
            if path.is_empty() {
                return Err(fail("invalid_patch", "Update File path is required"));
            }
            index += 1;
            let move_path = if index < end {
                lines[index].strip_prefix("*** Move to:").map(|value| {
                    index += 1;
                    value.trim().to_owned()
                })
            } else {
                None
            };
            let mut chunks = Vec::new();
            while index < end && !lines[index].starts_with("*** ") {
                let Some(header) = lines[index].strip_prefix("@@") else {
                    return Err(fail(
                        "invalid_patch",
                        format!("Expected @@ chunk header for {path}, got: {}", lines[index]),
                    ));
                };
                let context = (!header.trim().is_empty()).then(|| header.trim().to_owned());
                index += 1;
                let mut old_lines = Vec::new();
                let mut new_lines = Vec::new();
                let mut end_of_file = false;
                while index < end
                    && !lines[index].starts_with("@@")
                    && (!lines[index].starts_with("*** ") || lines[index] == "*** End of File")
                {
                    let change = lines[index];
                    if change == "*** End of File" {
                        end_of_file = true;
                    } else if let Some(value) = change.strip_prefix(' ') {
                        old_lines.push(value.to_owned());
                        new_lines.push(value.to_owned());
                    } else if let Some(value) = change.strip_prefix('-') {
                        old_lines.push(value.to_owned());
                    } else if let Some(value) = change.strip_prefix('+') {
                        new_lines.push(value.to_owned());
                    } else {
                        return Err(fail(
                            "invalid_patch",
                            format!("Invalid update line for {path}: {change}"),
                        ));
                    }
                    index += 1;
                }
                if old_lines.is_empty() && new_lines.is_empty() {
                    return Err(fail("invalid_patch", format!("Empty update chunk for {path}")));
                }
                chunks.push(PatchChunk {
                    old_lines,
                    new_lines,
                    context,
                    end_of_file,
                });
            }
            if chunks.is_empty() {
                return Err(fail(
                    "invalid_patch",
                    format!("Update File requires at least one chunk: {path}"),
                ));
            }
            hunks.push(PatchHunk {
                kind: HunkKind::Update,
                path: path.to_owned(),
                contents: String::new(),
                move_path: move_path.filter(|value| !value.is_empty()),
                chunks,
            });
            continue;
        }
        return Err(fail("invalid_patch", format!("Invalid patch directive: {line}")));
    }
    Ok(hunks)
}

fn fuzzy_normalize(value: &str) -> String {
    value
        .nfkc()
        .map(|character| match character {
            '\u{2018}' | '\u{2019}' | '\u{201a}' | '\u{201b}' => '\'',
            '\u{201c}' | '\u{201d}' | '\u{201e}' | '\u{201f}' => '"',
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}' | '\u{2212}' => '-',
            '\u{00a0}' | '\u{2002}'..='\u{200a}' | '\u{202f}' | '\u{205f}' | '\u{3000}' => ' ',
            other => other,
        })
        .collect::<String>()
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
}

fn find_sequence(lines: &[String], pattern: &[String], start: usize, eof: bool) -> Option<usize> {
    if pattern.is_empty() {
        return Some(lines.len());
    }
    if pattern.len() > lines.len() {
        return None;
    }
    let last = lines.len() - pattern.len();
    let candidates: Vec<usize> = if eof { vec![last] } else { (start..=last).collect() };
    for mode in 0..4 {
        for &position in &candidates {
            if position < start {
                continue;
            }
            let matches = pattern.iter().enumerate().all(|(offset, expected)| {
                let actual = &lines[position + offset];
                match mode {
                    0 => actual == expected,
                    1 => actual.trim_end() == expected.trim_end(),
                    2 => actual.trim() == expected.trim(),
                    _ => fuzzy_normalize(actual.trim()) == fuzzy_normalize(expected.trim()),
                }
            });
            if matches {
                return Some(position);
            }
        }
    }
    None
}

fn apply_chunks(path: &str, content: &str, chunks: &[PatchChunk]) -> Result<String, ToolFailure> {
    let trailing_newline = content.ends_with('\n');
    let mut lines: Vec<String> = content.split('\n').map(str::to_owned).collect();
    if trailing_newline {
        lines.pop();
    }
    let mut replacements = Vec::new();
    let mut cursor = 0usize;
    for chunk in chunks {
        if let Some(context) = &chunk.context {
            let context_lines = vec![context.clone()];
            let position = find_sequence(&lines, &context_lines, cursor, false).ok_or_else(|| {
                fail(
                    "patch_context_not_found",
                    format!("Failed to find context '{context}' in {path}"),
                )
            })?;
            cursor = position + 1;
        }
        let position = if chunk.old_lines.is_empty() {
            if chunk.end_of_file || chunk.context.is_none() {
                lines.len()
            } else {
                cursor
            }
        } else {
            find_sequence(&lines, &chunk.old_lines, cursor, chunk.end_of_file).ok_or_else(|| {
                fail(
                    "patch_lines_not_found",
                    format!(
                        "Failed to find expected lines in {path}:\n{}",
                        chunk.old_lines.join("\n")
                    ),
                )
            })?
        };
        replacements.push((position, chunk.old_lines.len(), chunk.new_lines.clone()));
        cursor = position + chunk.old_lines.len();
    }
    for (position, old_length, new_lines) in replacements.into_iter().rev() {
        lines.splice(position..position + old_length, new_lines);
    }
    let result = lines.join("\n");
    Ok(if trailing_newline || !result.is_empty() {
        format!("{result}\n")
    } else {
        result
    })
}

fn unified_patch(from: &str, to: &str, old: &str, new: &str) -> String {
    TextDiff::from_lines(old, new)
        .unified_diff()
        .context_radius(4)
        .header(from, to)
        .to_string()
}

struct Prepared {
    hunk: PatchHunk,
    source: PathBuf,
    destination: Option<PathBuf>,
    new_content: Option<Vec<u8>>,
    permissions: Option<fs::Permissions>,
    diff: String,
}

#[derive(Clone)]
struct Snapshot {
    bytes: Vec<u8>,
    permissions: fs::Permissions,
}

pub struct ApplyPatchTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl ApplyPatchTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for ApplyPatchTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    fn permission_request(&self, arguments: &Value) -> Option<PermissionRequest> {
        let patch = arguments.get("patch").and_then(Value::as_str).unwrap_or_default();
        let mut paths = patch
            .lines()
            .filter_map(|line| {
                [
                    "*** Add File: ",
                    "*** Update File: ",
                    "*** Delete File: ",
                    "*** Move to: ",
                ]
                .iter()
                .find_map(|prefix| line.strip_prefix(prefix))
            })
            .map(str::to_owned)
            .collect::<Vec<_>>();
        paths.sort();
        paths.dedup();
        if paths.is_empty() {
            paths.push("<patch>".to_owned());
        }
        Some(PermissionRequest {
            permission: "workspace.write".to_owned(),
            always: paths.clone(),
            patterns: paths,
        })
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let patch_text = required_string(&call.arguments, "patch")?;
        let hunks = parse_patch(patch_text)?;
        let mut resolved = Vec::new();
        let mut seen = HashSet::new();
        for hunk in hunks {
            let source = resolve_path(&self.config, &hunk.path)?;
            if !seen.insert(source.clone()) {
                return Err(fail(
                    "duplicate_patch_path",
                    format!("Patch contains duplicate file path: {}", source.display()),
                ));
            }
            let destination = hunk
                .move_path
                .as_deref()
                .map(|path| resolve_path(&self.config, path))
                .transpose()?;
            if let Some(destination) = &destination
                && !seen.insert(destination.clone())
            {
                return Err(fail(
                    "duplicate_patch_path",
                    format!("Patch contains duplicate file path: {}", destination.display()),
                ));
            }
            resolved.push((hunk, source, destination));
        }

        let _guard = FILE_MUTATION_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut prepared = Vec::new();
        for (hunk, source, destination) in resolved {
            let (old, new_content, permissions) = if hunk.kind == HunkKind::Add {
                if source.exists() {
                    return Err(fail(
                        "file_exists",
                        format!("Cannot add file that already exists: {}", hunk.path),
                    ));
                }
                (String::new(), Some(hunk.contents.as_bytes().to_vec()), None)
            } else {
                if !source.is_file() {
                    return Err(fail("file_not_found", format!("File not found: {}", hunk.path)));
                }
                let bytes = fs::read(&source).map_err(|error| fail("read_failed", error.to_string()))?;
                let raw = String::from_utf8_lossy(&bytes).into_owned();
                let permissions = fs::metadata(&source).ok().map(|metadata| metadata.permissions());
                if hunk.kind == HunkKind::Delete {
                    (raw, None, permissions)
                } else {
                    let (bom, body) = raw
                        .strip_prefix('\u{feff}')
                        .map_or(("", raw.as_str()), |body| ("\u{feff}", body));
                    let crlf = body.contains("\r\n");
                    let normalized = body.replace("\r\n", "\n").replace('\r', "\n");
                    let updated = apply_chunks(&hunk.path, &normalized, &hunk.chunks)?;
                    let restored = if crlf { updated.replace('\n', "\r\n") } else { updated };
                    (raw, Some(format!("{bom}{restored}").into_bytes()), permissions)
                }
            };
            let new_text = new_content.as_deref().map(String::from_utf8_lossy).unwrap_or_default();
            let diff = unified_patch(
                &hunk.path,
                hunk.move_path.as_deref().unwrap_or(&hunk.path),
                &old,
                &new_text,
            );
            prepared.push(Prepared {
                hunk,
                source,
                destination,
                new_content,
                permissions,
                diff,
            });
        }
        ensure_not_cancelled(&context.cancellation)?;

        let mut snapshots: HashMap<PathBuf, Option<Snapshot>> = HashMap::new();
        for item in &prepared {
            for path in std::iter::once(&item.source).chain(item.destination.iter()) {
                snapshots.entry(path.clone()).or_insert_with(|| {
                    path.is_file().then(|| Snapshot {
                        bytes: fs::read(path).unwrap_or_default(),
                        permissions: fs::metadata(path).expect("existing file metadata").permissions(),
                    })
                });
            }
        }
        let mutation = (|| -> Result<(), ToolFailure> {
            for item in &prepared {
                ensure_not_cancelled(&context.cancellation)?;
                match item.hunk.kind {
                    HunkKind::Delete => {
                        fs::remove_file(&item.source).map_err(|error| fail("delete_failed", error.to_string()))?;
                    }
                    HunkKind::Add | HunkKind::Update => {
                        let target = item.destination.as_ref().unwrap_or(&item.source);
                        if let Some(parent) = target.parent() {
                            fs::create_dir_all(parent)
                                .map_err(|error| fail("create_directory_failed", error.to_string()))?;
                        }
                        fs::write(target, item.new_content.as_deref().unwrap_or_default())
                            .map_err(|error| fail("write_failed", error.to_string()))?;
                        if let Some(permissions) = &item.permissions {
                            fs::set_permissions(target, permissions.clone())
                                .map_err(|error| fail("permissions_failed", error.to_string()))?;
                        }
                        if item.destination.is_some() {
                            fs::remove_file(&item.source)
                                .map_err(|error| fail("move_cleanup_failed", error.to_string()))?;
                        }
                    }
                }
            }
            Ok(())
        })();
        if let Err(error) = mutation {
            let mut rollback_errors = Vec::new();
            for (path, snapshot) in snapshots {
                let restored = match snapshot {
                    Some(snapshot) => {
                        fs::write(&path, snapshot.bytes).and_then(|()| fs::set_permissions(&path, snapshot.permissions))
                    }
                    None if path.exists() => fs::remove_file(&path),
                    None => Ok(()),
                };
                if let Err(rollback) = restored {
                    rollback_errors.push(format!("{}: {rollback}", path.display()));
                }
            }
            if rollback_errors.is_empty() {
                return Err(error);
            }
            return Err(fail(
                "rollback_incomplete",
                format!(
                    "Patch failed ({error}); rollback was incomplete: {}",
                    rollback_errors.join("; ")
                ),
            ));
        }

        let files: Vec<Value> = prepared
            .iter()
            .map(|item| {
                let status = if item.destination.is_some() {
                    "move"
                } else {
                    match item.hunk.kind {
                        HunkKind::Add => "add",
                        HunkKind::Update => "update",
                        HunkKind::Delete => "delete",
                    }
                };
                let additions = item
                    .diff
                    .lines()
                    .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
                    .count();
                let deletions = item
                    .diff
                    .lines()
                    .filter(|line| line.starts_with('-') && !line.starts_with("---"))
                    .count();
                json!({
                    "path": item.hunk.path,
                    "status": status,
                    "movePath": item.hunk.move_path,
                    "patch": item.diff,
                    "additions": additions,
                    "deletions": deletions,
                })
            })
            .collect();
        let details = json!({ "kind": "workspace_diff", "files": files, "patch": patch_text });
        Ok(text_output(
            format!("Successfully applied patch to {} file(s).", prepared.len()),
            Some(details),
        ))
    }
}
