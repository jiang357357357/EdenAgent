mod bridge;

use bridge::{CallbackBridge, RemoteLoopHooks, RemoteModel, tool_registry};
use mon_agent_core::{
    Agent, AgentContext, AgentLoopConfig, AgentOptions, AgentResult, AgentSnapshot, InterAgentMessage,
    MultiAgentControl,
};
use mon_agent_protocol::{MAX_FRAME_BYTES, PROTOCOL_VERSION, Request, Response, SessionConfig};
use std::collections::{HashMap, HashSet};
use std::io;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> io::Result<()> {
    if !stdio_requested() {
        eprintln!("mon-agent-runtime currently supports only --transport=stdio");
        std::process::exit(2);
    }

    eprintln!("mon-agent-runtime {} starting on stdio", mon_agent_core::VERSION);
    serve(BufReader::new(tokio::io::stdin()), BufWriter::new(tokio::io::stdout())).await
}

fn stdio_requested() -> bool {
    let mut transport = "stdio".to_owned();
    for argument in std::env::args().skip(1) {
        if let Some(value) = argument.strip_prefix("--transport=") {
            transport = value.to_owned();
        } else if argument != "--stdio" {
            eprintln!("unknown argument: {argument}");
            return false;
        }
    }
    transport == "stdio"
}

struct RuntimeSession {
    agent: Agent,
    active_cancellation: Arc<Mutex<Option<CancellationToken>>>,
}

impl RuntimeSession {
    fn new(session_id: &str, config: SessionConfig, bridge: CallbackBridge) -> Self {
        let callbacks = config.callbacks.clone();
        let native_config = config
            .workspace_root
            .as_deref()
            .map(mon_agent_tools::NativeToolConfig::new);
        let native_names: Arc<HashSet<String>> = Arc::new(config.native_tools.into_iter().collect());
        let tools = tool_registry(
            config.tools,
            session_id,
            &bridge,
            native_config.clone(),
            native_names.clone(),
        );

        let mut loop_config = AgentLoopConfig::new(config.model, Arc::new(RemoteModel::new(bridge.clone())));
        loop_config.tools = tools;
        loop_config.tool_execution = config.tool_execution;
        loop_config.session_id = Some(session_id.to_owned());
        loop_config.max_steps = config.max_steps.max(1);
        let hooks = Arc::new(RemoteLoopHooks::new(
            session_id.to_owned(),
            callbacks,
            bridge,
            native_config,
            native_names,
        ));
        loop_config.loop_hooks = hooks.clone();
        loop_config.hooks = hooks;
        let mut options = AgentOptions::new(loop_config);
        options.steering_mode = config.steering_mode;
        options.follow_up_mode = config.follow_up_mode;
        options.initial_context = AgentContext {
            system_prompt: config.system_prompt,
            messages: config.messages,
            metadata: config.metadata,
        };
        Self {
            agent: Agent::new(options),
            active_cancellation: Arc::new(Mutex::new(None)),
        }
    }

    fn cancel(&self) -> bool {
        self.active_cancellation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .is_some_and(|token| {
                token.cancel();
                true
            })
    }
}

