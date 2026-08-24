use eden_agent_connector_host::{WorkerLaunchConfig, WorkerProcess};
use eden_agent_connector_package::{LoadPolicy, LoadedPackage, current_platform};
use eden_agent_connector_protocol::{PublishedEvent, method};
use serde_json::json;
use std::{fs, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn package_worker_streams_challenges_and_executes_safe_actions() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("fake Lichess");
    let address = listener.local_addr().expect("fake address");
    let fake = tokio::spawn(async move {
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().await.expect("accept request");
            let mut bytes = vec![0_u8; 8_192];
            let read = socket.read(&mut bytes).await.expect("read request");
            let request = String::from_utf8_lossy(&bytes[..read]);
            if request.starts_with("GET /api/stream/event ") {
                let body = b"{\"type\":\"challenge\",\"challenge\":{\"id\":\"challenge123\"}}\n";
                socket
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        )
                        .as_bytes(),
                    )
                    .await
                    .expect("stream headers");
                socket.write_all(body).await.expect("stream body");
            } else {
                assert!(request.starts_with("POST /api/challenge/challenge123/accept "));
                assert!(
                    request.contains("authorization: Bearer test-token")
                        || request.contains("Authorization: Bearer test-token")
                );
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}")
                    .await
                    .expect("action response");
            }
        }
    });

    let package_root = tempfile::tempdir().expect("package root");
    let worker_relative = if cfg!(windows) {
        "workers/windows-x64/eden-agent-connector-lichess.exe"
    } else {
        "workers/linux-x64/eden-agent-connector-lichess"
    };
    let worker = package_root.path().join(worker_relative);
    fs::create_dir_all(worker.parent().expect("worker directory")).expect("worker directory");
    fs::copy(env!("CARGO_BIN_EXE_eden-agent-connector-lichess"), &worker).expect("worker binary");
    fs::write(
        package_root.path().join("connector.json"),
        serde_json::to_vec(&json!({
            "schemaVersion":1,
            "id":"lichess",
            "name":"Lichess",
            "description":"protocol integration test",
            "version":"1.0.0",
            "protocolVersion":1,
            "icon":"cable",
            "entrypoints":{current_platform():{"path":worker_relative,"args":[]}},
            "settingsSchema":{"type":"object","properties":{"baseUrl":{"type":"string"}},"additionalProperties":false},
            "permissions":[],
            "events":{"challenge":{},"game_state":{}},
            "queries":{},
            "actions":{
                "accept_challenge":{"type":"object","properties":{},"additionalProperties":false},
                "decline_challenge":{"type":"object","properties":{},"additionalProperties":false},
                "make_move":{"type":"object","properties":{},"additionalProperties":false},
                "resign":{"type":"object","properties":{},"additionalProperties":false},
                "offer_draw":{"type":"object","properties":{},"additionalProperties":false},
                "send_chat":{"type":"object","properties":{},"additionalProperties":false}
            }
        }))
        .expect("manifest"),
    )
    .expect("manifest");
    let package =
        LoadedPackage::load(package_root.path(), LoadPolicy::Development).expect("loaded package");
    let data = tempfile::tempdir().expect("data");
    let mut launch = WorkerLaunchConfig::new(
        package,
        "instance-1",
        json!({"baseUrl":format!("http://127.0.0.1:{}",address.port())}),
        data.path().to_path_buf(),
    );
    launch.environment.insert(
        "MON_CONNECTOR_IDENTITY_KEY".to_owned(),
        "test-bot".to_owned(),
    );
    launch.environment.insert(
        "MON_CONNECTOR_IDENTITY_CREDENTIAL".to_owned(),
        "test-token".to_owned(),
    );
    let mut process = WorkerProcess::launch(launch).await.expect("launch worker");
    let action = process
        .client()
        .execute(
            "accept_challenge",
            json!({"challenge_id":"challenge123"}),
            None,
        )
        .await
        .expect("execute action");
    assert_eq!(action["ok"], true);

    let event = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let notification = process.recv_notification().await.expect("notification");
            if notification.method == method::EVENT_PUBLISH {
                let event: PublishedEvent =
                    serde_json::from_value(notification.params).expect("published event");
                if event.event_type == "challenge" {
                    break event;
                }
            }
        }
    })
    .await
    .expect("challenge timeout");
    assert_eq!(event.payload["challenge"]["id"], "challenge123");
    process.shutdown().await.expect("shutdown worker");
    fake.await.expect("fake server");
}
