mod transport;

use serde::Deserialize;
use serde_json::{Map, Value, json};
#[cfg(target_os = "linux")]
use std::path::Path;
use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt, ReadHalf, WriteHalf},
    sync::{Mutex, Notify, mpsc, oneshot},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const ADMIN_JOIN: u8 = 0;
const ADMIN_QUIT: u8 = 1;
const ADMIN_UPDATE_FREQUENCY: u8 = 2;
const ADMIN_POLL: u8 = 3;
const ADMIN_CHAT: u8 = 4;
const ADMIN_RCON: u8 = 5;
const ADMIN_GAMESCRIPT: u8 = 6;
const ADMIN_PING: u8 = 7;
const SERVER_ERROR: u8 = 102;
const SERVER_PROTOCOL: u8 = 103;
const SERVER_WELCOME: u8 = 104;
const SERVER_NEWGAME: u8 = 105;
const SERVER_SHUTDOWN: u8 = 106;
const SERVER_DATE: u8 = 107;
const SERVER_COMPANY_NEW: u8 = 113;
const SERVER_COMPANY_INFO: u8 = 114;
const SERVER_COMPANY_UPDATE: u8 = 115;
const SERVER_COMPANY_REMOVE: u8 = 116;
const SERVER_COMPANY_ECONOMY: u8 = 117;
const SERVER_COMPANY_STATS: u8 = 118;
const SERVER_CHAT: u8 = 119;
const SERVER_RCON: u8 = 120;
const SERVER_CONSOLE: u8 = 121;
const SERVER_GAMESCRIPT: u8 = 124;
const SERVER_RCON_END: u8 = 125;
const SERVER_PONG: u8 = 126;

const UPDATE_DATE: u16 = 0;
const UPDATE_COMPANY_INFO: u16 = 2;
const UPDATE_COMPANY_ECONOMY: u16 = 3;
const UPDATE_COMPANY_STATS: u16 = 4;
const UPDATE_CHAT: u16 = 5;
const UPDATE_CONSOLE: u16 = 6;
const UPDATE_GAMESCRIPT: u16 = 9;
const FREQUENCY_DAILY: u16 = 1 << 1;
const FREQUENCY_QUARTERLY: u16 = 1 << 4;
const FREQUENCY_AUTOMATIC: u16 = 1 << 6;

pub struct Command {
    pub action: String,
    pub payload: Value,
    pub reply: oneshot::Sender<Result<Value, String>>,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub identity_key: String,
    pub settings: Value,
    pub credential_environment: Option<String>,
}

#[derive(Clone, Debug)]
pub enum Event {
    Status {
        state: String,
        detail: Option<String>,
    },
    Published {
        external_id: String,
        event_type: String,
        payload: Value,
    },
}

#[derive(Clone)]
pub struct Handle(mpsc::Sender<Command>);

impl Handle {
    pub async fn execute(&self, action: &str, payload: Value) -> Result<Value, String> {
        let (reply, receive) = oneshot::channel();
        self.0
            .send(Command {
                action: action.to_owned(),
                payload,
                reply,
            })
            .await
            .map_err(|_| "OpenTTD connector is not running".to_owned())?;
        receive
            .await
            .map_err(|_| "OpenTTD connector stopped before replying".to_owned())?
    }
}

pub fn channel() -> (Handle, mpsc::Receiver<Command>) {
    let (send, receive) = mpsc::channel(32);
    (Handle(send), receive)
}

#[derive(Clone, Debug, Deserialize)]
struct Instance {
    instance_id: String,
    host: String,
    game_port: u16,
    admin_port: u16,
    pid: i64,
    mode: String,
    started_at: String,
    #[serde(default)]
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    config_path: Option<PathBuf>,
    #[serde(default)]
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    process_start_ticks: Option<String>,
    #[serde(default)]
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    process_executable: Option<PathBuf>,
    #[serde(default)]
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    launch_target: Option<PathBuf>,
}

#[derive(Default)]
struct State {
    instance: Option<Instance>,
    server: Map<String, Value>,
    companies: HashMap<u8, Map<String, Value>>,
    date: Option<u32>,
    authenticated: bool,
    bridge_ready: bool,
    bridge_version: Option<i64>,
}

type Writer = Arc<Mutex<WriteHalf<transport::Stream>>>;
type SharedState = Arc<Mutex<State>>;
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;

pub async fn run(
    config: Config,
    cancellation: CancellationToken,
    mut commands: mpsc::Receiver<Command>,
    events: mpsc::Sender<Event>,
) -> Result<(), String> {
    events
        .send(Event::Status {
            state: "connecting".to_owned(),
            detail: None,
        })
        .await
        .map_err(|_| "OpenTTD event receiver closed".to_owned())?;
    let instance = load_instance(&config).await?;
    let password = password(&config)?;
    let stream = transport::connect(&instance.host, instance.admin_port)
        .await
        .map_err(|error| format!("OpenTTD Admin Port connection failed: {error}"))?;
    let (reader, writer) = tokio::io::split(stream);
    let writer = Arc::new(Mutex::new(writer));
    send_packet(
        &writer,
        ADMIN_JOIN,
        &[cstring(&password), cstring("Eden Agent"), cstring("1")].concat(),
    )
    .await?;
    let state = Arc::new(Mutex::new(State {
        instance: Some(instance),
        ..State::default()
    }));
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let ready = Arc::new(Notify::new());
    let state_updated = Arc::new(Notify::new());
    let mut reader_task = tokio::spawn(read_loop(
        reader,
        writer.clone(),
        state.clone(),
        pending.clone(),
        ready.clone(),
        state_updated.clone(),
        events,
    ));
    loop {
        tokio::select! {
            _ = cancellation.cancelled() => {
                let _ = send_packet(&writer, ADMIN_QUIT, &[]).await;
                reader_task.abort();
                return Ok(());
            }
            command = commands.recv() => {
                let Some(command) = command else {
                    reader_task.abort();
                    return Ok(());
                };
                let result = execute(
                    &command.action,
                    command.payload,
                    &writer,
                    &state,
                    &pending,
                    &ready,
                    &state_updated,
                ).await;
                let _ = command.reply.send(result);
            }
            result = &mut reader_task => {
                return match result {
                    Ok(result) => result,
                    Err(error) => Err(format!("OpenTTD reader stopped: {error}")),
                };
            }
        }
    }
}