async fn serve<R, W>(mut reader: R, mut writer: W) -> io::Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let (outgoing, mut responses) = mpsc::channel::<Response>(512);
    let bridge = CallbackBridge::new(outgoing.clone());
    let mut sessions: HashMap<String, RuntimeSession> = HashMap::new();
    let mut agent_controls: HashMap<String, MultiAgentControl> = HashMap::new();
    let mut initialized = false;

    loop {
        tokio::select! {
            biased;
            response = responses.recv() => {
                if let Some(response) = response {
                    write_response(&mut writer, &response).await?;
                }
            }
            frame = read_frame(&mut reader) => {
                let Some(frame) = frame? else { break };
                let bytes = match frame {
                    Ok(bytes) => bytes,
                    Err(()) => {
                        outgoing.send(Response::error(
                            None,
                            "frame_too_large",
                            format!("Frame exceeds {MAX_FRAME_BYTES} bytes"),
                        )).await.map_err(channel_closed)?;
                        continue;
                    }
                };
                if bytes.iter().all(u8::is_ascii_whitespace) {
                    continue;
                }
                let request: Request = match serde_json::from_slice(&bytes) {
                    Ok(request) => request,
                    Err(error) => {
                        outgoing.send(Response::error(
                            None,
                            "invalid_json",
                            format!("Invalid request: {error}"),
                        )).await.map_err(channel_closed)?;
                        continue;
                    }
                };

                if !initialized && !matches!(request, Request::Initialize { .. } | Request::Shutdown { .. }) {
                    outgoing.send(Response::error(
                        Some(request.request_id().to_owned()),
                        "not_initialized",
                        "Initialize the runtime before use",
                    )).await.map_err(channel_closed)?;
                    continue;
                }

                match request {
                    Request::Initialize { request_id, protocol_version, server_version } => {
                        if initialized {
                            outgoing.send(Response::error(
                                Some(request_id),
                                "already_initialized",
                                "Runtime is already initialized",
                            )).await.map_err(channel_closed)?;
                            continue;
                        }
                        if protocol_version != PROTOCOL_VERSION {
                            outgoing.send(Response::error(
                                Some(request_id),
                                "protocol_version_mismatch",
                                format!("Server requested protocol {protocol_version}; runtime supports {PROTOCOL_VERSION}"),
                            )).await.map_err(channel_closed)?;
                            continue;
                        }
                        eprintln!("initialized by Server {server_version}");
                        initialized = true;
                        outgoing.send(Response::Initialized {
                            request_id,
                            protocol_version: PROTOCOL_VERSION,
                            runtime_version: mon_agent_core::VERSION.to_owned(),
                            capabilities: vec![
                                "runtime.control".to_owned(),
                                "session.control".to_owned(),
                                "agent.turn".to_owned(),
                                "model.callback".to_owned(),
                                "tool.callback".to_owned(),
                                "native.fs-tools".to_owned(),
                                "native.process-tools".to_owned(),
                                "native.compaction".to_owned(),
                                "native.session-context".to_owned(),
                                "native.skills".to_owned(),
                                "native.multi-agent".to_owned(),
                            ],
                        }).await.map_err(channel_closed)?;
                    }
                    Request::Ping { request_id } => {
                        outgoing.send(Response::Pong { request_id }).await.map_err(channel_closed)?;
                    }
                    Request::ContextEstimate { request_id, messages, model_id } => {
                        let estimate = mon_agent_core::estimate_context_tokens(&messages, model_id.as_deref());
                        outgoing.send(Response::ContextEstimated { request_id, estimate })
                            .await.map_err(channel_closed)?;
                    }
                    Request::CompactionPrepare { request_id, entries, settings, model_id } => {
                        match mon_agent_core::prepare_compaction(&entries, &settings, model_id.as_deref()) {
                            Ok(preparation) => outgoing.send(Response::CompactionPrepared { request_id, preparation })
                                .await.map_err(channel_closed)?,
                            Err(error) => outgoing.send(Response::error(
                                Some(request_id),
                                "compaction_prepare_failed",
                                error,
                            )).await.map_err(channel_closed)?,
                        }
                    }
                    Request::CompactionBuildSummaryRequest {
                        request_id,
                        preparation,
                        model,
                        cache_context,
                        custom_instructions,
                        thinking_level,
                    } => match mon_agent_core::build_compaction_summary_request(
                        &preparation,
                        &model,
                        cache_context.as_ref(),
                        custom_instructions.as_deref(),
                        thinking_level.as_deref(),
                    ) {
                        Ok(request) => outgoing
                            .send(Response::CompactionSummaryRequestBuilt { request_id, request })
                            .await
                            .map_err(channel_closed)?,
                        Err(error) => outgoing
                            .send(Response::error(
                                Some(request_id),
                                "compaction_summary_request_failed",
                                error,
                            ))
                            .await
                            .map_err(channel_closed)?,
                    },
                    Request::CompactionFinalize { request_id, preparation, response } => {
                        match mon_agent_core::finalize_compaction(&preparation, &response) {
                            Ok(compaction) => outgoing
                                .send(Response::CompactionFinalized { request_id, compaction })
                                .await
                                .map_err(channel_closed)?,
                            Err(error) => outgoing
                                .send(Response::error(
                                    Some(request_id),
                                    "compaction_finalize_failed",
                                    error,
                                ))
                                .await
                                .map_err(channel_closed)?,
                        }
                    }
                    Request::SessionContext { request_id, entries } => {
                        let context = mon_agent_core::build_session_context(&entries);
                        outgoing
                            .send(Response::SessionContextBuilt { request_id, context })
                            .await
                            .map_err(channel_closed)?;
                    }
                    Request::SkillsLoad { request_id, directories } => {
                        let result = mon_agent_tools::load_skills(&directories);
                        outgoing
                            .send(Response::SkillsLoaded { request_id, result })
                            .await
                            .map_err(channel_closed)?;
                    }
                    Request::AgentControl { request_id, root_session_id, action, payload } => {
                        match handle_agent_control(&mut agent_controls, &root_session_id, &action, payload) {
                            Ok(result) => outgoing
                                .send(Response::AgentControlled { request_id, result })
                                .await
                                .map_err(channel_closed)?,
                            Err(error) => outgoing
                                .send(Response::error(Some(request_id), "agent_control_failed", error))
                                .await
                                .map_err(channel_closed)?,
                        }
                    }
                    Request::Shutdown { request_id } => {
                        for session in sessions.values() {
                            session.cancel();
                        }
                        while let Ok(response) = responses.try_recv() {
                            write_response(&mut writer, &response).await?;
                        }
                        write_response(&mut writer, &Response::ShutdownComplete { request_id }).await?;
                        break;
                    }
                    Request::SessionCreate { request_id, session_id, config } => {
                        if session_id.is_empty() {
                            outgoing.send(Response::error(Some(request_id), "invalid_session_id", "sessionID cannot be empty"))
                                .await.map_err(channel_closed)?;
                        } else if sessions.contains_key(&session_id) {
                            outgoing.send(Response::error(Some(request_id), "session_exists", format!("Session already exists: {session_id}")))
                                .await.map_err(channel_closed)?;
                        } else {
                            sessions.insert(session_id.clone(), RuntimeSession::new(&session_id, config, bridge.clone()));
                            outgoing.send(Response::SessionCreated { request_id, session_id }).await.map_err(channel_closed)?;
                        }
                    }
                    Request::SessionClose { request_id, session_id } => {
                        if let Some(session) = sessions.remove(&session_id) {
                            session.cancel();
                            outgoing.send(Response::SessionClosed { request_id, session_id }).await.map_err(channel_closed)?;
                        } else {
                            send_unknown_session(&outgoing, request_id, session_id).await?;
                        }
                    }
                    Request::TurnStart { request_id, session_id, prompts } => {
                        let Some(session) = sessions.get(&session_id) else {
                            send_unknown_session(&outgoing, request_id, session_id).await?;
                            continue;
                        };
                        if session.agent.is_running() {
                            outgoing.send(Response::error(Some(request_id), "turn_not_started", "Agent is already running"))
                                .await.map_err(channel_closed)?;
                            continue;
                        }
                        outgoing.send(Response::TurnStarted {
                            request_id: request_id.clone(),
                            session_id: session_id.clone(),
                        }).await.map_err(channel_closed)?;
                        match session.agent.start(prompts) {
                            Ok(mut run) => {
                                let cancellation = run.cancellation_token();
                                *session.active_cancellation.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) =
                                    Some(cancellation);
                                let active = Arc::clone(&session.active_cancellation);
                                let response_sender = outgoing.clone();
                                let turn_request_id = request_id.clone();
                                let turn_session_id = session_id.clone();
                                tokio::spawn(async move {
                                    while let Some(event) = run.events.recv().await {
                                        if response_sender.send(Response::TurnEvent {
                                            request_id: turn_request_id.clone(),
                                            session_id: turn_session_id.clone(),
                                            event,
                                        }).await.is_err() {
                                            break;
                                        }
                                    }
                                    let result = run.result().await;
                                    *active.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
                                    let response = match result {
                                        Ok(result) => Response::TurnCompleted {
                                            request_id: turn_request_id,
                                            session_id: turn_session_id,
                                            new_messages: result.new_messages,
                                            context: result.context,
                                            turns: result.turns,
                                        },
                                        Err(error) => Response::error(
                                            Some(turn_request_id),
                                            "turn_failed",
                                            error.to_string(),
                                        ),
                                    };
                                    let _ = response_sender.send(response).await;
                                });
                            }
                            Err(error) => {
                                outgoing.send(Response::error(Some(request_id), "turn_not_started", error.to_string()))
                                    .await.map_err(channel_closed)?;
                            }
                        }
                    }
                    Request::TurnCancel { request_id, session_id } => {
                        let Some(session) = sessions.get(&session_id) else {
                            send_unknown_session(&outgoing, request_id, session_id).await?;
                            continue;
                        };
                        if session.cancel() {
                            outgoing.send(Response::TurnCancelled { request_id, session_id }).await.map_err(channel_closed)?;
                        } else {
                            outgoing.send(Response::error(Some(request_id), "turn_not_running", "Session has no active turn"))
                                .await.map_err(channel_closed)?;
                        }
                    }
                    Request::TurnSteer { request_id, session_id, message } => {
                        let Some(session) = sessions.get(&session_id) else {
                            send_unknown_session(&outgoing, request_id, session_id).await?;
                            continue;
                        };
                        session.agent.steer(message);
                        outgoing.send(Response::Accepted { request_id }).await.map_err(channel_closed)?;
                    }
                    Request::TurnFollowUp { request_id, session_id, message } => {
                        let Some(session) = sessions.get(&session_id) else {
                            send_unknown_session(&outgoing, request_id, session_id).await?;
                            continue;
                        };
                        session.agent.follow_up(message);
                        outgoing.send(Response::Accepted { request_id }).await.map_err(channel_closed)?;
                    }
                    Request::ModelUpdate { request_id, operation_id, message, delta, event } => {
                        send_callback_result(
                            &outgoing,
                            request_id,
                            operation_id.clone(),
                            bridge.model_update(&operation_id, message, delta, event),
                        ).await?;
                    }
                    Request::ModelResult { request_id, operation_id, message, error } => {
                        let result = exactly_one_result(message, error, "model");
                        match result {
                            Ok(result) => send_callback_result(&outgoing, request_id, operation_id.clone(), bridge.model_result(&operation_id, result)).await?,
                            Err(message) => outgoing.send(Response::error(Some(request_id), "invalid_callback_result", message)).await.map_err(channel_closed)?,
                        }
                    }
                    Request::ToolUpdate { request_id, operation_id, result } => {
                        send_callback_result(&outgoing, request_id, operation_id.clone(), bridge.tool_update(&operation_id, result)).await?;
                    }
                    Request::ToolResult { request_id, operation_id, result, error } => {
                        let result = exactly_one_result(result, error, "tool");
                        match result {
                            Ok(result) => send_callback_result(&outgoing, request_id, operation_id.clone(), bridge.tool_result(&operation_id, result)).await?,
                            Err(message) => outgoing.send(Response::error(Some(request_id), "invalid_callback_result", message)).await.map_err(channel_closed)?,
                        }
                    }
                    Request::HookResult { request_id, operation_id, result, error } => {
                        let result = match error {
                            Some(error) => Err(error),
                            None => Ok(result),
                        };
                        send_callback_result(
                            &outgoing,
                            request_id,
                            operation_id.clone(),
                            bridge.hook_result(&operation_id, result),
                        ).await?;
                    }
                }
            }
        }
    }
    for session in sessions.values() {
        session.cancel();
    }
    writer.shutdown().await
}

