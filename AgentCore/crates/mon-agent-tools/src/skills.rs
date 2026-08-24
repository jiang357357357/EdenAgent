use ignore::WalkBuilder;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_NAME_LENGTH: usize = 64;
const MAX_DESCRIPTION_LENGTH: usize = 1_024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadedSkill {
    name: String,
    description: String,
    content: String,
    file_path: String,
    disable_model_invocation: bool,
}

fn diagnostic(code: &str, message: impl Into<String>, path: &Path) -> Value {
    json!({
        "type": "warning",
        "code": code,
        "message": message.into(),
        "path": path.to_string_lossy(),
    })
}

fn candidate_files(root: &Path, diagnostics: &mut Vec<Value>) -> Vec<PathBuf> {
    let root_skill = root.join("SKILL.md");
    if root_skill.is_file() {
        return vec![root_skill];
    }
    let mut skill_files = Vec::new();
    let mut root_markdown = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .parents(true)
        .git_ignore(true)
        .git_exclude(true)
        .ignore(true)
        .follow_links(true)
        .filter_entry(|entry| entry.file_name() != "node_modules")
        .build();
    for result in walker {
        let entry = match result {
            Ok(entry) => entry,
            Err(error) => {
                diagnostics.push(diagnostic("file_info_failed", error.to_string(), root));
                continue;
            }
        };
        let path = entry.path();
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        if path.file_name().and_then(|name| name.to_str()) == Some("SKILL.md") {
            skill_files.push(path.to_owned());
        } else if path.parent() == Some(root) && path.extension().and_then(|extension| extension.to_str()) == Some("md")
        {
            root_markdown.push(path.to_owned());
        }
    }
    skill_files.sort();
    root_markdown.sort();
    let skill_directories = skill_files
        .iter()
        .filter_map(|path| path.parent().map(Path::to_owned))
        .collect::<BTreeSet<_>>();
    skill_files.retain(|path| {
        path.parent().is_none_or(|parent| {
            !parent
                .ancestors()
                .skip(1)
                .any(|ancestor| skill_directories.contains(ancestor))
        })
    });
    root_markdown.extend(skill_files);
    root_markdown
}

fn validate_name(name: &str, parent: &str) -> Vec<String> {
    let mut errors = Vec::new();
    if name != parent {
        errors.push(format!("name \"{name}\" does not match parent directory \"{parent}\""));
    }
    if name.chars().count() > MAX_NAME_LENGTH {
        errors.push(format!(
            "name exceeds {MAX_NAME_LENGTH} characters ({})",
            name.chars().count()
        ));
    }
    if !name
        .chars()
        .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
    {
        errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)".to_owned());
    }
    if name.starts_with('-') || name.ends_with('-') {
        errors.push("name must not start or end with a hyphen".to_owned());
    }
    if name.contains("--") {
        errors.push("name must not contain consecutive hyphens".to_owned());
    }
    errors
}

fn load_file(path: &Path, diagnostics: &mut Vec<Value>) -> Option<LoadedSkill> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) => {
            diagnostics.push(diagnostic("read_failed", error.to_string(), path));
            return None;
        }
    };
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let (yaml, body) = if let Some(stripped) = normalized.strip_prefix("---") {
        match stripped.find("\n---") {
            Some(index) => {
                let yaml = stripped.get(1..index).unwrap_or_default();
                let body = stripped.get(index + 4..).unwrap_or_default().trim().to_owned();
                (yaml, body)
            }
            None => ("", normalized.clone()),
        }
    } else {
        ("", normalized.clone())
    };
    let frontmatter: serde_yaml::Value = match serde_yaml::from_str(yaml) {
        Ok(value) => value,
        Err(error) => {
            diagnostics.push(diagnostic("parse_failed", error.to_string(), path));
            return None;
        }
    };
    let get_string = |key: &str| {
        frontmatter
            .as_mapping()
            .and_then(|mapping| mapping.get(serde_yaml::Value::String(key.to_owned())))
            .and_then(serde_yaml::Value::as_str)
            .map(str::to_owned)
    };
    let parent = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let name = get_string("name").unwrap_or_else(|| parent.to_owned());
    let description = get_string("description").unwrap_or_default();
    if description.trim().is_empty() {
        diagnostics.push(diagnostic("invalid_metadata", "description is required", path));
    } else if description.chars().count() > MAX_DESCRIPTION_LENGTH {
        diagnostics.push(diagnostic(
            "invalid_metadata",
            format!(
                "description exceeds {MAX_DESCRIPTION_LENGTH} characters ({})",
                description.chars().count()
            ),
            path,
        ));
    }
    for error in validate_name(&name, parent) {
        diagnostics.push(diagnostic("invalid_metadata", error, path));
    }
    if description.trim().is_empty() {
        return None;
    }
    let disabled = frontmatter
        .as_mapping()
        .and_then(|mapping| mapping.get(serde_yaml::Value::String("disable-model-invocation".to_owned())))
        .and_then(serde_yaml::Value::as_bool)
        == Some(true);
    Some(LoadedSkill {
        name,
        description,
        content: body,
        file_path: path.to_string_lossy().into_owned(),
        disable_model_invocation: disabled,
    })
}

pub fn load_skills(directories: &[String]) -> Value {
    let mut skills = Vec::new();
    let mut diagnostics = Vec::new();
    for directory in directories {
        let root = PathBuf::from(directory);
        if !root.exists() {
            continue;
        }
        if !root.is_dir() {
            continue;
        }
        for path in candidate_files(&root, &mut diagnostics) {
            if let Some(skill) = load_file(&path, &mut diagnostics) {
                skills.push(skill);
            }
        }
    }
    json!({"skills": skills, "diagnostics": diagnostics})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_valid_skills_and_honors_ignore_files() {
        let root = tempfile::tempdir().expect("tempdir");
        fs::write(root.path().join(".ignore"), "ignored/\n").expect("ignore");
        let skill = root.path().join("demo-skill");
        fs::create_dir(&skill).expect("skill directory");
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: demo-skill\ndescription: Demo workflow\ndisable-model-invocation: true\n---\n\nDo the work.\n",
        )
        .expect("skill file");
        let ignored = root.path().join("ignored");
        fs::create_dir(&ignored).expect("ignored directory");
        fs::write(
            ignored.join("SKILL.md"),
            "---\nname: ignored\ndescription: ignored\n---\nbody",
        )
        .expect("ignored skill");
        let result = load_skills(&[root.path().to_string_lossy().into_owned()]);
        assert_eq!(result["skills"].as_array().expect("skills").len(), 1);
        assert_eq!(result["skills"][0]["name"], "demo-skill");
        assert_eq!(result["skills"][0]["content"], "Do the work.");
        assert_eq!(result["skills"][0]["disableModelInvocation"], true);
    }
}