async fn execute(
    action: &str,
    payload: Value,
    writer: &Writer,
    state: &SharedState,
    pending: &Pending,
    ready: &Notify,
    state_updated: &Notify,
) -> Result<Value, String> {
    if !state.lock().await.authenticated {
        tokio::time::timeout(Duration::from_secs(10), ready.notified())
            .await
            .map_err(|_| "OpenTTD Admin Port authentication timed out".to_owned())?;
    }
    match action {
        "refresh_state" => {
            let updated = state_updated.notified();
            tokio::pin!(updated);
            updated.as_mut().enable();
            poll_state(writer).await?;
            let _ = tokio::time::timeout(Duration::from_secs(2), updated).await;
        }
        "pause_game" | "resume_game" | "save_game" | "send_chat" => {
            let (packet_type, body) = server_action_packet(action, &payload)?;
            send_packet(writer, packet_type, &body).await?;
        }
        "gameplay_command" => {
            let command = payload
                .get("command")
                .and_then(Value::as_object)
                .ok_or("gameplay_command requires payload.command")?;
            let result = gameplay(Value::Object(command.clone()), writer, state, pending).await?;
            return Ok(
                json!({"ok":result.get("ok").and_then(Value::as_bool).unwrap_or(false),"action":action,"result":result}),
            );
        }
        "gameplay_plan" => {
            let commands = payload
                .get("commands")
                .and_then(Value::as_array)
                .filter(|commands| !commands.is_empty() && commands.len() <= 50)
                .ok_or("gameplay_plan requires 1..=50 payload.commands")?;
            let mut results = Vec::new();
            for (index, command) in commands.iter().enumerate() {
                if !command.is_object() {
                    return Err(format!("OpenTTD plan step {} is not an object", index + 1));
                }
                let result = gameplay(command.clone(), writer, state, pending).await?;
                let ok = result.get("ok").and_then(Value::as_bool).unwrap_or(false);
                results.push(json!({"index":index,"command":command,"result":result}));
                if !ok {
                    return Ok(
                        json!({"ok":false,"action":action,"failed_at":index,"results":results}),
                    );
                }
            }
            return Ok(json!({"ok":true,"action":action,"results":results}));
        }
        other => return Err(format!("OpenTTD connector does not support action {other}")),
    }
    let state = state.lock().await;
    Ok(json!({"ok":true,"action":action,"state":snapshot(&state)}))
}

fn server_action_packet(action: &str, payload: &Value) -> Result<(u8, Vec<u8>), String> {
    match action {
        "pause_game" => Ok((ADMIN_RCON, cstring("pause"))),
        "resume_game" => Ok((ADMIN_RCON, cstring("unpause"))),
        "save_game" => {
            let name = payload
                .get("save_name")
                .and_then(Value::as_str)
                .unwrap_or("edenagent");
            if name.is_empty()
                || name.len() > 64
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            {
                return Err(
                    "save_name may only contain ASCII letters, digits, '.', '_' and '-' (max 64)"
                        .to_owned(),
                );
            }
            Ok((ADMIN_RCON, cstring(&format!("save {name}"))))
        }
        "send_chat" => {
            let text = payload
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .ok_or("send_chat requires payload.text")?;
            if text.len() > 4096 || text.contains('\0') {
                return Err(
                    "OpenTTD chat text must be at most 4096 bytes and contain no NUL".to_owned(),
                );
            }
            let mut body = vec![2, 0];
            body.extend_from_slice(&0_u32.to_le_bytes());
            body.extend_from_slice(&cstring(text));
            Ok((ADMIN_CHAT, body))
        }
        other => Err(format!(
            "OpenTTD connector does not support direct server action {other}"
        )),
    }
}

async fn gameplay(
    mut command: Value,
    writer: &Writer,
    state: &SharedState,
    pending: &Pending,
) -> Result<Value, String> {
    if !state.lock().await.bridge_ready {
        return Err(
            "OpenTTD GameScript bridge is not ready; load EdenAgentBridge in the current game"
                .to_owned(),
        );
    }
    let action = command
        .get("action")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("gameplay command.action is required")?;
    let _ = action;
    let request_id = Uuid::now_v7().simple().to_string();
    command["request_id"] = Value::String(request_id.clone());
    let (send, receive) = oneshot::channel();
    pending.lock().await.insert(request_id.clone(), send);
    let encoded = serde_json::to_string(&command).map_err(|error| error.to_string())?;
    if let Err(error) = send_packet(writer, ADMIN_GAMESCRIPT, &cstring(&encoded)).await {
        pending.lock().await.remove(&request_id);
        return Err(error);
    }
    let result = tokio::time::timeout(Duration::from_secs(10), receive)
        .await
        .map_err(|_| "OpenTTD GameScript bridge did not respond within 10 seconds".to_owned())?
        .map_err(|_| "OpenTTD GameScript response channel closed".to_owned())?;
    pending.lock().await.remove(&request_id);
    result
}

fn take_packet(buffer: &mut Vec<u8>) -> Result<Option<(u8, Vec<u8>)>, String> {
    let Some(size) = buffer
        .get(..2)
        .map(|size| u16::from_le_bytes([size[0], size[1]]))
    else {
        return Ok(None);
    };
    let size = usize::from(size);
    if size < 3 {
        return Err(format!("OpenTTD returned invalid packet length {size}"));
    }
    if buffer.len() < size {
        return Ok(None);
    }
    let packet = buffer.drain(..size).collect::<Vec<_>>();
    Ok(Some((packet[2], packet[3..].to_vec())))
}

