//! Language-neutral Connector Worker protocol and framed transport.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

pub mod method {
    pub const INITIALIZE: &str = "initialize";
    pub const HEALTH: &str = "health";
    pub const QUERY: &str = "query";
    pub const EXECUTE: &str = "execute";
    pub const DISCONNECT: &str = "disconnect";
    pub const SHUTDOWN: &str = "shutdown";
    pub const EVENT_PUBLISH: &str = "event.publish";
    pub const STATUS: &str = "worker.status";
    pub const LOG: &str = "worker.log";
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RpcRequest {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RpcNotification {
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RpcResponse {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl RpcResponse {
    #[must_use]
    pub fn success(id: u64, result: Value) -> Self {
        Self {
            id,
            result: Some(result),
            error: None,
        }
    }

    #[must_use]
    pub fn failure(id: u64, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            id,
            result: None,
            error: Some(RpcError {
                code: code.into(),
                message: message.into(),
                data: None,
            }),
        }
    }

    pub fn into_result(self) -> Result<Value, RpcError> {
        match (self.result, self.error) {
            (Some(result), None) => Ok(result),
            (None, Some(error)) => Err(error),
            _ => Err(RpcError {
                code: "invalid_response".to_owned(),
                message: "worker response must contain exactly one of result or error".to_owned(),
                data: None,
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Error, Serialize)]
#[error("{code}: {message}")]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RpcError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum WireMessage {
    Request(RpcRequest),
    Notification(RpcNotification),
    Response(RpcResponse),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InitializeParams {
    pub protocol_version: u32,
    pub connector_instance_id: String,
    pub connector_key: String,
    pub package_version: String,
    #[serde(default)]
    pub settings: Value,
    #[serde(default)]
    pub granted_permissions: Vec<GrantedPermission>,
    pub data_directory: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InitializeResult {
    pub protocol_version: u32,
    pub worker_version: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GrantedPermission {
    pub capability: String,
    pub resource: String,
    pub access: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityCall {
    pub capability: String,
    #[serde(default)]
    pub payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedEvent {
    pub external_id: String,
    pub event_type: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerStatus {
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Error)]
pub enum FrameError {
    #[error("connector frame I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("connector frame is too large: {actual} bytes exceeds {maximum}")]
    TooLarge { actual: usize, maximum: usize },
    #[error("connector frame contains invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub async fn read_message<R>(reader: &mut R) -> Result<Option<WireMessage>, FrameError>
where
    R: AsyncRead + Unpin,
{
    let mut header = [0_u8; 4];
    if reader.read(&mut header[..1]).await? == 0 {
        return Ok(None);
    }
    reader.read_exact(&mut header[1..]).await?;
    let length = u32::from_be_bytes(header) as usize;
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge {
            actual: length,
            maximum: MAX_FRAME_BYTES,
        });
    }
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload).await?;
    Ok(Some(serde_json::from_slice(&payload)?))
}

pub async fn write_message<W>(writer: &mut W, message: &WireMessage) -> Result<(), FrameError>
where
    W: AsyncWrite + Unpin,
{
    let payload = serde_json::to_vec(message)?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge {
            actual: payload.len(),
            maximum: MAX_FRAME_BYTES,
        });
    }
    writer
        .write_all(&(payload.len() as u32).to_be_bytes())
        .await?;
    writer.write_all(&payload).await?;
    writer.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn round_trips_fragmented_framed_messages() {
        let (mut client, mut server) = tokio::io::duplex(64);
        let expected = WireMessage::Request(RpcRequest {
            id: 7,
            method: method::QUERY.to_owned(),
            params: json!({"capability":"get_state"}),
        });
        let writer = tokio::spawn(async move { write_message(&mut client, &expected).await });
        let WireMessage::Request(request) = read_message(&mut server)
            .await
            .expect("read frame")
            .expect("message")
        else {
            panic!("expected request")
        };
        assert_eq!(request.id, 7);
        assert_eq!(request.method, method::QUERY);
        writer.await.expect("writer").expect("write frame");
    }

    #[tokio::test]
    async fn rejects_oversized_frames_before_allocating_payload() {
        let mut bytes = std::io::Cursor::new(((MAX_FRAME_BYTES + 1) as u32).to_be_bytes());
        assert!(matches!(
            read_message(&mut bytes).await,
            Err(FrameError::TooLarge { .. })
        ));
    }

    #[test]
    fn response_requires_exactly_one_outcome() {
        assert_eq!(
            RpcResponse::success(1, Value::Null)
                .into_result()
                .expect("successful response"),
            Value::Null
        );
        assert!(
            RpcResponse {
                id: 1,
                result: None,
                error: None,
            }
            .into_result()
            .is_err()
        );
    }
}
