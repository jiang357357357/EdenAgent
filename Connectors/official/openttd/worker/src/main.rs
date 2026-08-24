use eden_agent_connector_protocol::{
    CapabilityCall, InitializeParams, InitializeResult, PublishedEvent, RpcNotification,
    RpcRequest, RpcResponse, WireMessage, WorkerStatus, method, read_message, write_message,
};
use eden_agent_connectors::openttd::{self, Event, Handle};
use serde_json::{Value, json};
use std::{process::ExitCode, sync::Arc};
use tokio::{io::Stdout, sync::Mutex, task::JoinHandle};
use tokio_util::sync::CancellationToken;

const CONNECTOR_ID: &str = "openttd";
const WORKER_VERSION: &str = env!("CARGO_PKG_VERSION");
type SharedWriter = Arc<Mutex<Stdout>>;

struct Runtime {
    handle: Handle,
    cancellation: CancellationToken,
    connector_task: JoinHandle<Result<(), String>>,
    forwarding_task: JoinHandle<()>,
}

impl Runtime {
    async fn shutdown(self) {
        self.cancellation.cancel();
        let _ = self.connector_task.await;
        let _ = self.forwarding_task.await;
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("OpenTTD connector worker failed: {error}");
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
        method::QUERY => query(request.params, runtime).await,
        method::EXECUTE => execute(request.params, runtime).await,
        method::DISCONNECT | method::SHUTDOWN => disconnect(runtime).await,
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
    let (handle, commands) = openttd::channel();
    let (events, receiver) = tokio::sync::mpsc::channel(128);
    let cancellation = CancellationToken::new();
    let task_writer = Arc::clone(writer);
    let task_cancellation = cancellation.clone();
    let identity_key = std::env::var("MON_CONNECTOR_IDENTITY_KEY").map_err(|_| {
        (
            "invalid_identity",
            "connector identity key is missing".to_owned(),
        )
    })?;
    let connector_task = tokio::spawn(async move {
        let result = openttd::run(
            openttd::Config {
                identity_key,
                settings: params.settings,
                credential_environment: Some("MON_CONNECTOR_IDENTITY_CREDENTIAL".to_owned()),
            },
            task_cancellation,
            commands,
            events,
        )
        .await;
        if let Err(error) = &result {
            let _ = send(
                &task_writer,
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
    let forwarding_task = tokio::spawn(forward_events(receiver, Arc::clone(writer)));
    *runtime = Some(Runtime {
        handle,
        cancellation,
        connector_task,
        forwarding_task,
    });
    serde_json::to_value(InitializeResult {
        protocol_version: eden_agent_connector_protocol::PROTOCOL_VERSION,
        worker_version: WORKER_VERSION.to_owned(),
        capabilities: [
            "chat",
            "new_game",
            "company_removed",
            "gamescript",
            "get_state",
            "inspect_tile",
            "find_towns",
            "find_industries",
            "get_company_assets",
            "list_road_engines",
            "find_road_route_site",
            "refresh_state",
            "pause_game",
            "resume_game",
            "save_game",
            "send_chat",
            "gameplay_command",
            "gameplay_plan",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect(),
    })
    .map_err(|error| ("internal_error", error.to_string()))
}

async fn health(runtime: &Option<Runtime>) -> Result<Value, (&'static str, String)> {
    Ok(json!({
        "state": match runtime { Some(value) if value.connector_task.is_finished() => "degraded", Some(_) => "ready", None => "starting" },
        "initialized": runtime.is_some(),
    }))
}

async fn execute(
    params: Value,
    runtime: &Option<Runtime>,
) -> Result<Value, (&'static str, String)> {
    let call: CapabilityCall =
        serde_json::from_value(params).map_err(|error| ("invalid_params", error.to_string()))?;
    runtime
        .as_ref()
        .ok_or((
            "not_initialized",
            "worker has not been initialized".to_owned(),
        ))?
        .handle
        .execute(&call.capability, call.payload)
        .await
        .map_err(|error| ("action_failed", error))
}

async fn query(params: Value, runtime: &Option<Runtime>) -> Result<Value, (&'static str, String)> {
    let call: CapabilityCall =
        serde_json::from_value(params).map_err(|error| ("invalid_params", error.to_string()))?;
    let runtime = runtime.as_ref().ok_or((
        "not_initialized",
        "worker has not been initialized".to_owned(),
    ))?;
    if call.capability == "get_state" {
        return runtime
            .handle
            .execute("refresh_state", json!({}))
            .await
            .map_err(|error| ("query_failed", error));
    }
    let mut command = call.payload;
    if !command.is_object() {
        command = json!({});
    }
    command["action"] = Value::String(call.capability);
    runtime
        .handle
        .execute("gameplay_command", json!({"command":command}))
        .await
        .map_err(|error| ("query_failed", error))
}

async fn disconnect(runtime: &mut Option<Runtime>) -> Result<Value, (&'static str, String)> {
    if let Some(runtime) = runtime.take() {
        runtime.shutdown().await;
    }
    Ok(json!({"disconnected":true}))
}

async fn forward_events(mut receiver: tokio::sync::mpsc::Receiver<Event>, writer: SharedWriter) {
    while let Some(event) = receiver.recv().await {
        let notification = match event {
            Event::Status { state, detail } => RpcNotification {
                method: method::STATUS.to_owned(),
                params: serialize(WorkerStatus {
                    state: if state == "connected" {
                        "ready".to_owned()
                    } else {
                        state
                    },
                    detail,
                }),
            },
            Event::Published {
                external_id,
                event_type,
                payload,
            } => {
                let Some(event_type) = event_type.strip_prefix("openttd.") else {
                    continue;
                };
                RpcNotification {
                    method: method::EVENT_PUBLISH.to_owned(),
                    params: serialize(PublishedEvent {
                        external_id,
                        event_type: event_type.to_owned(),
                        payload,
                    }),
                }
            }
        };
        if send(&writer, WireMessage::Notification(notification))
            .await
            .is_err()
        {
            break;
        }
    }
}

fn serialize(value: impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}
async fn send(writer: &SharedWriter, message: WireMessage) -> Result<(), String> {
    write_message(&mut *writer.lock().await, &message)
        .await
        .map_err(|error| error.to_string())
}