async fn probe_gameplay_bridge(writer: &Writer, state: &SharedState) -> Result<(), String> {
    state.lock().await.bridge_ready = false;
    let probe = json!({
        "action":"ping",
        "request_id":format!("bridge-probe-{}", Uuid::now_v7().simple()),
    });
    send_packet(
        writer,
        ADMIN_GAMESCRIPT,
        &cstring(&serde_json::to_string(&probe).map_err(|error| error.to_string())?),
    )
    .await
}

async fn read_loop(
    mut reader: ReadHalf<transport::Stream>,
    writer: Writer,
    state: SharedState,
    pending: Pending,
    ready: Arc<Notify>,
    state_updated: Arc<Notify>,
    events: mpsc::Sender<Event>,
) -> Result<(), String> {
    let result = read_loop_inner(
        &mut reader,
        writer,
        state,
        pending.clone(),
        ready,
        state_updated,
        events,
    )
    .await;
    if let Err(error) = result.as_ref() {
        for (_, reply) in pending.lock().await.drain() {
            let _ = reply.send(Err(format!(
                "OpenTTD Admin Port connection closed: {error}"
            )));
        }
    }
    result
}

async fn read_loop_inner(
    reader: &mut ReadHalf<transport::Stream>,
    writer: Writer,
    state: SharedState,
    pending: Pending,
    ready: Arc<Notify>,
    state_updated: Arc<Notify>,
    events: mpsc::Sender<Event>,
) -> Result<(), String> {
    let mut sequence = 0_u32;
    let mut inbound = Vec::<u8>::new();
    loop {
        let (packet_type, body) = loop {
            if let Some(packet) = take_packet(&mut inbound)? {
                break packet;
            }
            let mut chunk = [0_u8; 8192];
            match tokio::time::timeout(Duration::from_secs(30), reader.read(&mut chunk)).await {
                Ok(Ok(0)) => return Err("OpenTTD Admin Port connection closed".to_owned()),
                Ok(Ok(read)) => {
                    inbound.extend_from_slice(&chunk[..read]);
                    if inbound.len() > 1024 * 1024 {
                        return Err("OpenTTD Admin Port receive buffer exceeds 1 MiB".to_owned());
                    }
                }
                Ok(Err(error)) => return Err(error.to_string()),
                Err(_) => {
                    sequence = sequence.wrapping_add(1);
                    send_packet(&writer, ADMIN_PING, &sequence.to_le_bytes()).await?;
                }
            }
        };
        let payload = body.as_slice();
        if packet_type == SERVER_ERROR {
            return Err(format!(
                "OpenTTD Admin Port rejected the connection or command (code {})",
                payload.first().copied().unwrap_or(255)
            ));
        }
        if packet_type == SERVER_PROTOCOL {
            let protocol_version = subscribe(payload, &writer).await?;
            {
                let mut state = state.lock().await;
                state.authenticated = true;
                state
                    .server
                    .insert("admin_protocol_version".to_owned(), protocol_version.into());
            }
            events
                .send(Event::Status {
                    state: "connected".to_owned(),
                    detail: None,
                })
                .await
                .map_err(|_| "OpenTTD event receiver closed".to_owned())?;
            ready.notify_one();
            poll_state(&writer).await?;
            probe_gameplay_bridge(&writer, &state).await?;
            continue;
        }
        if matches!(packet_type, SERVER_RCON_END | SERVER_PONG) {
            continue;
        }
        if let Some((event_type, event_payload, actionable)) =
            decode_packet(packet_type, payload, &state, &pending).await?
        {
            if matches!(
                packet_type,
                SERVER_COMPANY_INFO
                    | SERVER_COMPANY_UPDATE
                    | SERVER_COMPANY_ECONOMY
                    | SERVER_COMPANY_STATS
            ) {
                state_updated.notify_waiters();
            }
            if packet_type == SERVER_NEWGAME {
                probe_gameplay_bridge(&writer, &state).await?;
            }
            if actionable {
                events
                    .send(Event::Published {
                        external_id: format!("openttd:{}", Uuid::now_v7()),
                        event_type,
                        payload: event_payload,
                    })
                    .await
                    .map_err(|_| "OpenTTD event receiver closed".to_owned())?;
            }
        }
    }
}

