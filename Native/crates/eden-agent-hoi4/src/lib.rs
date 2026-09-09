//! Read-only Hearts of Iron IV observation bridge.

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
    sync::{RwLock, mpsc},
};
use tokio_util::sync::CancellationToken;

pub const PROTOCOL_VERSION: u32 = 1;
pub const BRIDGE_MARKER: &str = "EDENAGENT_HOI4|";

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
            .or_else(|| std::env::var_os("MON_HOI4_LOG_PATH").map(PathBuf::from))
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
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryState {
    pub date: Option<String>,
    pub country_tag: Option<String>,
    pub country_name: Option<String>,
    pub political_power: Option<f64>,
    pub stability: Option<f64>,
    pub war_support: Option<f64>,
    pub manpower_thousands: Option<f64>,
    pub max_manpower_thousands: Option<f64>,
    pub fuel_thousands: Option<f64>,
    pub max_fuel_thousands: Option<f64>,
    pub civilian_factories: Option<f64>,
    pub military_factories: Option<f64>,
    pub naval_factories: Option<f64>,
    pub army_experience: Option<f64>,
    pub navy_experience: Option<f64>,
    pub air_experience: Option<f64>,
    pub at_war: Option<bool>,
    pub in_faction: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub observed_at: u64,
    pub country: CountryState,
    pub fields: BTreeMap<String, String>,
}

impl Snapshot {
    fn from_fields(observed_at: u64, fields: BTreeMap<String, String>) -> Self {
        let country = CountryState {
            date: text_field(&fields, "date"),
            country_tag: text_field(&fields, "country_tag"),
            country_name: text_field(&fields, "country_name"),
            political_power: number_field(&fields, "political_power"),
            stability: ratio_field(&fields, "stability"),
            war_support: ratio_field(&fields, "war_support"),
            manpower_thousands: number_field(&fields, "manpower_k"),
            max_manpower_thousands: number_field(&fields, "max_manpower_k"),
            fuel_thousands: number_field(&fields, "fuel_k"),
            max_fuel_thousands: number_field(&fields, "max_fuel_k"),
            civilian_factories: number_field(&fields, "civilian_factories"),
            military_factories: number_field(&fields, "military_factories"),
            naval_factories: number_field(&fields, "naval_factories"),
            army_experience: number_field(&fields, "army_experience"),
            navy_experience: number_field(&fields, "navy_experience"),
            air_experience: number_field(&fields, "air_experience"),
            at_war: bool_field(&fields, "at_war"),
            in_faction: bool_field(&fields, "in_faction"),
        };
        Self {
            observed_at,
            country,
            fields,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BridgeRecord {
    Hello(BTreeMap<String, String>),
    Snapshot(BTreeMap<String, String>),
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
    Snapshot(Box<Snapshot>),
}

impl Observation {
    #[must_use]
    pub fn event_type(&self) -> Option<&'static str> {
        match self {
            Self::Attached { .. } => None,
            Self::Hello { .. } => Some("hoi4.bridge_ready"),
            Self::Snapshot(_) => Some("hoi4.snapshot"),
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
                snapshot.country.country_tag.as_deref().unwrap_or("unknown"),
                snapshot
                    .country
                    .date
                    .clone()
                    .unwrap_or_else(|| snapshot.observed_at.to_string())
            )),
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
        }
    }
}

#[derive(Clone)]
pub struct ObserverHandle {
    state: Arc<RwLock<ObserverState>>,
}

impl ObserverHandle {
    pub async fn state(&self) -> ObserverState {
        self.state.read().await.clone()
    }
}

pub struct Observer {
    config: ObserverConfig,
    state: Arc<RwLock<ObserverState>>,
}

impl Observer {
    #[must_use]
    pub fn new(config: ObserverConfig) -> (ObserverHandle, Self) {
        let state = Arc::new(RwLock::new(ObserverState {
            log_path: config.log_path.clone(),
            ..ObserverState::default()
        }));
        (
            ObserverHandle {
                state: state.clone(),
            },
            Self { config, state },
        )
    }

    pub async fn run(
        self,
        cancellation: CancellationToken,
        updates: mpsc::Sender<Observation>,
    ) -> Result<(), String> {
        let mut cursor = 0_u64;
        let mut cursor_guard = Vec::<u8>::new();
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
                Err(error) => return Err(format!("failed to inspect HOI4 game.log: {error}")),
            };

