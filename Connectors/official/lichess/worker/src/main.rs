use eden_agent_connector_protocol::{
    CapabilityCall, InitializeParams, InitializeResult, PublishedEvent, RpcNotification,
    RpcRequest, RpcResponse, WireMessage, WorkerStatus, method, read_message, write_message,
};
use futures::StreamExt;
use reqwest::Client;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use shakmaty::{CastlingMode, Chess, Color, EnPassantMode, Position, fen::Fen, uci::UciMove};
use std::{collections::HashSet, process::ExitCode, sync::Arc, time::Duration};
use tokio::{io::Stdout, sync::Mutex, task::JoinHandle};
use tokio_util::sync::CancellationToken;

const CONNECTOR_ID: &str = "lichess";
const WORKER_VERSION: &str = env!("CARGO_PKG_VERSION");
type SharedWriter = Arc<Mutex<Stdout>>;

struct Runtime {
    client: Client,
    base: String,
    token: String,
    cancellation: CancellationToken,
    stream_task: JoinHandle<Result<(), String>>,
}

impl Runtime {
    async fn shutdown(self) {
        self.cancellation.cancel();
        let _ = self.stream_task.await;
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Lichess connector worker failed: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), String> {
    let writer = Arc::new(Mutex::new(tokio::io::stdout()));
    let mut reader = tokio::io::stdin();
    let mut runtime = None;
    while let Some(message) = read_message(&mut reader)
        .await
        .map_err(|error| error.to_string())?
    {
        let WireMessage::Request(request) = message else {
            return Err("host sent a non-request message".to_owned());
        };
        let should_shutdown = request.method == method::SHUTDOWN;
        let response = handle_request(request, &writer, &mut runtime).await;
        send(&writer, WireMessage::Response(response)).await?;
        if should_shutdown {
            break;
        }
    }
    if let Some(runtime) = runtime.take() {
        runtime.shutdown().await;
    }
    Ok(())
}

async fn handle_request(
    request: RpcRequest,
    writer: &SharedWriter,
    runtime: &mut Option<Runtime>,
) -> RpcResponse {
    let result = match request.method.as_str() {
        method::INITIALIZE => initialize(request.params, writer, runtime).await,
        method::HEALTH => health(runtime).await,
        method::EXECUTE => execute(request.params, runtime).await,
        method::DISCONNECT | method::SHUTDOWN => disconnect(runtime).await,
        method::QUERY => Err((
            "unsupported_operation",
            "Lichess exposes no queries".to_owned(),
        )),
        unknown => Err((
            "method_not_found",
            format!("unsupported worker method {unknown}"),
        )),
    };
    match result {
        Ok(value) => RpcResponse::success(request.id, value),
        Err((code, message)) => RpcResponse::failure(request.id, code, message),
    }
}

async fn initialize(
    params: Value,
    writer: &SharedWriter,
    runtime: &mut Option<Runtime>,
) -> Result<Value, (&'static str, String)> {
    if runtime.is_some() {
        return Err((
            "already_initialized",
            "worker has already been initialized".to_owned(),
        ));
    }
    let params: InitializeParams =
        serde_json::from_value(params).map_err(|error| ("invalid_params", error.to_string()))?;
    if params.protocol_version != eden_agent_connector_protocol::PROTOCOL_VERSION {
        return Err((
            "unsupported_protocol",
            "unsupported connector protocol version".to_owned(),
        ));
    }
    if params.connector_key != CONNECTOR_ID {
        return Err((
            "connector_mismatch",
            format!("worker cannot serve connector {}", params.connector_key),
        ));
    }
    let base = params
        .settings
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or("https://lichess.org")
        .trim_end_matches('/')
        .to_owned();
    validate_base_url(&base).map_err(|error| ("invalid_settings", error))?;
    let identity_key = std::env::var("MON_CONNECTOR_IDENTITY_KEY").map_err(|_| {
        (
            "invalid_identity",
            "connector identity key is missing".to_owned(),
        )
    })?;
    credential_environment(&identity_key).map_err(|error| ("invalid_identity", error))?;
    let token_name = params
        .settings
        .get("tokenEnv")
        .and_then(Value::as_str)
        .unwrap_or("MON_CONNECTOR_IDENTITY_CREDENTIAL")
        .to_owned();
    let token = std::env::var(&token_name).map_err(|_| {
        (
            "missing_credential",
            format!("credential environment variable is missing: {token_name}"),
        )
    })?;
    let token = token.trim().to_owned();
    if token.is_empty() {
        return Err((
            "missing_credential",
            format!("credential environment variable is empty: {token_name}"),
        ));
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .user_agent("Eden Agent-Lichess-Worker/1")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| ("client_error", error.to_string()))?;
    let cancellation = CancellationToken::new();
    let stream_writer = Arc::clone(writer);
    let stream_client = client.clone();
    let stream_base = base.clone();
    let stream_token = token.clone();
    let stream_cancellation = cancellation.clone();
    let stream_task = tokio::spawn(async move {
        let result = stream_events(
            stream_client,
            stream_base,
            stream_token,
            identity_key,
            stream_cancellation,
            Arc::clone(&stream_writer),
        )
        .await;
        if let Err(error) = &result {
            let _ = send(
                &stream_writer,
                WireMessage::Notification(RpcNotification {
                    method: method::STATUS.to_owned(),
                    params: serialize(WorkerStatus {
                        state: "degraded".to_owned(),
                        detail: Some(error.clone()),
                    }),
                }),
            )
            .await;
        }
        result
    });
    *runtime = Some(Runtime {
        client,
        base,
        token,
        cancellation,
        stream_task,
    });
    serde_json::to_value(InitializeResult {
        protocol_version: eden_agent_connector_protocol::PROTOCOL_VERSION,
        worker_version: WORKER_VERSION.to_owned(),
        capabilities: vec![
            "challenge".to_owned(),
            "game_state".to_owned(),
            "accept_challenge".to_owned(),
            "decline_challenge".to_owned(),
            "make_move".to_owned(),
            "resign".to_owned(),
            "offer_draw".to_owned(),
            "send_chat".to_owned(),
        ],
    })
    .map_err(|error| ("internal_error", error.to_string()))
}

async fn health(runtime: &Option<Runtime>) -> Result<Value, (&'static str, String)> {
    Ok(
        json!({"state":if runtime.is_some() { "ready" } else { "starting" },"initialized":runtime.is_some()}),
    )
}

async fn execute(
    params: Value,
    runtime: &Option<Runtime>,
) -> Result<Value, (&'static str, String)> {
    let call: CapabilityCall =
        serde_json::from_value(params).map_err(|error| ("invalid_params", error.to_string()))?;
    let runtime = runtime.as_ref().ok_or((
        "not_initialized",
        "worker has not been initialized".to_owned(),
    ))?;
    let request = action_request(&call.capability, &call.payload)
        .map_err(|error| ("invalid_action", error))?;
    let response = runtime
        .client
        .post(format!("{}{}", runtime.base, request.path))
        .bearer_auth(&runtime.token)
        .form(&request.form)
        .send()
        .await
        .map_err(|error| ("request_failed", error.to_string()))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| ("request_failed", error.to_string()))?;
    if !status.is_success() {
        return Err(("remote_error", format!("Lichess returned {status}: {text}")));
    }
    Ok(
        json!({"ok":true,"status":status.as_u16(),"result":serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text))}),
    )
}