async fn decode_packet(
    packet_type: u8,
    payload: &[u8],
    state: &SharedState,
    pending: &Pending,
) -> Result<Option<(String, Value, bool)>, String> {
    let mut reader = PacketReader::new(payload);
    let mut state_guard = state.lock().await;
    let (kind, value, actionable) = match packet_type {
        SERVER_WELCOME => {
            state_guard
                .server
                .insert("name".to_owned(), reader.string()?.into());
            state_guard
                .server
                .insert("revision".to_owned(), reader.string()?.into());
            state_guard
                .server
                .insert("dedicated".to_owned(), reader.boolean()?.into());
            state_guard
                .server
                .insert("map_name".to_owned(), reader.string()?.into());
            state_guard
                .server
                .insert("generation_seed".to_owned(), reader.u32()?.into());
            state_guard
                .server
                .insert("landscape".to_owned(), reader.u8()?.into());
            let start_date = reader.u32()?;
            state_guard
                .server
                .insert("start_date".to_owned(), start_date.into());
            state_guard
                .server
                .insert("start_year".to_owned(), (start_date / 365).into());
            state_guard
                .server
                .insert("map_width".to_owned(), reader.u16()?.into());
            state_guard
                .server
                .insert("map_height".to_owned(), reader.u16()?.into());
            ("openttd.server_state", snapshot(&state_guard), false)
        }
        SERVER_DATE => {
            state_guard.date = Some(reader.u32()?);
            ("openttd.date", snapshot(&state_guard), false)
        }
        SERVER_COMPANY_NEW => {
            let id = reader.u8()?;
            state_guard
                .companies
                .entry(id)
                .or_insert_with(|| json_map(json!({"company_id":id})));
            ("openttd.company", snapshot(&state_guard), false)
        }
        SERVER_COMPANY_INFO | SERVER_COMPANY_UPDATE => {
            let id = reader.u8()?;
            let company = state_guard
                .companies
                .entry(id)
                .or_insert_with(|| json_map(json!({"company_id":id})));
            company.insert("name".to_owned(), reader.string()?.into());
            company.insert("president".to_owned(), reader.string()?.into());
            company.insert("colour".to_owned(), reader.u8()?.into());
            company.insert("passworded".to_owned(), reader.boolean()?.into());
            if packet_type == SERVER_COMPANY_INFO {
                company.insert("inaugurated_year".to_owned(), reader.u32()?.into());
                company.insert("is_ai".to_owned(), reader.boolean()?.into());
            }
            company.insert("quarters_bankrupt".to_owned(), reader.u8()?.into());
            ("openttd.company", snapshot(&state_guard), false)
        }
        SERVER_COMPANY_REMOVE => {
            let id = reader.u8()?;
            let reason = reader.u8()?;
            let company = state_guard
                .companies
                .remove(&id)
                .map(Value::Object)
                .unwrap_or_else(|| json!({"company_id":id}));
            (
                "openttd.company_removed",
                json!({"company":company,"reason":reason,"state":snapshot(&state_guard)}),
                true,
            )
        }
        SERVER_COMPANY_ECONOMY => {
            let id = reader.u8()?;
            let economy = json!({
                "money":reader.i64()?,"loan":reader.i64()?,"income":reader.i64()?,"delivered_cargo":reader.u16()?,
                "quarters":[
                    {"company_value":reader.i64()?,"performance":reader.u16()?,"delivered_cargo":reader.u16()?},
                    {"company_value":reader.i64()?,"performance":reader.u16()?,"delivered_cargo":reader.u16()?}
                ]
            });
            state_guard
                .companies
                .entry(id)
                .or_insert_with(|| json_map(json!({"company_id":id})))
                .insert("economy".to_owned(), economy);
            ("openttd.economy", snapshot(&state_guard), false)
        }
        SERVER_COMPANY_STATS => {
            let id = reader.u8()?;
            let vehicles = json!({"train":reader.u16()?,"lorry":reader.u16()?,"bus":reader.u16()?,"aircraft":reader.u16()?,"ship":reader.u16()?});
            let stations = json!({"train":reader.u16()?,"lorry":reader.u16()?,"bus":reader.u16()?,"aircraft":reader.u16()?,"ship":reader.u16()?});
            state_guard
                .companies
                .entry(id)
                .or_insert_with(|| json_map(json!({"company_id":id})))
                .insert(
                    "statistics".to_owned(),
                    json!({"vehicles":vehicles,"stations":stations}),
                );
            ("openttd.statistics", snapshot(&state_guard), false)
        }
        SERVER_CHAT => (
            "openttd.chat",
            json!({"action":reader.u8()?,"destination_type":reader.u8()?,"client_id":reader.u32()?,"message":reader.string()?,"data":reader.u64()?}),
            true,
        ),
        SERVER_CONSOLE => (
            "openttd.console",
            json!({"origin":reader.string()?,"message":reader.string()?}),
            false,
        ),
        SERVER_RCON => (
            "openttd.rcon",
            json!({"colour":reader.u16()?,"message":reader.string()?}),
            false,
        ),
        SERVER_GAMESCRIPT => {
            let raw = reader.string()?;
            let message = serde_json::from_str::<Value>(&raw).unwrap_or(Value::String(raw));
            if let Some(object) = message.as_object() {
                if matches!(
                    object.get("type").and_then(Value::as_str),
                    Some("bridge_ready" | "command_result")
                ) {
                    state_guard.bridge_ready = true;
                }
                if let Some(version) = object.get("bridge_version").and_then(Value::as_i64) {
                    state_guard.bridge_version = Some(version);
                }
                if let Some(request_id) = object.get("request_id").and_then(Value::as_str) {
                    if let Some(reply) = pending.lock().await.remove(request_id) {
                        let _ = reply.send(Ok(message.clone()));
                    }
                }
            }
            let internal = message
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| {
                    matches!(
                        kind,
                        "bridge_ready" | "command_result" | "heartbeat" | "state"
                    )
                });
            ("openttd.gamescript", json!({"message":message}), !internal)
        }
        SERVER_NEWGAME => {
            state_guard.companies.clear();
            state_guard.date = None;
            state_guard.bridge_ready = false;
            ("openttd.new_game", snapshot(&state_guard), true)
        }
        SERVER_SHUTDOWN => ("openttd.shutdown", snapshot(&state_guard), true),
        _ => return Ok(None),
    };
    Ok(Some((kind.to_owned(), value, actionable)))
}

async fn subscribe(payload: &[u8], writer: &Writer) -> Result<u8, String> {
    let (protocol, subscriptions) = negotiated_subscriptions(payload)?;
    for (update, frequency) in subscriptions {
        let mut body = update.to_le_bytes().to_vec();
        body.extend_from_slice(&frequency.to_le_bytes());
        send_packet(writer, ADMIN_UPDATE_FREQUENCY, &body).await?;
    }
    Ok(protocol)
}

fn negotiated_subscriptions(payload: &[u8]) -> Result<(u8, Vec<(u16, u16)>), String> {
    let mut reader = PacketReader::new(payload);
    let protocol = reader.u8()?;
    let mut supported = HashMap::new();
    while reader.remaining() > 0 && reader.boolean()? {
        supported.insert(reader.u16()?, reader.u16()?);
    }
    let subscriptions = [
        (UPDATE_DATE, FREQUENCY_DAILY),
        (UPDATE_COMPANY_INFO, FREQUENCY_AUTOMATIC),
        (UPDATE_COMPANY_ECONOMY, FREQUENCY_QUARTERLY),
        (UPDATE_COMPANY_STATS, FREQUENCY_QUARTERLY),
        (UPDATE_CHAT, FREQUENCY_AUTOMATIC),
        (UPDATE_CONSOLE, FREQUENCY_AUTOMATIC),
        (UPDATE_GAMESCRIPT, FREQUENCY_AUTOMATIC),
    ]
    .into_iter()
    .filter_map(|(update, preferred)| {
        let frequencies = supported.get(&update).copied().unwrap_or(0);
        (frequencies & preferred != 0).then_some((update, preferred))
    })
    .collect::<Vec<_>>();
    Ok((protocol, subscriptions))
}