fn exactly_one_result<T>(
    value: Option<T>,
    error: Option<mon_agent_protocol::OperationError>,
    kind: &str,
) -> Result<Result<T, mon_agent_protocol::OperationError>, String> {
    match (value, error) {
        (Some(value), None) => Ok(Ok(value)),
        (None, Some(error)) => Ok(Err(error)),
        _ => Err(format!(
            "{kind}.result must contain exactly one of result/message or error"
        )),
    }
}

async fn send_callback_result(
    outgoing: &mpsc::Sender<Response>,
    request_id: String,
    operation_id: String,
    accepted: bool,
) -> io::Result<()> {
    let response = if accepted {
        Response::Accepted { request_id }
    } else {
        Response::error(
            Some(request_id),
            "unknown_operation",
            format!("Unknown or completed callback operation: {operation_id}"),
        )
    };
    outgoing.send(response).await.map_err(channel_closed)
}

async fn send_unknown_session(
    outgoing: &mpsc::Sender<Response>,
    request_id: String,
    session_id: String,
) -> io::Result<()> {
    outgoing
        .send(Response::error(
            Some(request_id),
            "unknown_session",
            format!("Unknown session: {session_id}"),
        ))
        .await
        .map_err(channel_closed)
}

fn handle_agent_control(
    controls: &mut HashMap<String, MultiAgentControl>,
    root_session_id: &str,
    action: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if action == "create" {
        let max_threads = payload
            .get("maxThreads")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(64) as usize;
        let max_depth = payload.get("maxDepth").and_then(serde_json::Value::as_u64).unwrap_or(2) as usize;
        controls.insert(
            root_session_id.to_owned(),
            MultiAgentControl::new(root_session_id, max_threads, max_depth)?,
        );
        return Ok(serde_json::json!({"created":true}));
    }
    if action == "close" {
        return Ok(serde_json::json!({"closed":controls.remove(root_session_id).is_some()}));
    }
    let control = controls
        .get_mut(root_session_id)
        .ok_or_else(|| format!("unknown agent control: {root_session_id}"))?;
    match action {
        "spawn" => serde_json::to_value(
            control.spawn(
                payload
                    .get("taskName")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
                payload
                    .get("parent")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("/root"),
                payload
                    .get("role")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("general"),
                payload
                    .get("metadata")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({})),
            )?,
        )
        .map_err(|error| error.to_string()),
        "restore" => {
            let snapshot: AgentSnapshot = serde_json::from_value(
                payload
                    .get("snapshot")
                    .cloned()
                    .ok_or_else(|| "snapshot is required".to_owned())?,
            )
            .map_err(|error| format!("invalid snapshot: {error}"))?;
            serde_json::to_value(control.restore(snapshot)?).map_err(|error| error.to_string())
        }
        "start" => serde_json::to_value(
            control.start(
                payload
                    .get("target")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
            )?,
        )
        .map_err(|error| error.to_string()),
        "requeue" => serde_json::to_value(
            control.requeue(
                payload
                    .get("target")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
            )?,
        )
        .map_err(|error| error.to_string()),
        "complete" => {
            let result: AgentResult =
                serde_json::from_value(payload.get("result").cloned().unwrap_or_else(|| serde_json::json!({})))
                    .map_err(|error| format!("invalid agent result: {error}"))?;
            let (snapshot, message) = control.complete(
                payload
                    .get("target")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
                result,
            )?;
            Ok(serde_json::json!({"agent":snapshot,"message":message}))
        }
        "fail" => {
            let (snapshot, message) = control.fail(
                payload
                    .get("target")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
                payload
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown error"),
            )?;
            Ok(serde_json::json!({"agent":snapshot,"message":message}))
        }
        "interrupt" => serde_json::to_value(
            control.interrupt(
                payload
                    .get("target")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
            )?,
        )
        .map_err(|error| error.to_string()),
        "sendMessage" => serde_json::to_value(
            control.send_message(
                payload
                    .get("target")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
                payload
                    .get("sender")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("/root"),
                payload
                    .get("content")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
                payload
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("message"),
                payload
                    .get("triggerTurn")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
                payload.get("details").cloned().unwrap_or_else(|| serde_json::json!({})),
            )?,
        )
        .map_err(|error| error.to_string()),
        "restoreMailbox" => {
            let messages: Vec<InterAgentMessage> = serde_json::from_value(
                payload
                    .get("messages")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([])),
            )
            .map_err(|error| format!("invalid mailbox: {error}"))?;
            control.restore_mailbox(messages);
            Ok(serde_json::json!({"restored":true}))
        }
        "drainMailbox" => Ok(serde_json::json!({
            "messages": control.drain_mailbox(
                payload.get("receiver").and_then(serde_json::Value::as_str).unwrap_or("/root")
            )?
        })),
        "list" => Ok(serde_json::json!({
            "agents": control.list(payload.get("pathPrefix").and_then(serde_json::Value::as_str))
        })),
        "get" => serde_json::to_value(
            control.get(
                payload
                    .get("target")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
            )?,
        )
        .map_err(|error| error.to_string()),
        _ => Err(format!("unknown agent control action: {action}")),
    }
}