async fn disconnect(runtime: &mut Option<Runtime>) -> Result<Value, (&'static str, String)> {
    if let Some(runtime) = runtime.take() {
        runtime.shutdown().await;
    }
    Ok(json!({"disconnected":true}))
}

async fn stream_events(
    client: Client,
    base: String,
    token: String,
    identity_key: String,
    cancellation: CancellationToken,
    writer: SharedWriter,
) -> Result<(), String> {
    let response = tokio::select! {
        _ = cancellation.cancelled() => return Ok(()),
        response = client.get(format!("{base}/api/stream/event"))
            .header("Accept", "application/x-ndjson").bearer_auth(&token).send() =>
            response.map_err(|error| error.to_string())?,
    };
    if !response.status().is_success() {
        return Err(format!("Lichess stream returned {}", response.status()));
    }
    send(
        &writer,
        WireMessage::Notification(RpcNotification {
            method: method::STATUS.to_owned(),
            params: serialize(WorkerStatus {
                state: "ready".to_owned(),
                detail: None,
            }),
        }),
    )
    .await?;
    let mut stream = response.bytes_stream();
    let mut pending = Vec::new();
    let games_cancellation = cancellation.child_token();
    let mut game_ids = HashSet::new();
    let mut game_tasks = tokio::task::JoinSet::new();
    let result = loop {
        tokio::select! {
            _ = cancellation.cancelled() => break Ok(()),
            completed = game_tasks.join_next(), if !game_tasks.is_empty() => {
                if let Some(Ok((game_id, result))) = completed {
                    game_ids.remove(&game_id);
                    result?;
                }
            }
            chunk = stream.next() => match chunk {
                Some(Ok(chunk)) => {
                    pending.extend_from_slice(&chunk);
                    for payload in drain_ndjson(&mut pending)? {
                        if payload.get("type").and_then(Value::as_str).is_some_and(|kind| kind.starts_with("challenge")) {
                            publish(&writer, "challenge", stable_event_id("account", &payload), payload.clone()).await?;
                        }
                        if let Some(game_id) = game_start_id(&payload) && game_ids.insert(game_id.clone()) {
                            let task_client = client.clone();
                            let task_base = base.clone();
                            let task_token = token.clone();
                            let task_identity = identity_key.clone();
                            let task_cancel = games_cancellation.child_token();
                            let task_writer = Arc::clone(&writer);
                            game_tasks.spawn(async move {
                                let result = stream_game(task_client, &task_base, &task_token, &task_identity, &game_id, task_cancel, task_writer).await;
                                (game_id, result)
                            });
                        }
                    }
                }
                Some(Err(error)) => break Err(error.to_string()),
                None => break Err("Lichess event stream ended".to_owned()),
            }
        }
    };
    games_cancellation.cancel();
    while game_tasks.join_next().await.is_some() {}
    result
}