async fn poll_state(writer: &Writer) -> Result<(), String> {
    for (update, target) in [
        (UPDATE_DATE, 0_u32),
        (UPDATE_COMPANY_INFO, u32::MAX),
        (UPDATE_COMPANY_ECONOMY, 0),
        (UPDATE_COMPANY_STATS, 0),
    ] {
        let mut body = vec![update as u8];
        body.extend_from_slice(&target.to_le_bytes());
        send_packet(writer, ADMIN_POLL, &body).await?;
    }
    Ok(())
}

async fn send_packet(writer: &Writer, packet_type: u8, payload: &[u8]) -> Result<(), String> {
    let packet = encode_packet(packet_type, payload)?;
    writer
        .lock()
        .await
        .write_all(&packet)
        .await
        .map_err(|error| error.to_string())
}

fn encode_packet(packet_type: u8, payload: &[u8]) -> Result<Vec<u8>, String> {
    let size = 3_usize.saturating_add(payload.len());
    let size = u16::try_from(size).map_err(|_| "OpenTTD packet is too large".to_owned())?;
    let mut packet = size.to_le_bytes().to_vec();
    packet.push(packet_type);
    packet.extend_from_slice(payload);
    Ok(packet)
}

fn cstring(value: &str) -> Vec<u8> {
    let mut result = value.as_bytes().to_vec();
    result.push(0);
    result
}

fn snapshot(state: &State) -> Value {
    let mut companies = state
        .companies
        .iter()
        .map(|(id, value)| (*id, Value::Object(value.clone())))
        .collect::<Vec<_>>();
    companies.sort_by_key(|(id, _)| *id);
    let instance = state.instance.as_ref().map(|instance| json!({
        "instance_id":instance.instance_id,"host":instance.host,"game_port":instance.game_port,
        "admin_port":instance.admin_port,"pid":instance.pid,"mode":instance.mode,"started_at":instance.started_at
    }));
    json!({
        "instance":instance,"date":state.date,"year":state.date.map(|date| date / 365),
        "server":state.server,"companies":companies.into_iter().map(|(_, value)| value).collect::<Vec<_>>(),
        "capabilities":{"observe_admin_state":true,"server_management":true,
            "company_gameplay":state.bridge_ready,"gameplay_bridge_ready":state.bridge_ready,
            "bridge_version":state.bridge_version}
    })
}

async fn load_instance(config: &Config) -> Result<Instance, String> {
    let configured_host = config.settings.get("host").and_then(Value::as_str);
    let configured_admin_port = config.settings.get("adminPort").and_then(Value::as_u64);
    if configured_host.is_some() || configured_admin_port.is_some() {
        let host = configured_host.ok_or("host is required when adminPort is configured")?;
        let admin_port =
            configured_admin_port.ok_or("adminPort is required when host is configured")?;
        let game_port = config
            .settings
            .get("gamePort")
            .and_then(Value::as_u64)
            .unwrap_or(3979);
        return validate_instance(
            Instance {
                instance_id: config.identity_key.clone(),
                host: host.to_owned(),
                game_port: u16::try_from(game_port)
                    .map_err(|_| "gamePort is out of range".to_owned())?,
                admin_port: u16::try_from(admin_port)
                    .map_err(|_| "adminPort is out of range".to_owned())?,
                pid: 0,
                mode: "configured".to_owned(),
                started_at: String::new(),
                config_path: None,
                process_start_ticks: None,
                process_executable: None,
                launch_target: None,
            },
            false,
        );
    }
    let path = config
        .settings
        .get("instanceRegistry")
        .or_else(|| config.settings.get("instance_registry"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(default_registry);
    let bytes = tokio::fs::read(&path).await.map_err(|error| {
        format!(
            "no valid active OpenTTD instance at {}: {error}",
            path.display()
        )
    })?;
    let instance = serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "invalid OpenTTD instance registry {}: {error}",
            path.display()
        )
    })?;
    validate_instance(instance, true).map_err(|error| {
        format!(
            "invalid OpenTTD instance registry {}: {error}",
            path.display()
        )
    })
}

fn default_registry() -> PathBuf {
    if let Some(path) =
        std::env::var_os("MON_OPENTTD_INSTANCE_REGISTRY").filter(|path| !path.is_empty())
    {
        return PathBuf::from(path);
    }
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("edenagent-openttd/active-instance.json")
}

fn validate_instance(
    mut instance: Instance,
    require_live_process: bool,
) -> Result<Instance, String> {
    instance.instance_id = instance.instance_id.trim().to_owned();
    instance.host = instance.host.trim().to_owned();
    instance.mode = instance.mode.trim().to_owned();
    instance.started_at = instance.started_at.trim().to_owned();
    if instance.instance_id.is_empty() || instance.host.is_empty() || instance.mode.is_empty() {
        return Err("instance identity, host and mode must not be empty".to_owned());
    }
    if !matches!(instance.host.as_str(), "127.0.0.1" | "localhost") {
        return Err("OpenTTD Admin Port host must remain loopback".to_owned());
    }
    if instance.game_port == 0
        || instance.admin_port == 0
        || instance.game_port == instance.admin_port
    {
        return Err("game and admin ports must be distinct values in 1..=65535".to_owned());
    }
    if require_live_process {
        if !instance
            .instance_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
            || instance.instance_id.len() != 32
        {
            return Err(
                "managed instance id must contain exactly 32 hexadecimal digits".to_owned(),
            );
        }
        if !matches!(instance.mode.as_str(), "host" | "dedicated") {
            return Err("managed instance mode must be host or dedicated".to_owned());
        }
        if instance.started_at.is_empty() {
            return Err("managed instance start timestamp is required".to_owned());
        }
        if instance.pid <= 0 {
            return Err("managed instance pid must be positive".to_owned());
        }
        if !process_is_alive(instance.pid) {
            return Err(format!(
                "managed OpenTTD instance {} is no longer running",
                instance.instance_id
            ));
        }
        validate_managed_process_identity(&instance)?;
    }
    Ok(instance)
}

