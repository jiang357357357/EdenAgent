//! Victoria 3 observation bridge and opt-in console control probe.

mod control;

pub use control::{ControlConfig, ControlProbeResult, Controller};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt},
    sync::{Notify, RwLock, mpsc},
};
use tokio_util::sync::CancellationToken;

pub const PROTOCOL_VERSION: u32 = 1;
pub const BRIDGE_MARKER: &str = "[EDENAGENT]|";

#[derive(Clone, Debug)]
pub struct ObserverConfig {
    pub log_path: PathBuf,
    pub poll_interval: Duration,
}

impl ObserverConfig {
    #[must_use]
    pub fn from_settings(settings: &Value) -> Self {
        let log_path = settings
            .get("logPath")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("MON_VICTORIA3_LOG_PATH").map(PathBuf::from))
            .unwrap_or_else(default_log_path);
        Self {
            log_path,
            poll_interval: Duration::from_millis(500),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverState {
    pub log_path: PathBuf,
    pub attached: bool,
    pub bridge_seen: bool,
    pub protocol_version: Option<u32>,
    pub bridge_version: Option<String>,
    pub last_observed_at: Option<u64>,
    pub latest_snapshot: Option<Snapshot>,
    pub latest_ack: Option<CommandAck>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub observed_at: u64,
    pub fields: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandAck {
    pub observed_at: u64,
    pub command_id: String,
    pub status: String,
    pub action: Option<String>,
    pub fields: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BridgeRecord {
    Hello(BTreeMap<String, String>),
    Snapshot(BTreeMap<String, String>),
    Ack(BTreeMap<String, String>),
}

#[derive(Clone, Debug)]
pub enum Observation {
    Attached {
        log_path: PathBuf,
    },
    Hello {
        observed_at: u64,
        fields: BTreeMap<String, String>,
    },
    Snapshot(Snapshot),
    Ack(CommandAck),
}

impl Observation {
    #[must_use]
    pub fn event_type(&self) -> Option<&'static str> {
        match self {
            Self::Attached { .. } => None,
            Self::Hello { .. } => Some("victoria3.bridge_ready"),
            Self::Snapshot(_) => Some("victoria3.snapshot"),
            Self::Ack(_) => Some("victoria3.command_ack"),
        }
    }

    #[must_use]
    pub fn external_id(&self) -> Option<String> {
        match self {
            Self::Attached { .. } => None,
            Self::Hello { fields, .. } => Some(format!(
                "hello:{}:protocol-{PROTOCOL_VERSION}",
                fields
                    .get("bridge_version")
                    .map_or("unknown", String::as_str),
            )),
            Self::Snapshot(snapshot) => Some(format!(
                "snapshot:{}:{}",
                snapshot
                    .fields
                    .get("country_id")
                    .map_or("unknown", String::as_str),
                snapshot
                    .fields
                    .get("date")
                    .map_or_else(|| snapshot.observed_at.to_string(), Clone::clone)
            )),
            Self::Ack(ack) => Some(format!("ack:{}", ack.command_id)),
        }
    }

    #[must_use]
    pub fn payload(&self) -> Value {
        match self {
            Self::Attached { log_path } => json!({"logPath": log_path}),
            Self::Hello {
                observed_at,
                fields,
            } => json!({"observedAt": observed_at, "fields": fields}),
            Self::Snapshot(snapshot) => serde_json::to_value(snapshot).unwrap_or(Value::Null),
            Self::Ack(ack) => serde_json::to_value(ack).unwrap_or(Value::Null),
        }
    }
}

#[derive(Clone)]
pub struct ObserverHandle {
    state: Arc<RwLock<ObserverState>>,
    ack_notify: Arc<Notify>,
}

impl ObserverHandle {
    pub async fn state(&self) -> ObserverState {
        self.state.read().await.clone()
    }

    pub(crate) async fn wait_for_ack(
        &self,
        command_id: &str,
        timeout: Duration,
    ) -> Result<CommandAck, String> {
        let wait = async {
            loop {
                let notified = self.ack_notify.notified();
                if let Some(ack) = self
                    .state
                    .read()
                    .await
                    .latest_ack
                    .as_ref()
                    .filter(|ack| ack.command_id == command_id)
                    .cloned()
                {
                    return ack;
                }
                notified.await;
            }
        };
        tokio::time::timeout(timeout, wait)
            .await
            .map_err(|_| format!("Victoria 3 command ACK timed out for {command_id}"))
    }
}

pub struct Observer {
    config: ObserverConfig,
    state: Arc<RwLock<ObserverState>>,
    ack_notify: Arc<Notify>,
}

impl Observer {
    #[must_use]
    pub fn new(config: ObserverConfig) -> (ObserverHandle, Self) {
        let state = Arc::new(RwLock::new(ObserverState {
            log_path: config.log_path.clone(),
            ..ObserverState::default()
        }));
        let ack_notify = Arc::new(Notify::new());
        (
            ObserverHandle {
                state: state.clone(),
                ack_notify: ack_notify.clone(),
            },
            Self {
                config,
                state,
                ack_notify,
            },
        )
    }

    pub async fn run(
        self,
        cancellation: CancellationToken,
        updates: mpsc::Sender<Observation>,
    ) -> Result<(), String> {
        let mut cursor = 0_u64;
        let mut pending = Vec::<u8>::new();
        let mut attached = false;
        let mut initial_scan = true;
        loop {
            if cancellation.is_cancelled() {
                return Ok(());
            }
            let metadata = match fs::metadata(&self.config.log_path).await {
                Ok(metadata) if metadata.is_file() => metadata,
                Ok(_) => {
                    if sleep_or_cancel(&cancellation, self.config.poll_interval).await {
                        return Ok(());
                    }
                    continue;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    if sleep_or_cancel(&cancellation, self.config.poll_interval).await {
                        return Ok(());
                    }
                    continue;
                }
                Err(error) => return Err(format!("failed to inspect Victoria 3 log: {error}")),
            };

            if metadata.len() < cursor {
                cursor = 0;
                pending.clear();
                initial_scan = true;
            }
            if !attached {
                attached = true;
                self.state.write().await.attached = true;
                if updates
                    .send(Observation::Attached {
                        log_path: self.config.log_path.clone(),
                    })
                    .await
                    .is_err()
                {
                    return Ok(());
                }
            }

            if metadata.len() > cursor {
                let mut file = fs::File::open(&self.config.log_path)
                    .await
                    .map_err(|error| format!("failed to open Victoria 3 log: {error}"))?;
                file.seek(std::io::SeekFrom::Start(cursor))
                    .await
                    .map_err(|error| format!("failed to seek Victoria 3 log: {error}"))?;
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)
                    .await
                    .map_err(|error| format!("failed to read Victoria 3 log: {error}"))?;
                cursor = cursor.saturating_add(bytes.len() as u64);
                pending.extend_from_slice(&bytes);
                let mut records = Vec::new();
                while let Some(index) = pending.iter().position(|byte| *byte == b'\n') {
                    let line = pending.drain(..=index).collect::<Vec<_>>();
                    let line = String::from_utf8_lossy(&line);
                    if let Some(record) = parse_bridge_record(line.trim_end_matches(['\r', '\n'])) {
                        records.push(record);
                    }
                }
                if initial_scan {
                    let latest_hello = records.iter().rev().find_map(|record| match record {
                        BridgeRecord::Hello(fields) => Some(BridgeRecord::Hello(fields.clone())),
                        BridgeRecord::Snapshot(_) | BridgeRecord::Ack(_) => None,
                    });
                    let latest_snapshot = records.iter().rev().find_map(|record| match record {
                        BridgeRecord::Hello(_) => None,
                        BridgeRecord::Snapshot(fields) => {
                            Some(BridgeRecord::Snapshot(fields.clone()))
                        }
                        BridgeRecord::Ack(_) => None,
                    });
                    let latest_ack = records.iter().rev().find_map(|record| match record {
                        BridgeRecord::Ack(fields) => Some(BridgeRecord::Ack(fields.clone())),
                        BridgeRecord::Hello(_) | BridgeRecord::Snapshot(_) => None,
                    });
                    records = latest_hello
                        .into_iter()
                        .chain(latest_snapshot)
                        .chain(latest_ack)
                        .collect();
                    initial_scan = false;
                }
                for record in records {
                    let observation = self.apply(record).await;
                    if updates.send(observation).await.is_err() {
                        return Ok(());
                    }
                }
            }
            if sleep_or_cancel(&cancellation, self.config.poll_interval).await {
                return Ok(());
            }
        }
    }

    async fn apply(&self, record: BridgeRecord) -> Observation {
        let observed_at = unix_millis();
        let mut state = self.state.write().await;
        state.protocol_version = Some(PROTOCOL_VERSION);
        state.last_observed_at = Some(observed_at);
        match record {
            BridgeRecord::Hello(fields) => {
                state.bridge_seen = true;
                state.bridge_version = fields.get("bridge_version").cloned();
                Observation::Hello {
                    observed_at,
                    fields,
                }
            }
            BridgeRecord::Snapshot(fields) => {
                state.bridge_seen = true;
                let snapshot = Snapshot {
                    observed_at,
                    fields,
                };
                state.latest_snapshot = Some(snapshot.clone());
                Observation::Snapshot(snapshot)
            }
            BridgeRecord::Ack(fields) => {
                let ack = CommandAck {
                    observed_at,
                    command_id: fields.get("command_id").cloned().unwrap_or_default(),
                    status: fields
                        .get("status")
                        .cloned()
                        .unwrap_or_else(|| "unknown".to_owned()),
                    action: fields.get("action").cloned(),
                    fields,
                };
                state.latest_ack = Some(ack.clone());
                drop(state);
                self.ack_notify.notify_waiters();
                Observation::Ack(ack)
            }
        }
    }
}

#[must_use]
pub fn parse_bridge_record(line: &str) -> Option<BridgeRecord> {
    let marker = line.find(BRIDGE_MARKER)?;
    let mut segments = line[marker + BRIDGE_MARKER.len()..].split('|');
    if segments.next()?.parse::<u32>().ok()? != PROTOCOL_VERSION {
        return None;
    }
    let kind = segments.next()?;
    let fields = segments
        .filter_map(|segment| segment.split_once('='))
        .filter(|(key, _)| !key.is_empty())
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect::<BTreeMap<_, _>>();
    match kind {
        "HELLO" => Some(BridgeRecord::Hello(fields)),
        "SNAPSHOT" => Some(BridgeRecord::Snapshot(fields)),
        "ACK"
            if fields
                .get("command_id")
                .is_some_and(|value| !value.is_empty()) =>
        {
            Some(BridgeRecord::Ack(fields))
        }
        _ => None,
    }
}

async fn sleep_or_cancel(cancellation: &CancellationToken, duration: Duration) -> bool {
    tokio::select! {
        _ = cancellation.cancelled() => true,
        _ = tokio::time::sleep(duration) => false,
    }
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn default_log_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        return PathBuf::from(profile)
            .join("Documents")
            .join("Paradox Interactive")
            .join("Victoria 3")
            .join("logs")
            .join("debug.log");
    }
    #[cfg(not(target_os = "windows"))]
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Documents")
            .join("Paradox Interactive")
            .join("Victoria 3")
            .join("logs")
            .join("debug.log");
    }
    Path::new("Victoria 3").join("logs").join("debug.log")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[test]
    fn parses_prefixed_bridge_records() {
        let record = parse_bridge_record(
            "[12:00:00][jomini_log.cpp:35]: [EDENAGENT]|1|SNAPSHOT|date=1840.1.1|country_id=42|country_name=Great Qing",
        )
        .expect("bridge record");
        let BridgeRecord::Snapshot(fields) = record else {
            panic!("expected snapshot")
        };
        assert_eq!(fields["date"], "1840.1.1");
        assert_eq!(fields["country_name"], "Great Qing");
    }