async fn stream_game(
    client: Client,
    base: &str,
    token: &str,
    identity_key: &str,
    game_id: &str,
    cancellation: CancellationToken,
    writer: SharedWriter,
) -> Result<(), String> {
    let game_id = safe_segment(game_id, "game_id")?.to_owned();
    let response = tokio::select! {
        _ = cancellation.cancelled() => return Ok(()),
        response = client.get(format!("{base}/api/bot/game/stream/{game_id}"))
            .header("Accept", "application/x-ndjson").bearer_auth(token).send() =>
            response.map_err(|error| error.to_string())?,
    };
    if !response.status().is_success() {
        return Err(format!(
            "Lichess game stream {game_id} returned {}",
            response.status()
        ));
    }
    let mut stream = response.bytes_stream();
    let mut pending = Vec::new();
    let mut game_full = json!({});
    loop {
        tokio::select! {
            _ = cancellation.cancelled() => return Ok(()),
            chunk = stream.next() => match chunk {
                Some(Ok(chunk)) => {
                    pending.extend_from_slice(&chunk);
                    for state in drain_ndjson(&mut pending)? {
                        match state.get("type").and_then(Value::as_str) {
                            Some("gameFull") => game_full = state.clone(),
                            Some("gameState") => { game_full.as_object_mut().ok_or("invalid cached game context")?.insert("state".to_owned(), state.clone()); }
                            _ => {}
                        }
                        let payload = json!({"game_id":game_id,"raw":state,"position":position(&game_id, identity_key, &game_full, &state)});
                        publish(&writer, "game_state", stable_event_id(&format!("game:{game_id}"), &payload), payload).await?;
                    }
                }
                Some(Err(error)) => return Err(error.to_string()),
                None => return Ok(()),
            }
        }
    }
}