#[cfg(target_os = "linux")]
fn validate_managed_process_identity(instance: &Instance) -> Result<(), String> {
    use std::os::unix::ffi::OsStrExt;

    let expected_ticks = instance
        .process_start_ticks
        .as_deref()
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or("managed process start ticks are invalid")?;
    let expected_executable = absolute_path(
        instance.process_executable.as_deref(),
        "managed process executable",
    )?;
    let launch_target = absolute_path(instance.launch_target.as_deref(), "managed launch target")?;
    absolute_path(instance.config_path.as_deref(), "managed config path")?;
    let actual_ticks = linux_process_start_ticks(instance.pid)?;
    if actual_ticks != expected_ticks {
        return Err("managed OpenTTD process start identity changed".to_owned());
    }
    let process_root = PathBuf::from(format!("/proc/{}/", instance.pid));
    let actual_executable = std::fs::read_link(process_root.join("exe"))
        .map_err(|error| format!("cannot inspect managed process executable: {error}"))?
        .canonicalize()
        .map_err(|error| format!("cannot canonicalize managed process executable: {error}"))?;
    if actual_executable != expected_executable {
        return Err("managed OpenTTD process executable changed".to_owned());
    }
    let command_line = std::fs::read(process_root.join("cmdline"))
        .map_err(|error| format!("cannot inspect managed process command line: {error}"))?;
    let command_contains_target = actual_executable == launch_target
        || command_line
            .split(|byte| *byte == 0)
            .filter(|argument| !argument.is_empty())
            .map(std::ffi::OsStr::from_bytes)
            .map(Path::new)
            .filter(|argument| argument.is_absolute())
            .filter_map(|argument| argument.canonicalize().ok())
            .any(|argument| argument == launch_target);
    if !command_contains_target {
        return Err(
            "managed process no longer contains the registered OpenTTD launch target".to_owned(),
        );
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_process_start_ticks(pid: i64) -> Result<String, String> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .map_err(|error| format!("cannot inspect managed process start time: {error}"))?;
    let command_end = stat.rfind(')').ok_or("managed process stat is malformed")?;
    stat[command_end + 1..]
        .split_whitespace()
        .nth(19)
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .map(str::to_owned)
        .ok_or_else(|| "managed process start time is missing".to_owned())
}

#[cfg(target_os = "linux")]
fn absolute_path(value: Option<&Path>, label: &str) -> Result<PathBuf, String> {
    let value = value
        .filter(|path| path.is_absolute())
        .ok_or_else(|| format!("{label} must be absolute"))?;
    value
        .canonicalize()
        .map_err(|error| format!("cannot canonicalize {label}: {error}"))
}

#[cfg(not(target_os = "linux"))]
fn validate_managed_process_identity(_instance: &Instance) -> Result<(), String> {
    Err("managed OpenTTD instance registries require Linux process identity support".to_owned())
}

#[cfg(unix)]
fn process_is_alive(pid: i64) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    if unsafe { libc::kill(pid, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn process_is_alive(pid: i64) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_ACCESS_DENIED, GetLastError},
        System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };

    let Ok(pid) = u32::try_from(pid) else {
        return false;
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return unsafe { GetLastError() } == ERROR_ACCESS_DENIED;
    }
    unsafe { CloseHandle(handle) };
    true
}

#[cfg(not(any(unix, windows)))]
fn process_is_alive(pid: i64) -> bool {
    pid > 0
}

fn openttd_password_environment(identity_key: &str) -> Result<String, String> {
    let mut identity = String::new();
    for character in identity_key.chars() {
        if character.is_ascii_alphanumeric() {
            identity.push(character.to_ascii_uppercase());
        } else if !identity.is_empty() && !identity.ends_with('_') {
            identity.push('_');
        }
    }
    while identity.ends_with('_') {
        identity.pop();
    }
    if identity.is_empty() {
        return Err("OpenTTD identity key does not contain an ASCII identifier".to_owned());
    }
    Ok(format!("MON_CONNECTOR_OPENTTD_{identity}"))
}

fn openttd_password_variable(config: &Config) -> Result<String, String> {
    let default_variable = config
        .credential_environment
        .clone()
        .map(Ok)
        .unwrap_or_else(|| openttd_password_environment(&config.identity_key))?;
    Ok(config
        .settings
        .get("passwordEnv")
        .or_else(|| config.settings.get("password_env"))
        .and_then(Value::as_str)
        .filter(|variable| !variable.trim().is_empty())
        .unwrap_or(&default_variable)
        .to_owned())
}

fn password(config: &Config) -> Result<String, String> {
    let variable = openttd_password_variable(config)?;
    std::env::var(&variable)
        .map_err(|_| format!("missing OpenTTD Admin Port credential: {variable}"))
        .and_then(|value| {
            let value = value.trim().to_owned();
            if value.is_empty() {
                Err(format!("empty OpenTTD Admin Port credential: {variable}"))
            } else {
                Ok(value)
            }
        })
}

