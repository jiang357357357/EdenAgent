use crate::now_ms;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};

static IDENTIFIER_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn identifier(prefix: &str) -> String {
    format!(
        "{prefix}_{}_{:x}",
        std::process::id(),
        IDENTIFIER_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Created,
    Queued,
    Running,
    Waiting,
    Completed,
    Failed,
    Interrupted,
    Cancelled,
}

impl AgentStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Interrupted | Self::Cancelled
        )
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentResult {
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub artifacts: Vec<Value>,
    #[serde(default)]
    pub changed_files: Vec<String>,
    #[serde(default)]
    pub tests: Vec<Value>,
    #[serde(default)]
    pub details: Value,
}

impl AgentResult {
    pub fn normalize_summary(&mut self) {
        if self.summary.is_empty() {
            self.summary = self.content.chars().take(240).collect();
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InterAgentMessage {
    pub id: String,
    pub sender: String,
    pub target: String,
    pub content: String,
    #[serde(default = "default_message_kind")]
    pub kind: String,
    #[serde(default)]
    pub trigger_turn: bool,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub details: Value,
}

fn default_message_kind() -> String {
    "message".to_owned()
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSnapshot {
    pub id: String,
    #[serde(rename = "rootSessionID")]
    pub root_session_id: String,
    #[serde(rename = "parentID", default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(rename = "agentPath")]
    pub path: String,
    pub task_name: String,
    pub role: String,
    pub status: AgentStatus,
    pub depth: usize,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<AgentResult>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Clone, Debug)]
struct AgentThreadState {
    snapshot: AgentSnapshot,
    mailbox: VecDeque<InterAgentMessage>,
}

#[derive(Debug)]
pub struct MultiAgentControl {
    root_session_id: String,
    max_threads: usize,
    max_depth: usize,
    threads: HashMap<String, AgentThreadState>,
    ids_by_path: HashMap<String, String>,
    root_mailbox: VecDeque<InterAgentMessage>,
}

impl MultiAgentControl {
    pub const ROOT_PATH: &'static str = "/root";

    pub fn new(root_session_id: impl Into<String>, max_threads: usize, max_depth: usize) -> Result<Self, String> {
        if max_threads == 0 {
            return Err("max_threads must be at least 1".to_owned());
        }
        if max_depth == 0 {
            return Err("max_depth must be at least 1".to_owned());
        }
        Ok(Self {
            root_session_id: root_session_id.into(),
            max_threads,
            max_depth,
            threads: HashMap::new(),
            ids_by_path: HashMap::new(),
            root_mailbox: VecDeque::new(),
        })
    }

    pub fn spawn(
        &mut self,
        task_name: &str,
        parent: &str,
        role: &str,
        metadata: Value,
    ) -> Result<AgentSnapshot, String> {
        let (parent_path, parent_id, depth) = self.resolve_parent(parent)?;
        if depth > self.max_depth {
            return Err(format!("maximum sub-agent depth exceeded ({})", self.max_depth));
        }
        let active = self
            .threads
            .values()
            .filter(|thread| !thread.snapshot.status.is_terminal())
            .count();
        if active >= self.max_threads {
            return Err(format!("maximum sub-agent threads reached ({})", self.max_threads));
        }
        let task_name = normalize_task_name(task_name)?;
        let mut path = format!("{parent_path}/{task_name}");
        let mut suffix = 2;
        while self.ids_by_path.contains_key(&path) {
            path = format!("{parent_path}/{task_name}_{suffix}");
            suffix += 1;
        }
        let current = now_ms();
        let snapshot = AgentSnapshot {
            id: identifier("agt"),
            root_session_id: self.root_session_id.clone(),
            parent_id,
            path: path.clone(),
            task_name,
            role: if role.is_empty() {
                "general".to_owned()
            } else {
                role.to_owned()
            },
            status: AgentStatus::Queued,
            depth,
            created_at: current,
            updated_at: current,
            started_at: None,
            completed_at: None,
            error: None,
            result: None,
            metadata,
        };
        self.ids_by_path.insert(path, snapshot.id.clone());
        self.threads.insert(
            snapshot.id.clone(),
            AgentThreadState {
                snapshot: snapshot.clone(),
                mailbox: VecDeque::new(),
            },
        );
        Ok(snapshot)
    }

    pub fn restore(&mut self, snapshot: AgentSnapshot) -> Result<AgentSnapshot, String> {
        if snapshot.root_session_id != self.root_session_id {
            return Err("restored sub-agent belongs to a different root session".to_owned());
        }
        if snapshot.id.is_empty() || !snapshot.path.starts_with("/root/") {
            return Err("restored sub-agent has invalid identity or path".to_owned());
        }
        if let Some(existing) = self.ids_by_path.get(&snapshot.path)
            && existing != &snapshot.id
        {
            return Err(format!(
                "restored sub-agent path is already registered: {}",
                snapshot.path
            ));
        }
        if self.threads.contains_key(&snapshot.id) {
            return Ok(self.threads[&snapshot.id].snapshot.clone());
        }
        if self.threads.len() >= self.max_threads {
            return Err(format!("maximum sub-agent threads reached ({})", self.max_threads));
        }
        self.ids_by_path.insert(snapshot.path.clone(), snapshot.id.clone());
        self.threads.insert(
            snapshot.id.clone(),
            AgentThreadState {
                snapshot: snapshot.clone(),
                mailbox: VecDeque::new(),
            },
        );
        Ok(snapshot)
    }

    pub fn start(&mut self, target: &str) -> Result<AgentSnapshot, String> {
        let thread = self.require_thread_mut(target)?;
        if thread.snapshot.status != AgentStatus::Queued {
            return Err(format!(
                "sub-agent cannot be started from status {:?}: {}",
                thread.snapshot.status, thread.snapshot.path
            ));
        }
        let current = now_ms();
        thread.snapshot.status = AgentStatus::Running;
        thread.snapshot.updated_at = current;
        thread.snapshot.started_at.get_or_insert(current);
        Ok(thread.snapshot.clone())
    }

    pub fn requeue(&mut self, target: &str) -> Result<AgentSnapshot, String> {
        let thread = self.require_thread_mut(target)?;
        if !thread.snapshot.status.is_terminal() {
            return Err(format!(
                "sub-agent cannot be requeued from status {:?}: {}",
                thread.snapshot.status, thread.snapshot.path
            ));
        }
        thread.snapshot.status = AgentStatus::Queued;
        thread.snapshot.updated_at = now_ms();
        thread.snapshot.completed_at = None;
        thread.snapshot.error = None;
        thread.snapshot.result = None;
        Ok(thread.snapshot.clone())
    }

    pub fn complete(
        &mut self,
        target: &str,
        mut result: AgentResult,
    ) -> Result<(AgentSnapshot, InterAgentMessage), String> {
        result.normalize_summary();
        let (snapshot, parent_id) = {
            let thread = self.require_thread_mut(target)?;
            let current = now_ms();
            thread.snapshot.status = AgentStatus::Completed;
            thread.snapshot.updated_at = current;
            thread.snapshot.completed_at = Some(current);
            thread.snapshot.error = None;
            thread.snapshot.result = Some(result.clone());
            (thread.snapshot.clone(), thread.snapshot.parent_id.clone())
        };
        let parent_path = parent_id
            .and_then(|id| self.threads.get(&id).map(|parent| parent.snapshot.path.clone()))
            .unwrap_or_else(|| Self::ROOT_PATH.to_owned());
        let message = InterAgentMessage {
            id: identifier("a2a"),
            sender: snapshot.path.clone(),
            target: parent_path.clone(),
            content: result.content.clone(),
            kind: "result".to_owned(),
            trigger_turn: false,
            created_at: now_ms(),
            details: json!({"agent":snapshot,"result":result}),
        };
        self.enqueue(message.clone())?;
        Ok((snapshot, message))
    }

    pub fn fail(&mut self, target: &str, error: &str) -> Result<(AgentSnapshot, InterAgentMessage), String> {
        let (snapshot, parent_id) = {
            let thread = self.require_thread_mut(target)?;
            let current = now_ms();
            thread.snapshot.status = AgentStatus::Failed;
            thread.snapshot.updated_at = current;
            thread.snapshot.completed_at = Some(current);
            thread.snapshot.error = Some(error.to_owned());
            (thread.snapshot.clone(), thread.snapshot.parent_id.clone())
        };
        let parent_path = parent_id
            .and_then(|id| self.threads.get(&id).map(|parent| parent.snapshot.path.clone()))
            .unwrap_or_else(|| Self::ROOT_PATH.to_owned());
        let message = InterAgentMessage {
            id: identifier("a2a"),
            sender: snapshot.path.clone(),
            target: parent_path,
            content: format!("Sub-agent failed: {error}"),
            kind: "error".to_owned(),
            trigger_turn: false,
            created_at: now_ms(),
            details: json!({"agent":snapshot,"error":error}),
        };
        self.enqueue(message.clone())?;
        Ok((snapshot, message))
    }

    pub fn interrupt(&mut self, target: &str) -> Result<AgentSnapshot, String> {
        let thread = self.require_thread_mut(target)?;
        if !thread.snapshot.status.is_terminal() {
            let current = now_ms();
            thread.snapshot.status = AgentStatus::Interrupted;
            thread.snapshot.updated_at = current;
            thread.snapshot.completed_at = Some(current);
        }
        Ok(thread.snapshot.clone())
    }

    pub fn send_message(
        &mut self,
        target: &str,
        sender: &str,
        content: &str,
        kind: &str,
        trigger_turn: bool,
        details: Value,
    ) -> Result<InterAgentMessage, String> {
        let target_path = self.require_thread(target)?.snapshot.path.clone();
        let message = InterAgentMessage {
            id: identifier("a2a"),
            sender: if sender.is_empty() {
                Self::ROOT_PATH.to_owned()
            } else {
                sender.to_owned()
            },
            target: target_path,
            content: content.to_owned(),
            kind: if kind.is_empty() {
                "message".to_owned()
            } else {
                kind.to_owned()
            },
            trigger_turn,
            created_at: now_ms(),
            details,
        };
        self.enqueue(message.clone())?;
        Ok(message)
    }

    pub fn restore_mailbox(&mut self, messages: Vec<InterAgentMessage>) {
        for message in messages {
            let known = self.root_mailbox.iter().any(|item| item.id == message.id)
                || self
                    .threads
                    .values()
                    .any(|thread| thread.mailbox.iter().any(|item| item.id == message.id));
            if !message.id.is_empty() && !known {
                let _ = self.enqueue(message);
            }
        }
    }

    pub fn drain_mailbox(&mut self, receiver: &str) -> Result<Vec<InterAgentMessage>, String> {
        if receiver == Self::ROOT_PATH {
            return Ok(self.root_mailbox.drain(..).collect());
        }
        Ok(self.require_thread_mut(receiver)?.mailbox.drain(..).collect())
    }

    pub fn list(&self, path_prefix: Option<&str>) -> Vec<AgentSnapshot> {
        let prefix = path_prefix.unwrap_or_default().trim_end_matches('/');
        let mut values = self
            .threads
            .values()
            .filter(|thread| {
                prefix.is_empty()
                    || thread.snapshot.path == prefix
                    || thread.snapshot.path.starts_with(&format!("{prefix}/"))
            })
            .map(|thread| thread.snapshot.clone())
            .collect::<Vec<_>>();
        values.sort_by_key(|snapshot| {
            (
                snapshot.path.matches('/').count(),
                snapshot.created_at,
                snapshot.path.clone(),
            )
        });
        values
    }

    pub fn get(&self, target: &str) -> Result<AgentSnapshot, String> {
        Ok(self.require_thread(target)?.snapshot.clone())
    }

    fn enqueue(&mut self, message: InterAgentMessage) -> Result<(), String> {
        if message.target == Self::ROOT_PATH {
            self.root_mailbox.push_back(message);
        } else {
            self.require_thread_mut(&message.target)?.mailbox.push_back(message);
        }
        Ok(())
    }

    fn resolve_parent(&self, parent: &str) -> Result<(String, Option<String>, usize), String> {
        if parent.is_empty() || parent == Self::ROOT_PATH {
            return Ok((Self::ROOT_PATH.to_owned(), None, 1));
        }
        let parent = self.require_thread(parent)?;
        Ok((
            parent.snapshot.path.clone(),
            Some(parent.snapshot.id.clone()),
            parent.snapshot.depth + 1,
        ))
    }

    fn require_thread(&self, target: &str) -> Result<&AgentThreadState, String> {
        let id = if self.threads.contains_key(target) {
            Some(target)
        } else {
            self.ids_by_path.get(target).map(String::as_str)
        };
        id.and_then(|id| self.threads.get(id))
            .ok_or_else(|| format!("unknown sub-agent: {target}"))
    }

    fn require_thread_mut(&mut self, target: &str) -> Result<&mut AgentThreadState, String> {
        let id = if self.threads.contains_key(target) {
            Some(target.to_owned())
        } else {
            self.ids_by_path.get(target).cloned()
        };
        id.and_then(|id| self.threads.get_mut(&id))
            .ok_or_else(|| format!("unknown sub-agent: {target}"))
    }
}

fn normalize_task_name(value: &str) -> Result<String, String> {
    let mut normalized = String::new();
    let mut previous_separator = false;
    for character in value.trim().to_ascii_lowercase().chars() {
        if character.is_ascii_lowercase() || character.is_ascii_digit() || matches!(character, '_' | '-') {
            normalized.push(character);
            previous_separator = false;
        } else if !previous_separator && !normalized.is_empty() {
            normalized.push('_');
            previous_separator = true;
        }
    }
    let normalized = normalized.trim_matches('_').chars().take(64).collect::<String>();
    if normalized.is_empty() {
        Err("task_name must contain at least one letter or number".to_owned())
    } else {
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manages_nested_agents_results_and_mailboxes() {
        let mut control = MultiAgentControl::new("session", 4, 2).expect("control");
        let first = control
            .spawn("Research task", "/root", "researcher", json!({}))
            .expect("spawn");
        assert_eq!(first.path, "/root/research_task");
        control.start(&first.id).expect("start");
        let child = control
            .spawn("verify", &first.path, "reviewer", json!({}))
            .expect("nested spawn");
        assert_eq!(child.path, "/root/research_task/verify");
        control.start(&child.id).expect("start child");
        control
            .complete(
                &child.id,
                AgentResult {
                    content: "verified".to_owned(),
                    ..AgentResult::default()
                },
            )
            .expect("complete");
        let mailbox = control.drain_mailbox(&first.path).expect("mailbox");
        assert_eq!(mailbox[0].content, "verified");
        assert_eq!(mailbox[0].kind, "result");
        assert_eq!(control.get(&child.id).expect("snapshot").status, AgentStatus::Completed);
    }

    #[test]
    fn enforces_depth_and_unique_paths() {
        let mut control = MultiAgentControl::new("session", 4, 1).expect("control");
        let first = control.spawn("same", "/root", "", json!({})).expect("spawn");
        let second = control.spawn("same", "/root", "", json!({})).expect("spawn duplicate");
        assert_eq!(second.path, "/root/same_2");
        assert!(control.spawn("too-deep", &first.path, "", json!({})).is_err());
    }
}