async fn publish(
    writer: &SharedWriter,
    event_type: &str,
    external_id: String,
    payload: Value,
) -> Result<(), String> {
    send(
        writer,
        WireMessage::Notification(RpcNotification {
            method: method::EVENT_PUBLISH.to_owned(),
            params: serialize(PublishedEvent {
                external_id,
                event_type: event_type.to_owned(),
                payload,
            }),
        }),
    )
    .await
}

fn credential_environment(identity_key: &str) -> Result<String, String> {
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
        return Err("Lichess identity key does not contain an ASCII identifier".to_owned());
    }
    Ok(format!("MON_CONNECTOR_LICHESS_{identity}"))
}

fn validate_base_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "invalid Lichess base URL".to_owned())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Lichess base URL cannot contain credentials, query, or fragment".to_owned());
    }
    match (url.scheme(), url.host_str()) {
        ("https", Some(_)) => Ok(()),
        ("http", Some("127.0.0.1" | "localhost")) if url.port().is_some() => Ok(()),
        _ => Err("Lichess base URL must use HTTPS or loopback HTTP".to_owned()),
    }
}

fn drain_ndjson(pending: &mut Vec<u8>) -> Result<Vec<Value>, String> {
    const LIMIT: usize = 4 * 1024 * 1024;
    let mut values = Vec::new();
    while let Some(index) = pending.iter().position(|byte| *byte == b'\n') {
        let line = pending.drain(..=index).collect::<Vec<_>>();
        if line.len() > LIMIT {
            return Err("Lichess NDJSON record exceeds 4 MiB".to_owned());
        }
        let line = std::str::from_utf8(&line)
            .map_err(|error| error.to_string())?
            .trim();
        if !line.is_empty() {
            values.push(serde_json::from_str(line).map_err(|error| error.to_string())?);
        }
    }
    if pending.len() > LIMIT {
        return Err("Lichess NDJSON record exceeds 4 MiB".to_owned());
    }
    Ok(values)
}

fn stable_event_id(prefix: &str, payload: &Value) -> String {
    if let Some(id) = payload
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    {
        return format!("{prefix}:{id}");
    }
    let digest = Sha256::digest(serde_json::to_vec(payload).unwrap_or_default());
    format!(
        "{prefix}:{}",
        digest
            .iter()
            .take(16)
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

fn game_start_id(payload: &Value) -> Option<String> {
    (payload.get("type").and_then(Value::as_str) == Some("gameStart"))
        .then(|| {
            payload
                .get("game")?
                .get("id")?
                .as_str()
                .filter(|id| !id.is_empty())
                .map(str::to_owned)
        })
        .flatten()
}

struct ActionRequest {
    path: String,
    form: Vec<(String, String)>,
}

fn safe_segment<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(format!("{label} is not a safe Lichess identifier"))
    } else {
        Ok(value)
    }
}