fn json_map(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

struct PacketReader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> PacketReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }
    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.offset)
    }
    fn take<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let end = self.offset.saturating_add(N);
        let bytes = self
            .data
            .get(self.offset..end)
            .ok_or("truncated OpenTTD packet")?;
        self.offset = end;
        bytes
            .try_into()
            .map_err(|_| "truncated OpenTTD packet".to_owned())
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take::<1>()?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.take()?))
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take()?))
    }
    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.take()?))
    }
    fn i64(&mut self) -> Result<i64, String> {
        Ok(i64::from_le_bytes(self.take()?))
    }
    fn boolean(&mut self) -> Result<bool, String> {
        Ok(self.u8()? != 0)
    }
    fn string(&mut self) -> Result<String, String> {
        let relative = self
            .data
            .get(self.offset..)
            .and_then(|data| data.iter().position(|byte| *byte == 0))
            .ok_or("unterminated OpenTTD string")?;
        let end = self.offset + relative;
        let value = String::from_utf8_lossy(&self.data[self.offset..end]).into_owned();
        self.offset = end + 1;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connector(identity_key: &str, settings: Value) -> Config {
        Config {
            identity_key: identity_key.to_owned(),
            settings,
            credential_environment: None,
        }
    }

    #[test]
    fn packet_reader_decodes_little_endian_and_strings() {
        let mut reader = PacketReader::new(&[7, 0x34, 0x12, b'o', b'k', 0]);
        assert_eq!(reader.u8().unwrap(), 7);
        assert_eq!(reader.u16().unwrap(), 0x1234);
        assert_eq!(reader.string().unwrap(), "ok");
    }

    #[test]
    fn packet_framing_includes_header_type_and_preserves_partial_input() {
        let packet = encode_packet(ADMIN_POLL, b"abc").expect("packet");
        assert_eq!(u16::from_le_bytes([packet[0], packet[1]]), 6);
        assert_eq!(&packet[2..], &[ADMIN_POLL, b'a', b'b', b'c']);

        let mut input = packet[..4].to_vec();
        assert!(take_packet(&mut input).expect("partial packet").is_none());
        input.extend_from_slice(&packet[4..]);
        let (packet_type, payload) = take_packet(&mut input)
            .expect("complete packet")
            .expect("packet");
        assert_eq!(packet_type, ADMIN_POLL);
        assert_eq!(payload, b"abc");
        assert!(input.is_empty());
        assert!(encode_packet(ADMIN_CHAT, &vec![0; usize::from(u16::MAX)]).is_err());
        let mut invalid = vec![2, 0];
        assert!(take_packet(&mut invalid).is_err());
    }

    #[test]
    fn protocol_negotiation_selects_only_supported_preferred_frequencies() {
        let mut payload = vec![3];
        for (update, frequencies) in [
            (UPDATE_DATE, FREQUENCY_DAILY),
            (UPDATE_COMPANY_INFO, FREQUENCY_AUTOMATIC),
            (UPDATE_COMPANY_ECONOMY, FREQUENCY_QUARTERLY),
            (UPDATE_COMPANY_STATS, FREQUENCY_QUARTERLY),
            (UPDATE_CHAT, FREQUENCY_AUTOMATIC),
            (UPDATE_CONSOLE, 0),
            (UPDATE_GAMESCRIPT, FREQUENCY_AUTOMATIC),
        ] {
            payload.push(1);
            payload.extend_from_slice(&update.to_le_bytes());
            payload.extend_from_slice(&frequencies.to_le_bytes());
        }
        payload.push(0);
        let (version, subscriptions) =
            negotiated_subscriptions(&payload).expect("protocol negotiation");
        assert_eq!(version, 3);
        assert_eq!(
            subscriptions,
            vec![
                (UPDATE_DATE, FREQUENCY_DAILY),
                (UPDATE_COMPANY_INFO, FREQUENCY_AUTOMATIC),
                (UPDATE_COMPANY_ECONOMY, FREQUENCY_QUARTERLY),
                (UPDATE_COMPANY_STATS, FREQUENCY_QUARTERLY),
                (UPDATE_CHAT, FREQUENCY_AUTOMATIC),
                (UPDATE_GAMESCRIPT, FREQUENCY_AUTOMATIC),
            ]
        );
    }

    #[test]
    fn server_actions_encode_exact_admin_port_payloads() {
        assert_eq!(
            server_action_packet("pause_game", &json!({})).expect("pause"),
            (ADMIN_RCON, cstring("pause"))
        );
        assert_eq!(
            server_action_packet("resume_game", &json!({})).expect("resume"),
            (ADMIN_RCON, cstring("unpause"))
        );
        assert_eq!(
            server_action_packet("save_game", &json!({"save_name":"route-01"})).expect("save"),
            (ADMIN_RCON, cstring("save route-01"))
        );
        let (packet_type, chat) =
            server_action_packet("send_chat", &json!({"text":" 你好 "})).expect("chat");
        assert_eq!(packet_type, ADMIN_CHAT);
        assert_eq!(&chat[..6], &[2, 0, 0, 0, 0, 0]);
        assert_eq!(&chat[6..], cstring("你好"));
        assert!(server_action_packet("save_game", &json!({"save_name":"../escape"})).is_err());
        assert!(server_action_packet("send_chat", &json!({"text":"bad\0text"})).is_err());
    }

    #[tokio::test]
    async fn packet_decoder_builds_server_company_and_economy_state() {
        let state = Arc::new(Mutex::new(State::default()));
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let welcome = [
            cstring("Eden Agent OpenTTD"),
            cstring("15.3"),
            vec![1],
            cstring("Test Map"),
            42_u32.to_le_bytes().to_vec(),
            vec![0],
            (1950_u32 * 365).to_le_bytes().to_vec(),
            256_u16.to_le_bytes().to_vec(),
            512_u16.to_le_bytes().to_vec(),
        ]
        .concat();
        let (event_type, payload, actionable) =
            decode_packet(SERVER_WELCOME, &welcome, &state, &pending)
                .await
                .expect("welcome decode")
                .expect("welcome event");
        assert_eq!(event_type, "openttd.server_state");
        assert!(!actionable);
        assert_eq!(payload["server"]["map_width"], 256);
        assert_eq!(payload["server"]["map_height"], 512);
        assert_eq!(payload["server"]["start_year"], 1950);
        assert_eq!(payload["capabilities"]["company_gameplay"], false);

        let company = [
            vec![1],
            cstring("凯伊运输"),
            cstring("凯伊"),
            vec![3, 1],
            1950_u32.to_le_bytes().to_vec(),
            vec![0, 0],
        ]
        .concat();
        decode_packet(SERVER_COMPANY_INFO, &company, &state, &pending)
            .await
            .expect("company decode")
            .expect("company event");

        let economy = [
            vec![1],
            100_000_i64.to_le_bytes().to_vec(),
            20_000_i64.to_le_bytes().to_vec(),
            5_000_i64.to_le_bytes().to_vec(),
            8_u16.to_le_bytes().to_vec(),
            120_000_i64.to_le_bytes().to_vec(),
            400_u16.to_le_bytes().to_vec(),
            7_u16.to_le_bytes().to_vec(),
            110_000_i64.to_le_bytes().to_vec(),
            350_u16.to_le_bytes().to_vec(),
            6_u16.to_le_bytes().to_vec(),
        ]
        .concat();
        let (_, payload, actionable) =
            decode_packet(SERVER_COMPANY_ECONOMY, &economy, &state, &pending)
                .await
                .expect("economy decode")
                .expect("economy event");
        assert!(!actionable);
        assert_eq!(payload["companies"][0]["name"], "凯伊运输");
        assert_eq!(payload["companies"][0]["economy"]["money"], 100_000);
    }

    #[tokio::test]
    async fn gamescript_response_matches_request_and_internal_events_are_not_actionable() {
        let state = Arc::new(Mutex::new(State::default()));
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (reply, receive) = oneshot::channel();
        pending.lock().await.insert("request-1".to_owned(), reply);
        let message = cstring(
            &json!({
                "type":"command_result",
                "request_id":"request-1",
                "bridge_version":2,
                "ok":true,
            })
            .to_string(),
        );
        let (_, _, actionable) = decode_packet(SERVER_GAMESCRIPT, &message, &state, &pending)
            .await
            .expect("response decode")
            .expect("response event");
        assert!(!actionable);
        assert_eq!(
            receive
                .await
                .expect("matching response")
                .expect("successful response")["ok"],
            true
        );
        assert!(state.lock().await.bridge_ready);
        assert_eq!(state.lock().await.bridge_version, Some(2));
        assert!(pending.lock().await.is_empty());

        let event = cstring(&json!({"type":"vehicle_stuck","vehicle_id":7}).to_string());
        let (_, payload, actionable) = decode_packet(SERVER_GAMESCRIPT, &event, &state, &pending)
            .await
            .expect("event decode")
            .expect("event");
        assert!(actionable);
        assert_eq!(payload["message"]["vehicle_id"], 7);
    }

    #[test]
    fn password_environment_is_isolated_by_instance_identity_and_can_be_overridden() {
        assert_eq!(
            openttd_password_environment(" Local / Main ").expect("environment"),
            "MON_CONNECTOR_OPENTTD_LOCAL_MAIN"
        );
        assert!(openttd_password_environment("_-_").is_err());
        assert_eq!(
            openttd_password_variable(&connector(
                "local",
                json!({"passwordEnv":"MON_SECRET_OPENTTD"}),
            ))
            .expect("override"),
            "MON_SECRET_OPENTTD"
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn instance_registry_is_validated_as_live_connection_identity() {
        let directory = tempfile::tempdir().expect("tempdir");
        let registry = directory.path().join("active-instance.json");
        let config_path = directory.path().join("instance.cfg");
        tokio::fs::write(&config_path, "[network]\n")
            .await
            .expect("instance config");
        let executable = std::env::current_exe()
            .expect("current executable")
            .canonicalize()
            .expect("canonical executable");
        let start_ticks =
            linux_process_start_ticks(i64::from(std::process::id())).expect("process start ticks");
        tokio::fs::write(
            &registry,
            serde_json::to_vec(&json!({
                "instance_id":"0123456789abcdef0123456789abcdef",
                "host":"127.0.0.1",
                "game_port":43124,
                "admin_port":43123,
                "pid":std::process::id(),
                "mode":"host",
                "started_at":"2026-08-19T00:00:00Z",
                "config_path":config_path.clone(),
                "process_start_ticks":start_ticks,
                "process_executable":executable.clone(),
                "launch_target":executable.clone(),
            }))
            .expect("registry json"),
        )
        .await
        .expect("write registry");
        let instance = load_instance(&connector(
            "local",
            json!({"instanceRegistry":registry.clone()}),
        ))
        .await
        .expect("active instance");
        assert_eq!(instance.instance_id, "0123456789abcdef0123456789abcdef");
        assert_eq!(instance.admin_port, 43123);
        assert_eq!(instance.pid, i64::from(std::process::id()));
        assert!(process_is_alive(instance.pid));

        tokio::fs::write(
            &registry,
            serde_json::to_vec(&json!({
                "instance_id":"0123456789abcdef0123456789abcdef",
                "host":"127.0.0.1",
                "game_port":43124,
                "admin_port":43123,
                "pid":std::process::id(),
                "mode":"host",
                "started_at":"2026-08-19T00:00:00Z",
                "config_path":config_path.clone(),
                "process_start_ticks":"1",
                "process_executable":executable.clone(),
                "launch_target":executable.clone(),
            }))
            .expect("changed identity json"),
        )
        .await
        .expect("write changed identity");
        assert!(
            load_instance(&connector(
                "local",
                json!({"instanceRegistry":registry.clone()}),
            ))
            .await
            .expect_err("changed process identity must fail")
            .contains("start identity changed")
        );

        tokio::fs::write(
            &registry,
            serde_json::to_vec(&json!({
                "instance_id":"fedcba9876543210fedcba9876543210",
                "host":"127.0.0.1",
                "game_port":43124,
                "admin_port":43123,
                "pid":i64::MAX,
                "mode":"host",
                "started_at":"2026-08-19T00:00:00Z",
                "config_path":config_path.clone(),
                "process_start_ticks":"1",
                "process_executable":executable.clone(),
                "launch_target":executable.clone(),
            }))
            .expect("stale registry json"),
        )
        .await
        .expect("write stale registry");
        assert!(
            load_instance(&connector(
                "local",
                json!({"instanceRegistry":registry.clone()}),
            ))
            .await
            .expect_err("stale process must fail")
            .contains("no longer running")
        );

        assert!(
            load_instance(&connector("local", json!({"host":"127.0.0.1"})))
                .await
                .expect_err("partial explicit endpoint must fail")
                .contains("adminPort")
        );
        assert!(
            load_instance(&connector(
                "local",
                json!({"host":"127.0.0.1","adminPort":43123,"gamePort":70000}),
            ))
            .await
            .expect_err("out-of-range port must fail")
            .contains("gamePort")
        );
    }
}