    #[test]
    fn ignores_unknown_protocols_and_unrelated_logs() {
        assert!(parse_bridge_record("ordinary Victoria 3 log line").is_none());
        assert!(parse_bridge_record("[EDENAGENT]|2|HELLO|bridge_version=2").is_none());
        assert!(parse_bridge_record("[EDENAGENT]|1|ACK|status=success").is_none());
    }

    #[test]
    fn parses_control_ack() {
        let record = parse_bridge_record(
            "[EDENAGENT]|1|ACK|command_id=018f-test|status=success|action=probe_control",
        )
        .expect("ack record");
        let BridgeRecord::Ack(fields) = record else {
            panic!("expected ack")
        };
        assert_eq!(fields["command_id"], "018f-test");
        assert_eq!(fields["action"], "probe_control");
    }

    #[tokio::test]
    async fn follows_log_and_updates_snapshot_state() {
        let directory = tempfile::tempdir().expect("tempdir");
        let log_path = directory.path().join("debug.log");
        fs::write(&log_path, "startup\n").await.expect("seed log");
        let (handle, observer) = Observer::new(ObserverConfig {
            log_path: log_path.clone(),
            poll_interval: Duration::from_millis(10),
        });
        let cancellation = CancellationToken::new();
        let (sender, mut receiver) = mpsc::channel(8);
        let task = tokio::spawn(observer.run(cancellation.clone(), sender));
        assert!(matches!(
            receiver.recv().await.expect("attached"),
            Observation::Attached { .. }
        ));
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(&log_path)
            .await
            .expect("open log");
        file.write_all(
            b"[EDENAGENT]|1|HELLO|bridge_version=0.1.0\n[EDENAGENT]|1|SNAPSHOT|date=1842.3.15|country_id=CHI|gold_reserves=125000\n",
        )
        .await
        .expect("append observations");
        assert!(matches!(
            receiver.recv().await.expect("hello"),
            Observation::Hello { .. }
        ));
        assert!(matches!(
            receiver.recv().await.expect("snapshot"),
            Observation::Snapshot(_)
        ));
        let ack_waiter = {
            let handle = handle.clone();
            tokio::spawn(async move {
                handle
                    .wait_for_ack("018f-test", Duration::from_secs(1))
                    .await
            })
        };
        file.write_all(
            b"[EDENAGENT]|1|ACK|command_id=018f-test|status=success|action=probe_control\n",
        )
        .await
        .expect("append ack");
        assert!(matches!(
            receiver.recv().await.expect("ack"),
            Observation::Ack(_)
        ));
        let ack = ack_waiter.await.expect("ack waiter task").expect("ack");
        assert_eq!(ack.command_id, "018f-test");
        assert_eq!(ack.status, "success");
        let state = handle.state().await;
        assert!(state.attached);
        assert!(state.bridge_seen);
        assert_eq!(state.bridge_version.as_deref(), Some("0.1.0"));
        assert_eq!(
            state
                .latest_snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.fields.get("country_id"))
                .map(String::as_str),
            Some("CHI")
        );
        assert_eq!(
            state.latest_ack.as_ref().map(|ack| ack.command_id.as_str()),
            Some("018f-test")
        );
        cancellation.cancel();
        let _ = task.await;
    }
}