fn action_request(action: &str, payload: &Value) -> Result<ActionRequest, String> {
    let game = payload
        .get("game_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let challenge = payload
        .get("challenge_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match action {
        "accept_challenge" => Ok(ActionRequest {
            path: format!(
                "/api/challenge/{}/accept",
                safe_segment(challenge, "challenge_id")?
            ),
            form: vec![],
        }),
        "decline_challenge" => {
            let reason = payload
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("generic");
            if !matches!(
                reason,
                "generic"
                    | "later"
                    | "tooFast"
                    | "tooSlow"
                    | "timeControl"
                    | "rated"
                    | "casual"
                    | "standard"
                    | "variant"
                    | "noBot"
                    | "onlyBot"
            ) {
                return Err("invalid Lichess decline reason".to_owned());
            }
            Ok(ActionRequest {
                path: format!(
                    "/api/challenge/{}/decline",
                    safe_segment(challenge, "challenge_id")?
                ),
                form: vec![("reason".to_owned(), reason.to_owned())],
            })
        }
        "make_move" => {
            let move_uci = payload
                .get("move")
                .and_then(Value::as_str)
                .ok_or("move is required")?;
            let parsed = move_uci
                .parse::<UciMove>()
                .map_err(|error| format!("invalid UCI move: {error}"))?;
            if !parsed.is_normal() {
                return Err("Lichess move must be a normal UCI move".to_owned());
            }
            Ok(ActionRequest {
                path: format!(
                    "/api/bot/game/{}/move/{move_uci}",
                    safe_segment(game, "game_id")?
                ),
                form: vec![(
                    "offeringDraw".to_owned(),
                    payload
                        .get("offer_draw")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                        .to_string(),
                )],
            })
        }
        "resign" => Ok(ActionRequest {
            path: format!("/api/bot/game/{}/resign", safe_segment(game, "game_id")?),
            form: vec![],
        }),
        "offer_draw" => Ok(ActionRequest {
            path: format!("/api/bot/game/{}/draw/yes", safe_segment(game, "game_id")?),
            form: vec![],
        }),
        "send_chat" => {
            let room = payload
                .get("room")
                .and_then(Value::as_str)
                .unwrap_or("player");
            if !matches!(room, "player" | "spectator") {
                return Err("invalid Lichess chat room".to_owned());
            }
            let text = payload
                .get("text")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or("text is required")?;
            Ok(ActionRequest {
                path: format!("/api/bot/game/{}/chat", safe_segment(game, "game_id")?),
                form: vec![
                    ("room".to_owned(), room.to_owned()),
                    ("text".to_owned(), text.to_owned()),
                ],
            })
        }
        _ => Err("invalid Lichess action".to_owned()),
    }
}

fn position(game_id: &str, identity_key: &str, game_full: &Value, latest: &Value) -> Value {
    let state = match latest.get("type").and_then(Value::as_str) {
        Some("gameFull") => latest.get("state"),
        Some("gameState") => Some(latest),
        _ => game_full.get("state"),
    }
    .filter(|value| value.is_object())
    .unwrap_or(&Value::Null);
    let moves = state
        .get("moves")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>();
    let initial_fen = game_full
        .get("initialFen")
        .and_then(Value::as_str)
        .unwrap_or("startpos");
    let variant = game_full
        .get("variant")
        .and_then(|value| value.get("key").or_else(|| value.get("name")))
        .and_then(Value::as_str)
        .unwrap_or("standard");
    let white = game_full.get("white").unwrap_or(&Value::Null);
    let black = game_full.get("black").unwrap_or(&Value::Null);
    let white_id = white
        .get("id")
        .or_else(|| white.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let black_id = black
        .get("id")
        .or_else(|| black.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let bot_color = if white_id.eq_ignore_ascii_case(identity_key) {
        Some("white")
    } else if black_id.eq_ignore_ascii_case(identity_key) {
        Some("black")
    } else {
        None
    };
    let fallback = if moves.len() % 2 == 0 {
        "white"
    } else {
        "black"
    };
    let mut result = json!({"game_id":game_id,"variant":variant,"initial_fen":initial_fen,"moves_uci":moves,"ply":moves.len(),"side_to_move":fallback,"bot_color":bot_color,"is_bot_turn":bot_color==Some(fallback),"white":{"id":white_id,"rating":white.get("rating"),"title":white.get("title")},"black":{"id":black_id,"rating":black.get("rating"),"title":black.get("title")},"status":state.get("status").and_then(Value::as_str).unwrap_or("started"),"winner":state.get("winner"),"white_time_ms":state.get("wtime"),"black_time_ms":state.get("btime"),"white_increment_ms":state.get("winc"),"black_increment_ms":state.get("binc"),"draw_offer_by_white":state.get("wdraw").and_then(Value::as_bool).unwrap_or(false),"draw_offer_by_black":state.get("bdraw").and_then(Value::as_bool).unwrap_or(false)});
    let parsed = if matches!(variant, "standard" | "fromPosition") {
        standard_position(initial_fen, &moves)
    } else {
        Err(format!("unsupported Lichess chess variant: {variant}"))
    };
    match parsed {
        Ok(chess) => {
            let side = if chess.turn() == Color::White {
                "white"
            } else {
                "black"
            };
            let details = json!({"fen":Fen::from_position(&chess,EnPassantMode::Legal).to_string(),"legal_moves_uci":chess.legal_moves().into_iter().map(UciMove::from_standard).map(|item|item.to_string()).collect::<Vec<_>>(),"check":chess.is_check(),"checkmate":chess.is_checkmate(),"stalemate":chess.is_stalemate(),"position_valid":true,"side_to_move":side,"is_bot_turn":bot_color==Some(side)});
            result
                .as_object_mut()
                .expect("object")
                .extend(details.as_object().expect("object").clone());
        }
        Err(error) => {
            let object = result.as_object_mut().expect("object");
            object.insert("position_valid".to_owned(), Value::Bool(false));
            object.insert("position_error".to_owned(), Value::String(error));
            object.insert("legal_moves_uci".to_owned(), json!([]));
        }
    }
    result
}

fn standard_position(initial_fen: &str, moves: &[&str]) -> Result<Chess, String> {
    let mut chess = if initial_fen == "startpos" {
        Chess::default()
    } else {
        initial_fen
            .parse::<Fen>()
            .map_err(|error| error.to_string())?
            .into_position(CastlingMode::Standard)
            .map_err(|error| error.to_string())?
    };
    for item in moves {
        let uci = item.parse::<UciMove>().map_err(|error| error.to_string())?;
        let next = uci.to_move(&chess).map_err(|error| error.to_string())?;
        chess.play_unchecked(next);
    }
    Ok(chess)
}

fn serialize(value: impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}
async fn send(writer: &SharedWriter, message: WireMessage) -> Result<(), String> {
    write_message(&mut *writer.lock().await, &message)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_credentials_are_isolated_and_validated() {
        assert_eq!(
            credential_environment(" Alice / tournament-bot ").expect("credential"),
            "MON_CONNECTOR_LICHESS_ALICE_TOURNAMENT_BOT"
        );
        assert!(credential_environment("_ / _").is_err());
    }

    #[test]
    fn ndjson_keeps_partial_records() {
        let mut pending = b"{\"type\":\"challenge\"}\n{\"type\":\"gameStart\"".to_vec();
        let first = drain_ndjson(&mut pending).expect("first record");
        assert_eq!(first.len(), 1);
        pending.extend_from_slice(b",\"game\":{\"id\":\"abc123\"}}\n");
        let second = drain_ndjson(&mut pending).expect("second record");
        assert_eq!(game_start_id(&second[0]).as_deref(), Some("abc123"));
    }

    #[test]
    fn actions_build_only_safe_exact_paths() {
        assert_eq!(
            action_request("resign", &json!({"game_id":"game123"}))
                .expect("resign")
                .path,
            "/api/bot/game/game123/resign"
        );
        assert!(action_request("resign", &json!({"game_id":"../escape"})).is_err());
        assert!(action_request("make_move", &json!({"game_id":"g1","move":"0000"})).is_err());
    }

    #[test]
    fn position_replay_exposes_legal_agent_state() {
        let game = json!({
            "type":"gameFull",
            "initialFen":"startpos",
            "variant":{"key":"standard"},
            "white":{"id":"agent"},
            "black":{"id":"other"},
            "state":{"type":"gameState","moves":"e2e4 e7e5 g1f3","status":"started"}
        });
        let result = position("game123", "agent", &game, &game);
        assert_eq!(result["position_valid"], true);
        assert_eq!(result["side_to_move"], "black");
        assert_eq!(result["is_bot_turn"], false);
        assert!(
            result["legal_moves_uci"]
                .as_array()
                .is_some_and(|moves| !moves.is_empty())
        );
    }
}