            if metadata.len() < cursor {
                cursor = 0;
                cursor_guard.clear();
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
                    .map_err(|error| format!("failed to open HOI4 game.log: {error}"))?;
                if cursor > 0 && !cursor_guard.is_empty() {
                    let guard_start = cursor.saturating_sub(cursor_guard.len() as u64);
                    file.seek(std::io::SeekFrom::Start(guard_start))
                        .await
                        .map_err(|error| format!("failed to verify HOI4 game.log: {error}"))?;
                    let mut actual_guard = vec![0_u8; cursor_guard.len()];
                    let guard_matches = file.read_exact(&mut actual_guard).await.is_ok()
                        && actual_guard == cursor_guard;
                    if !guard_matches {
                        cursor = 0;
                        cursor_guard.clear();
                        pending.clear();
                        initial_scan = true;
                    }
                }
                file.seek(std::io::SeekFrom::Start(cursor))
                    .await
                    .map_err(|error| format!("failed to seek HOI4 game.log: {error}"))?;
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)
                    .await
                    .map_err(|error| format!("failed to read HOI4 game.log: {error}"))?;
                cursor = cursor.saturating_add(bytes.len() as u64);
                extend_cursor_guard(&mut cursor_guard, &bytes);
                pending.extend_from_slice(&bytes);
                let mut records = drain_records(&mut pending);
                if initial_scan {
                    records = latest_initial_records(&records);
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
        state.bridge_seen = true;
        match record {
            BridgeRecord::Hello(fields) => {
                state.bridge_version = fields.get("bridge_version").cloned();
                Observation::Hello {
                    observed_at,
                    fields,
                }
            }
            BridgeRecord::Snapshot(fields) => {
                let snapshot = Snapshot::from_fields(observed_at, fields);
                state.latest_snapshot = Some(snapshot.clone());
                Observation::Snapshot(Box::new(snapshot))
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
        _ => None,
    }
}

fn drain_records(pending: &mut Vec<u8>) -> Vec<BridgeRecord> {
    let mut records = Vec::new();
    while let Some(index) = pending.iter().position(|byte| *byte == b'\n') {
        let line = pending.drain(..=index).collect::<Vec<_>>();
        let line = String::from_utf8_lossy(&line);
        if let Some(record) = parse_bridge_record(line.trim_end_matches(['\r', '\n'])) {
            records.push(record);
        }
    }
    records
}

fn latest_initial_records(records: &[BridgeRecord]) -> Vec<BridgeRecord> {
    let latest_hello = records.iter().rev().find_map(|record| match record {
        BridgeRecord::Hello(fields) => Some(BridgeRecord::Hello(fields.clone())),
        BridgeRecord::Snapshot(_) => None,
    });
    let latest_snapshot = records.iter().rev().find_map(|record| match record {
        BridgeRecord::Hello(_) => None,
        BridgeRecord::Snapshot(fields) => Some(BridgeRecord::Snapshot(fields.clone())),
    });
    latest_hello.into_iter().chain(latest_snapshot).collect()
}

fn extend_cursor_guard(guard: &mut Vec<u8>, bytes: &[u8]) {
    const GUARD_SIZE: usize = 64;
    if bytes.len() >= GUARD_SIZE {
        guard.clear();
        guard.extend_from_slice(&bytes[bytes.len() - GUARD_SIZE..]);
        return;
    }
    guard.extend_from_slice(bytes);
    if guard.len() > GUARD_SIZE {
        guard.drain(..guard.len() - GUARD_SIZE);
    }
}

fn text_field(fields: &BTreeMap<String, String>, key: &str) -> Option<String> {
    fields
        .get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn number_field(fields: &BTreeMap<String, String>, key: &str) -> Option<f64> {
    let raw = fields.get(key)?.trim();
    let normalized = raw
        .trim_end_matches('%')
        .replace([',', ' '], "")
        .replace('−', "-");
    normalized.parse().ok()
}

fn ratio_field(fields: &BTreeMap<String, String>, key: &str) -> Option<f64> {
    let raw = fields.get(key)?.trim();
    let value = number_field(fields, key)?;
    Some(if raw.ends_with('%') {
        value / 100.0
    } else {
        value
    })
}

fn bool_field(fields: &BTreeMap<String, String>, key: &str) -> Option<bool> {
    match fields.get(key)?.trim().to_ascii_lowercase().as_str() {
        "1" | "yes" | "true" => Some(true),
        "0" | "no" | "false" => Some(false),
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
    {
        let mut candidates = Vec::new();
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            candidates.push(
                PathBuf::from(profile)
                    .join("Documents")
                    .join("Paradox Interactive")
                    .join("Hearts of Iron IV")
                    .join("logs")
                    .join("game.log"),
            );
        }
        if let Some(one_drive) = std::env::var_os("OneDrive") {
            candidates.push(
                PathBuf::from(one_drive)
                    .join("Documents")
                    .join("Paradox Interactive")
                    .join("Hearts of Iron IV")
                    .join("logs")
                    .join("game.log"),
            );
        }
        if let Some(existing) = candidates.iter().find(|path| path.exists()) {
            return existing.clone();
        }
        if let Some(primary) = candidates.into_iter().next() {
            return primary;
        }
    }
    #[cfg(not(target_os = "windows"))]
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Documents")
            .join("Paradox Interactive")
            .join("Hearts of Iron IV")
            .join("logs")
            .join("game.log");
    }
    Path::new("Hearts of Iron IV").join("logs").join("game.log")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[test]
    fn parses_prefixed_snapshot_into_typed_state() {
        let record = parse_bridge_record(
            "[12:00:00][effectbase.cpp:123]: EDENAGENT_HOI4|1|SNAPSHOT|date=1939.9.1|country_tag=GER|country_name=German Reich|political_power=125.50|stability=0.72|civilian_factories=31|at_war=yes",
        )
        .expect("bridge record");
        let BridgeRecord::Snapshot(fields) = record else {
            panic!("expected snapshot")
        };
        let snapshot = Snapshot::from_fields(1, fields);
        assert_eq!(snapshot.country.country_tag.as_deref(), Some("GER"));
        assert_eq!(snapshot.country.political_power, Some(125.5));
        assert_eq!(snapshot.country.civilian_factories, Some(31.0));
        assert_eq!(snapshot.country.at_war, Some(true));
    }

    #[test]
    fn ignores_unknown_protocols_and_unrelated_logs() {
        assert!(parse_bridge_record("ordinary HOI4 log line").is_none());
        assert!(parse_bridge_record("EDENAGENT_HOI4|2|HELLO|bridge_version=2").is_none());
        assert!(parse_bridge_record("[EDENAGENT]|1|SNAPSHOT|country_tag=ENG").is_none());
    }

    #[test]
    fn normalizes_percentage_ratios_without_losing_raw_fields() {
        let fields = BTreeMap::from([
            ("stability".to_owned(), "72%".to_owned()),
            ("war_support".to_owned(), "0.61".to_owned()),
        ]);
        let snapshot = Snapshot::from_fields(1, fields);
        assert_eq!(snapshot.country.stability, Some(0.72));
        assert_eq!(snapshot.country.war_support, Some(0.61));
        assert_eq!(snapshot.fields["stability"], "72%");
    }

    #[tokio::test]
    async fn follows_log_rotation_and_updates_latest_snapshot() {
        let directory = tempfile::tempdir().expect("tempdir");
        let log_path = directory.path().join("game.log");
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
            b"EDENAGENT_HOI4|1|HELLO|bridge_version=0.1.0|mode=observe\nEDENAGENT_HOI4|1|SNAPSHOT|date=1936.1.1|country_tag=ENG|political_power=50|at_war=no\n",
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
        let state = handle.state().await;
        assert!(state.attached);
        assert!(state.bridge_seen);
        assert_eq!(state.bridge_version.as_deref(), Some("0.1.0"));
        assert_eq!(
            state
                .latest_snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.country.country_tag.as_deref()),
            Some("ENG")
        );

        drop(file);
        let replacement = format!(
            "EDENAGENT_HOI4|1|HELLO|bridge_version=0.1.0|mode=observe\nEDENAGENT_HOI4|1|SNAPSHOT|date=1936.2.1|country_tag=FRA|political_power=60\n{}\n",
            "replacement-padding".repeat(32)
        );
        fs::write(&log_path, replacement)
            .await
            .expect("replace log with a larger file");
        assert!(matches!(
            receiver.recv().await.expect("hello after rotation"),
            Observation::Hello { .. }
        ));
        assert!(matches!(
            receiver.recv().await.expect("snapshot after rotation"),
            Observation::Snapshot(_)
        ));
        assert_eq!(
            handle
                .state()
                .await
                .latest_snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.country.country_tag.as_deref()),
            Some("FRA")
        );
        cancellation.cancel();
        let _ = task.await;
    }
}