fn channel_closed<T>(_error: mpsc::error::SendError<T>) -> io::Error {
    io::Error::new(io::ErrorKind::BrokenPipe, "runtime response channel closed")
}

async fn write_response<W: AsyncWrite + Unpin>(writer: &mut W, response: &Response) -> io::Result<()> {
    let mut bytes = serde_json::to_vec(response).map_err(io::Error::other)?;
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    writer.flush().await
}

/// Reads a newline-delimited frame without allowing an attacker to grow the
/// allocation beyond the protocol limit. Oversized input is drained through
/// its newline so the next request can still be processed.
async fn read_frame<R: AsyncBufRead + Unpin>(reader: &mut R) -> io::Result<Option<Result<Vec<u8>, ()>>> {
    let mut frame = Vec::new();
    let mut oversized = false;
    let mut saw_input = false;

    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if !saw_input {
                return Ok(None);
            }
            return Ok(Some(if oversized { Err(()) } else { Ok(frame) }));
        }
        saw_input = true;
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |index| index + 1);
        let payload_len = newline.unwrap_or(available.len());

        if !oversized {
            if frame.len().saturating_add(payload_len) > MAX_FRAME_BYTES {
                oversized = true;
                frame.clear();
            } else {
                frame.extend_from_slice(&available[..payload_len]);
            }
        }
        reader.consume(consumed);

        if newline.is_some() {
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            return Ok(Some(if oversized { Err(()) } else { Ok(frame) }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    use tokio::time::{Duration, timeout};

    #[tokio::test]
    async fn handshake_ping_and_shutdown() {
        let input = concat!(
            "{\"type\":\"runtime.initialize\",\"requestID\":\"1\",\"protocolVersion\":1,\"serverVersion\":\"test\"}\n",
            "{\"type\":\"runtime.ping\",\"requestID\":\"2\"}\n",
            "{\"type\":\"runtime.shutdown\",\"requestID\":\"3\"}\n"
        );
        let mut output = Vec::new();
        serve(BufReader::new(input.as_bytes()), &mut output)
            .await
            .expect("runtime should serve requests");
        let frames: Vec<serde_json::Value> = output
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).expect("valid response"))
            .collect();
        assert_eq!(frames[0]["type"], "runtime.initialized");
        assert_eq!(frames[1]["type"], "runtime.pong");
        assert_eq!(frames[2]["type"], "runtime.shutdownComplete");
    }

    #[tokio::test]
    async fn ping_before_initialize_is_rejected() {
        let input = concat!(
            "{\"type\":\"runtime.ping\",\"requestID\":\"1\"}\n",
            "{\"type\":\"runtime.shutdown\",\"requestID\":\"2\"}\n"
        );
        let mut output = Vec::new();
        serve(BufReader::new(input.as_bytes()), &mut output)
            .await
            .expect("runtime should serve requests");
        let first: serde_json::Value =
            serde_json::from_slice(output.split(|byte| *byte == b'\n').next().unwrap()).expect("valid response");
        assert_eq!(first["code"], "not_initialized");
    }

    #[tokio::test]
    async fn oversized_frame_is_drained_and_the_next_request_succeeds() {
        let mut input = vec![b'x'; MAX_FRAME_BYTES + 1];
        input.extend_from_slice(
            b"\n{\"type\":\"runtime.initialize\",\"requestID\":\"1\",\"protocolVersion\":1,\"serverVersion\":\"test\"}\n{\"type\":\"runtime.shutdown\",\"requestID\":\"2\"}\n",
        );
        let mut output = Vec::new();
        serve(BufReader::new(input.as_slice()), &mut output)
            .await
            .expect("runtime should recover after a large frame");
        let frames: Vec<serde_json::Value> = output
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).expect("valid response"))
            .collect();
        assert_eq!(frames[0]["code"], "frame_too_large");
        assert_eq!(frames[1]["type"], "runtime.initialized");
        assert_eq!(frames[2]["type"], "runtime.shutdownComplete");
    }

    #[tokio::test]
    async fn slow_response_consumer_applies_backpressure_without_losing_frames() {
        let (client, runtime_io) = tokio::io::duplex(128);
        let (runtime_read, runtime_write) = tokio::io::split(runtime_io);
        let runtime = tokio::spawn(serve(BufReader::new(runtime_read), runtime_write));
        let (client_read, mut client_write) = tokio::io::split(client);
        let writer = tokio::spawn(async move {
            client_write
                .write_all(b"{\"type\":\"runtime.initialize\",\"requestID\":\"init\",\"protocolVersion\":1,\"serverVersion\":\"test\"}\n")
                .await
                .expect("write initialize");
            for index in 0..64 {
                client_write
                    .write_all(format!("{{\"type\":\"runtime.ping\",\"requestID\":\"p{index}\"}}\n").as_bytes())
                    .await
                    .expect("write ping");
            }
            client_write
                .write_all(b"{\"type\":\"runtime.shutdown\",\"requestID\":\"bye\"}\n")
                .await
                .expect("write shutdown");
        });

        tokio::time::sleep(Duration::from_millis(25)).await;
        assert!(!runtime.is_finished(), "runtime must wait for a blocked consumer");
        let mut lines = BufReader::new(client_read).lines();
        let mut responses = 0;
        while let Some(line) = timeout(Duration::from_secs(2), lines.next_line())
            .await
            .expect("response deadline")
            .expect("read response")
        {
            responses += 1;
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid response");
            if frame["type"] == "runtime.shutdownComplete" {
                break;
            }
        }
        writer.await.expect("request writer");
        runtime.await.expect("runtime task").expect("runtime result");
        assert_eq!(responses, 66);
    }

    #[tokio::test]
    async fn context_estimate_uses_native_tokenizer_without_a_session() {
        let input = concat!(
            "{\"type\":\"runtime.initialize\",\"requestID\":\"1\",\"protocolVersion\":1,\"serverVersion\":\"test\"}\n",
            "{\"type\":\"context.estimate\",\"requestID\":\"2\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\",\"timestamp\":1}],\"modelID\":\"gpt-4o\"}\n",
            "{\"type\":\"runtime.shutdown\",\"requestID\":\"3\"}\n"
        );
        let mut output = Vec::new();
        serve(BufReader::new(input.as_bytes()), &mut output)
            .await
            .expect("runtime should estimate context");
        let frames: Vec<serde_json::Value> = output
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).expect("valid response"))
            .collect();
        assert_eq!(frames[1]["type"], "context.estimated");
        assert_eq!(frames[1]["estimate"]["tokens"], 1);
        assert_eq!(frames[1]["estimate"]["trailingTokens"], 1);
    }

    #[tokio::test]
    async fn compaction_prepare_plans_history_over_the_wire() {
        let input = concat!(
            "{\"type\":\"runtime.initialize\",\"requestID\":\"1\",\"protocolVersion\":1,\"serverVersion\":\"test\"}\n",
            "{\"type\":\"compaction.prepare\",\"requestID\":\"2\",\"entries\":[{\"type\":\"message\",\"id\":\"e0\",\"message\":{\"role\":\"user\",\"content\":\"old question old question old question old question old question old question old question old question\",\"timestamp\":0}},{\"type\":\"message\",\"id\":\"e1\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"toolCall\",\"id\":\"r1\",\"name\":\"read\",\"arguments\":{\"path\":\"old.txt\"}}],\"timestamp\":1}},{\"type\":\"message\",\"id\":\"e2\",\"message\":{\"role\":\"toolResult\",\"toolCallId\":\"r1\",\"toolName\":\"read\",\"content\":[{\"type\":\"text\",\"text\":\"old result\"}],\"details\":{},\"success\":true,\"isError\":false,\"timestamp\":2}},{\"type\":\"message\",\"id\":\"e3\",\"message\":{\"role\":\"user\",\"content\":\"recent question\",\"timestamp\":3}},{\"type\":\"message\",\"id\":\"e4\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"recent answer\"}],\"timestamp\":4}}],\"settings\":{\"keepRecentTokens\":4,\"tailTurns\":1},\"modelID\":\"gpt-4o\"}\n",
            "{\"type\":\"runtime.shutdown\",\"requestID\":\"3\"}\n"
        );
        let mut output = Vec::new();
        serve(BufReader::new(input.as_bytes()), &mut output)
            .await
            .expect("runtime should plan compaction");
        let frames: Vec<serde_json::Value> = output
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).expect("valid response"))
            .collect();
        assert_eq!(frames[1]["type"], "compaction.prepared");
        assert_eq!(frames[1]["preparation"]["firstKeptEntryId"], "e3");
        assert_eq!(
            frames[1]["preparation"]["fileOps"]["read"],
            serde_json::json!(["old.txt"])
        );
    }

    #[tokio::test]
    async fn compaction_summary_request_and_finalize_run_over_the_wire() {
        let preparation = serde_json::json!({
            "firstKeptEntryId":"e2",
            "messagesToSummarize":[{"role":"user","content":"hello","timestamp":1}],
            "tokensBefore":12,
            "fileOps":{"read":["a.txt"],"written":[],"edited":[]},
            "settings":{"reserveTokens":100}
        });
        let frames = [
            serde_json::json!({"type":"runtime.initialize","requestID":"1","protocolVersion":1,"serverVersion":"test"}),
            serde_json::json!({"type":"compaction.buildSummaryRequest","requestID":"2","preparation":preparation,"model":{"maxTokens":40}}),
            serde_json::json!({"type":"compaction.finalize","requestID":"3","preparation":preparation,"response":{"stopReason":"stop","content":[{"type":"text","text":"checkpoint"}]}}),
            serde_json::json!({"type":"session.context","requestID":"4","entries":[{"type":"message","id":"e1","message":{"role":"user","content":"hello","timestamp":1}}]}),
            serde_json::json!({"type":"runtime.shutdown","requestID":"5"}),
        ];
        let input = frames
            .iter()
            .map(|frame| serde_json::to_string(frame).expect("request frame"))
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        let mut output = Vec::new();
        serve(BufReader::new(input.as_bytes()), &mut output)
            .await
            .expect("runtime should build and finalize compaction");
        let responses: Vec<serde_json::Value> = output
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).expect("valid response"))
            .collect();
        assert_eq!(responses[1]["type"], "compaction.summaryRequestBuilt");
        assert_eq!(responses[1]["request"]["options"]["maxTokens"], 40);
        assert_eq!(responses[2]["type"], "compaction.finalized");
        assert_eq!(
            responses[2]["compaction"]["details"]["readFiles"],
            serde_json::json!(["a.txt"])
        );
        assert_eq!(responses[3]["type"], "session.contextBuilt");
        assert_eq!(responses[3]["context"]["messages"][0]["content"], "hello");
    }

    #[tokio::test]
    async fn session_lifecycle_rejects_duplicates_and_unknown_ids() {
        let config = r#"{"model":{"id":"test","provider":"server"},"systemPrompt":"","messages":[],"tools":[],"metadata":{},"maxSteps":8}"#;
        let input = format!(
            "{{\"type\":\"runtime.initialize\",\"requestID\":\"1\",\"protocolVersion\":1,\"serverVersion\":\"test\"}}\n{{\"type\":\"session.create\",\"requestID\":\"2\",\"sessionID\":\"s1\",\"config\":{config}}}\n{{\"type\":\"session.create\",\"requestID\":\"3\",\"sessionID\":\"s1\",\"config\":{config}}}\n{{\"type\":\"session.close\",\"requestID\":\"4\",\"sessionID\":\"missing\"}}\n{{\"type\":\"session.close\",\"requestID\":\"5\",\"sessionID\":\"s1\"}}\n{{\"type\":\"runtime.shutdown\",\"requestID\":\"6\"}}\n"
        );
        let mut output = Vec::new();
        serve(BufReader::new(input.as_bytes()), &mut output)
            .await
            .expect("runtime should serve requests");
        let frames: Vec<serde_json::Value> = output
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).expect("valid response"))
            .collect();
        assert_eq!(frames[1]["type"], "session.created");
        assert_eq!(frames[2]["code"], "session_exists");
        assert_eq!(frames[3]["code"], "unknown_session");
        assert_eq!(frames[4]["type"], "session.closed");
    }

    #[tokio::test]
    async fn multi_agent_control_manages_native_state_over_the_wire() {
        let input = concat!(
            "{\"type\":\"runtime.initialize\",\"requestID\":\"1\",\"protocolVersion\":1,\"serverVersion\":\"test\"}\n",
            "{\"type\":\"agent.control\",\"requestID\":\"2\",\"rootSessionID\":\"root-1\",\"action\":\"create\",\"payload\":{\"maxThreads\":4,\"maxDepth\":2}}\n",
            "{\"type\":\"agent.control\",\"requestID\":\"3\",\"rootSessionID\":\"root-1\",\"action\":\"spawn\",\"payload\":{\"taskName\":\"Research\",\"parent\":\"/root\",\"role\":\"general\"}}\n",
            "{\"type\":\"agent.control\",\"requestID\":\"4\",\"rootSessionID\":\"root-1\",\"action\":\"list\",\"payload\":{}}\n",
            "{\"type\":\"runtime.shutdown\",\"requestID\":\"5\"}\n"
        );
        let mut output = Vec::new();
        serve(BufReader::new(input.as_bytes()), &mut output)
            .await
            .expect("runtime should manage agents");
        let frames: Vec<serde_json::Value> = output
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).expect("valid response"))
            .collect();
        assert_eq!(frames[1]["result"]["created"], true);
        assert_eq!(frames[2]["result"]["agentPath"], "/root/research");
        assert_eq!(frames[3]["result"]["agents"].as_array().expect("agents").len(), 1);
    }

    #[tokio::test]
    async fn remote_model_callback_completes_a_real_turn() {
        let (client, server) = tokio::io::duplex(128 * 1024);
        let (server_read, server_write) = tokio::io::split(server);
        let runtime = tokio::spawn(serve(BufReader::new(server_read), BufWriter::new(server_write)));
        let (client_read, mut client_write) = tokio::io::split(client);
        let mut lines = BufReader::new(client_read).lines();

        let requests = concat!(
            "{\"type\":\"runtime.initialize\",\"requestID\":\"1\",\"protocolVersion\":1,\"serverVersion\":\"test\"}\n",
            "{\"type\":\"session.create\",\"requestID\":\"2\",\"sessionID\":\"s1\",\"config\":{\"model\":{\"id\":\"test\",\"provider\":\"server\"},\"systemPrompt\":\"help\",\"messages\":[],\"tools\":[],\"metadata\":{},\"maxSteps\":8}}\n",
            "{\"type\":\"turn.start\",\"requestID\":\"turn_1\",\"sessionID\":\"s1\",\"prompts\":[{\"role\":\"user\",\"content\":\"hello\",\"timestamp\":1}]}\n"
        );
        client_write
            .write_all(requests.as_bytes())
            .await
            .expect("write requests");

        let mut frame_types = Vec::new();
        let mut event_types = Vec::new();
        let mut assistant_event_types = Vec::new();
        let mut completed = None;
        while completed.is_none() {
            let line = timeout(Duration::from_secs(2), lines.next_line())
                .await
                .expect("runtime response timed out")
                .expect("read response")
                .expect("runtime closed early");
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid frame");
            let frame_type = frame["type"].as_str().expect("frame type").to_owned();
            frame_types.push(frame_type.clone());
            if frame_type == "turn.event" {
                let event_type = frame["event"]["type"].as_str().expect("event type").to_owned();
                event_types.push(event_type.clone());
                if frame["event"]["message"]["role"] == "assistant" {
                    assistant_event_types.push(event_type);
                }
            }
            if frame_type == "model.call" {
                let operation_id = frame["operationID"].as_str().expect("operation id");
                let callbacks = format!(
                    "{{\"type\":\"model.update\",\"requestID\":\"model_update\",\"operationID\":\"{operation_id}\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"text\",\"text\":\"wor\"}}],\"api\":\"test\",\"provider\":\"server\",\"model\":\"test\",\"stopReason\":\"stop\",\"timestamp\":2}},\"delta\":\"wor\"}}\n{{\"type\":\"model.result\",\"requestID\":\"model_done\",\"operationID\":\"{operation_id}\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"text\",\"text\":\"world\"}}],\"api\":\"test\",\"provider\":\"server\",\"model\":\"test\",\"stopReason\":\"stop\",\"timestamp\":2}}}}\n"
                );
                client_write
                    .write_all(callbacks.as_bytes())
                    .await
                    .expect("write callbacks");
            } else if frame_type == "turn.completed" {
                completed = Some(frame);
            }
        }

        let started_index = frame_types
            .iter()
            .position(|kind| kind == "turn.started")
            .expect("turn started");
        let callback_index = frame_types
            .iter()
            .position(|kind| kind == "model.call")
            .expect("model call");
        assert!(started_index < callback_index);
        let completed = completed.expect("completed frame");
        assert_eq!(completed["newMessages"][1]["content"][0]["text"], "world");
        assert_eq!(completed["turns"], 1);
        let start = assistant_event_types
            .iter()
            .position(|kind| kind == "message_start")
            .expect("assistant message start");
        let update = assistant_event_types
            .iter()
            .position(|kind| kind == "message_update")
            .expect("assistant message update");
        let end = assistant_event_types
            .iter()
            .position(|kind| kind == "message_end")
            .expect("assistant message end");
        assert!(start < update && update < end);

        client_write
            .write_all(b"{\"type\":\"runtime.shutdown\",\"requestID\":\"bye\"}\n")
            .await
            .expect("write shutdown");
        while let Some(line) = lines.next_line().await.expect("read shutdown") {
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid frame");
            if frame["type"] == "runtime.shutdownComplete" {
                break;
            }
        }
        runtime.await.expect("runtime task").expect("runtime result");
    }

    #[tokio::test]
    async fn remote_stop_hook_prevents_another_model_step() {
        let (client, server) = tokio::io::duplex(128 * 1024);
        let (server_read, server_write) = tokio::io::split(server);
        let runtime = tokio::spawn(serve(BufReader::new(server_read), BufWriter::new(server_write)));
        let (client_read, mut client_write) = tokio::io::split(client);
        let mut lines = BufReader::new(client_read).lines();
        client_write.write_all(concat!(
            "{\"type\":\"runtime.initialize\",\"requestID\":\"1\",\"protocolVersion\":1,\"serverVersion\":\"test\"}\n",
            "{\"type\":\"session.create\",\"requestID\":\"2\",\"sessionID\":\"s1\",\"config\":{\"model\":{\"id\":\"test\",\"provider\":\"server\"},\"messages\":[],\"tools\":[],\"metadata\":{},\"callbacks\":{\"shouldStopAfterTurn\":true}}}\n",
            "{\"type\":\"turn.start\",\"requestID\":\"turn_hook\",\"sessionID\":\"s1\",\"prompts\":[{\"role\":\"user\",\"content\":\"hello\",\"timestamp\":1}]}\n"
        ).as_bytes()).await.expect("write requests");

        let mut model_calls = 0;
        let mut hook_calls = 0;
        let completed = loop {
            let line = timeout(Duration::from_secs(2), lines.next_line())
                .await
                .expect("response timed out")
                .expect("read response")
                .expect("runtime closed");
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid frame");
            match frame["type"].as_str() {
                Some("model.call") => {
                    model_calls += 1;
                    let operation_id = frame["operationID"].as_str().expect("operation id");
                    let callback = format!(
                        "{{\"type\":\"model.result\",\"requestID\":\"model_hook\",\"operationID\":\"{operation_id}\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"toolCall\",\"id\":\"missing_1\",\"name\":\"missing\",\"arguments\":{{}}}}],\"provider\":\"server\",\"model\":\"test\",\"stopReason\":\"toolUse\",\"timestamp\":2}}}}\n"
                    );
                    client_write
                        .write_all(callback.as_bytes())
                        .await
                        .expect("write model result");
                }
                Some("hook.call") => {
                    hook_calls += 1;
                    assert_eq!(frame["hook"], "shouldStopAfterTurn");
                    assert_eq!(frame["payload"]["message"]["role"], "assistant");
                    let operation_id = frame["operationID"].as_str().expect("operation id");
                    let callback = format!(
                        "{{\"type\":\"hook.result\",\"requestID\":\"hook_done\",\"operationID\":\"{operation_id}\",\"result\":true}}\n"
                    );
                    client_write
                        .write_all(callback.as_bytes())
                        .await
                        .expect("write hook result");
                }
                Some("turn.completed") => break frame,
                _ => {}
            }
        };
        assert_eq!(completed["turns"], 1);
        assert_eq!(model_calls, 1);
        assert_eq!(hook_calls, 1);

        client_write
            .write_all(b"{\"type\":\"runtime.shutdown\",\"requestID\":\"bye\"}\n")
            .await
            .expect("write shutdown");
        while let Some(line) = lines.next_line().await.expect("read shutdown") {
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid frame");
            if frame["type"] == "runtime.shutdownComplete" {
                break;
            }
        }
        runtime.await.expect("runtime task").expect("runtime result");
    }

    #[tokio::test]
    async fn native_read_executes_without_a_server_tool_callback() {
        let workspace = tempfile::TempDir::new().expect("temp workspace");
        std::fs::write(workspace.path().join("native.txt"), "read by rust").expect("fixture");
        let (client, server) = tokio::io::duplex(128 * 1024);
        let (server_read, server_write) = tokio::io::split(server);
        let runtime = tokio::spawn(serve(BufReader::new(server_read), BufWriter::new(server_write)));
        let (client_read, mut client_write) = tokio::io::split(client);
        let mut lines = BufReader::new(client_read).lines();

        let requests = [
            serde_json::json!({
                "type": "runtime.initialize",
                "requestID": "1",
                "protocolVersion": 1,
                "serverVersion": "test",
            }),
            serde_json::json!({
                "type": "session.create",
                "requestID": "2",
                "sessionID": "native-session",
                "config": {
                    "model": {"id": "test", "provider": "server"},
                    "messages": [],
                    "tools": [{
                        "name": "read",
                        "label": "read",
                        "description": "read a file",
                        "parameters": {"type": "object"},
                    }],
                    "workspaceRoot": workspace.path(),
                    "nativeTools": ["read"],
                },
            }),
            serde_json::json!({
                "type": "turn.start",
                "requestID": "native-turn",
                "sessionID": "native-session",
                "prompts": [{"role": "user", "content": "read", "timestamp": 1}],
            }),
        ];
        for request in requests {
            client_write
                .write_all(format!("{}\n", serde_json::to_string(&request).expect("serialize")).as_bytes())
                .await
                .expect("write request");
        }

        let mut model_calls = 0;
        let mut tool_callbacks = 0;
        loop {
            let line = timeout(Duration::from_secs(2), lines.next_line())
                .await
                .expect("response timed out")
                .expect("read response")
                .expect("runtime closed");
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid frame");
            match frame["type"].as_str() {
                Some("model.call") => {
                    model_calls += 1;
                    let operation_id = frame["operationID"].as_str().expect("operation id");
                    let message = if model_calls == 1 {
                        serde_json::json!({
                            "role": "assistant",
                            "content": [{
                                "type": "toolCall",
                                "id": "native-read-1",
                                "name": "read",
                                "arguments": {"path": "native.txt"},
                            }],
                            "provider": "server",
                            "model": "test",
                            "stopReason": "toolUse",
                            "timestamp": 2,
                        })
                    } else {
                        let result = frame["messages"]
                            .as_array()
                            .expect("messages")
                            .iter()
                            .find(|message| message["role"] == "toolResult")
                            .expect("native tool result reaches model");
                        assert_eq!(result["content"][0]["text"], "read by rust");
                        serde_json::json!({
                            "role": "assistant",
                            "content": [{"type": "text", "text": "done"}],
                            "provider": "server",
                            "model": "test",
                            "stopReason": "stop",
                            "timestamp": 3,
                        })
                    };
                    let callback = serde_json::json!({
                        "type": "model.result",
                        "requestID": format!("model-{model_calls}"),
                        "operationID": operation_id,
                        "message": message,
                    });
                    client_write
                        .write_all(format!("{}\n", serde_json::to_string(&callback).expect("serialize")).as_bytes())
                        .await
                        .expect("write model result");
                }
                Some("tool.call") => tool_callbacks += 1,
                Some("turn.completed") => break,
                _ => {}
            }
        }
        assert_eq!(model_calls, 2);
        assert_eq!(tool_callbacks, 0);

        client_write
            .write_all(b"{\"type\":\"runtime.shutdown\",\"requestID\":\"bye\"}\n")
            .await
            .expect("write shutdown");
        while let Some(line) = lines.next_line().await.expect("read shutdown") {
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid frame");
            if frame["type"] == "runtime.shutdownComplete" {
                break;
            }
        }
        runtime.await.expect("runtime task").expect("runtime result");
    }
}
