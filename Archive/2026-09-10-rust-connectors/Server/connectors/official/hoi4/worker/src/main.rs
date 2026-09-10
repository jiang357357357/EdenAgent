use eden_agent_connector_protocol::{
    CapabilityCall, InitializeParams, InitializeResult, PublishedEvent, RpcNotification,
    RpcRequest, RpcResponse, WireMessage, WorkerStatus, method, read_message, write_message,
};
use eden_agent_hoi4::{Observation, Observer, ObserverConfig, ObserverHandle};
use serde_json::{Value, json};
use std::{process::ExitCode, sync::Arc};
use tokio::{
    io::Stdout,
    sync::{Mutex, mpsc},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

const CONNECTOR_ID: &str = "hoi4";
const WORKER_VERSION: &str = env!("CARGO_PKG_VERSION");

type SharedWriter = Arc<Mutex<Stdout>>;

struct ObserverRuntime {
    handle: ObserverHandle,
    cancellation: CancellationToken,
    observer_task: JoinHandle<Result<(), String>>,
    forwarding_task: JoinHandle<()>,
}

impl ObserverRuntime {
    async fn shutdown(self) {
        self.cancellation.cancel();
        let _ = self.observer_task.await;
        let _ = self.forwarding_task.await;
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("HOI4 connector worker failed: {error}");
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
    runtime: &mut Option<ObserverRuntime>,
) -> RpcResponse {
    let result = match request.method.as_str() {
        method::INITIALIZE => initialize(request.params, writer, runtime).await,
        method::HEALTH => health(runtime).await,
        method::QUERY => query(request.params, runtime).await,
        method::DISCONNECT => disconnect(runtime).await,
        method::SHUTDOWN => disconnect(runtime).await,
        method::EXECUTE => Err((
            "unsupported_operation",
            "the HOI4 observer exposes no actions".to_owned(),
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
    runtime: &mut Option<ObserverRuntime>,
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
            format!(
                "worker supports protocol {}, host requested {}",
                eden_agent_connector_protocol::PROTOCOL_VERSION,
                params.protocol_version
            ),
        ));
    }
    if params.connector_key != CONNECTOR_ID {
        return Err((
            "connector_mismatch",
            format!("worker cannot serve connector {}", params.connector_key),
        ));
    }

    let config = ObserverConfig::from_settings(&params.settings);
    let (handle, observer) = Observer::new(config);
    let cancellation = CancellationToken::new();
    let (sender, receiver) = mpsc::channel(128);
    let observer_task = tokio::spawn(observer.run(cancellation.clone(), sender));
    let forwarding_task = tokio::spawn(forward_observations(receiver, Arc::clone(writer)));
    *runtime = Some(ObserverRuntime {
        handle,
        cancellation,
        observer_task,
        forwarding_task,
    });

    serde_json::to_value(InitializeResult {
        protocol_version: eden_agent_connector_protocol::PROTOCOL_VERSION,
        worker_version: WORKER_VERSION.to_owned(),
        capabilities: vec![
            "bridge_ready".to_owned(),
            "snapshot".to_owned(),
            "get_state".to_owned(),
        ],
    })
    .map_err(|error| ("internal_error", error.to_string()))
}

async fn health(runtime: &Option<ObserverRuntime>) -> Result<Value, (&'static str, String)> {
    let Some(runtime) = runtime else {
        return Ok(json!({"state":"starting","initialized":false}));
    };
    let state = runtime.handle.state().await;
    Ok(json!({
        "state": if state.bridge_seen { "ready" } else if state.attached { "connecting" } else { "starting" },
        "initialized": true,
        "attached": state.attached,
        "bridgeSeen": state.bridge_seen,
        "logPath": state.log_path,
    }))
}

async fn query(
    params: Value,
    runtime: &Option<ObserverRuntime>,
) -> Result<Value, (&'static str, String)> {
    let call: CapabilityCall =
        serde_json::from_value(params).map_err(|error| ("invalid_params", error.to_string()))?;
    if call.capability != "get_state" {
        return Err((
            "unsupported_capability",
            format!("unknown HOI4 query {}", call.capability),
        ));
    }
    let runtime = runtime.as_ref().ok_or((
        "not_initialized",
        "worker has not been initialized".to_owned(),
    ))?;
    serde_json::to_value(runtime.handle.state().await)
        .map_err(|error| ("internal_error", error.to_string()))
}

async fn disconnect(
    runtime: &mut Option<ObserverRuntime>,
) -> Result<Value, (&'static str, String)> {
    if let Some(runtime) = runtime.take() {
        runtime.shutdown().await;
    }
    Ok(json!({"disconnected":true}))
}

async fn forward_observations(mut receiver: mpsc::Receiver<Observation>, writer: SharedWriter) {
    while let Some(observation) = receiver.recv().await {
        let notification = match observation {
            Observation::Attached { log_path } => RpcNotification {
                method: method::STATUS.to_owned(),
                params: serialize(WorkerStatus {
                    state: "connecting".to_owned(),
                    detail: Some(format!("following {}", log_path.display())),
                }),
            },
            observation => {
                let Some(event_type) = package_event_type(&observation) else {
                    continue;
                };
                let Some(external_id) = observation.external_id() else {
                    continue;
                };
                RpcNotification {
                    method: method::EVENT_PUBLISH.to_owned(),
                    params: serialize(PublishedEvent {
                        external_id,
                        event_type: event_type.to_owned(),
                        payload: observation.payload(),
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

fn package_event_type(observation: &Observation) -> Option<&'static str> {
    match observation {
        Observation::Attached { .. } => None,
        Observation::Hello { .. } => Some("bridge_ready"),
        Observation::Snapshot(_) => Some("snapshot"),
    }
}

fn serialize(value: impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap_or_else(
        |error| json!({"state":"degraded","detail":format!("serialization failed: {error}")}),
    )
}

async fn send(writer: &SharedWriter, message: WireMessage) -> Result<(), String> {
    write_message(&mut *writer.lock().await, &message)
        .await
        .map_err(|error| error.to_string())
}
