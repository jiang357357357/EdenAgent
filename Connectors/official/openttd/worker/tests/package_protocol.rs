use eden_agent_connector_host::{WorkerLaunchConfig, WorkerProcess};
use eden_agent_connector_package::{LoadPolicy, LoadedPackage, current_platform};
use serde_json::{Value, json};
use std::fs;

#[tokio::test]
async fn package_worker_negotiates_capabilities_and_shuts_down_cleanly() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("fake OpenTTD Admin Port");
    let address = listener.local_addr().expect("fake address");
    let directory = tempfile::tempdir().expect("tempdir");
    let package_root = directory.path().join("package");
    let worker_relative = if cfg!(windows) {
        "workers/windows-x64/eden-agent-connector-openttd.exe"
    } else {
        "workers/linux-x64/eden-agent-connector-openttd"
    };
    let worker_target = package_root.join(worker_relative);
    fs::create_dir_all(worker_target.parent().expect("worker parent")).expect("worker directory");
    fs::copy(
        env!("CARGO_BIN_EXE_eden-agent-connector-openttd"),
        &worker_target,
    )
    .expect("copy worker");
    let mut manifest: Value =
        serde_json::from_str(include_str!("../../package/connector.json")).expect("manifest");
    manifest["entrypoints"] = json!({
        current_platform(): {"path":worker_relative,"args":[]}
    });
    fs::write(
        package_root.join("connector.json"),
        serde_json::to_vec(&manifest).expect("serialize manifest"),
    )
    .expect("write manifest");

    let package =
        LoadedPackage::load(&package_root, LoadPolicy::Development).expect("load package");
    let game_port = if address.port() == u16::MAX {
        address.port() - 1
    } else {
        address.port() + 1
    };
    let mut launch = WorkerLaunchConfig::new(
        package,
        "test-instance",
        json!({
            "host":"127.0.0.1",
            "adminPort":address.port(),
            "gamePort":game_port
        }),
        directory.path().join("data"),
    );
    launch.environment.insert(
        "MON_CONNECTOR_IDENTITY_KEY".to_owned(),
        "test-instance".to_owned(),
    );
    launch.environment.insert(
        "MON_CONNECTOR_IDENTITY_CREDENTIAL".to_owned(),
        "test-password".to_owned(),
    );
    let process = WorkerProcess::launch(launch).await.expect("launch worker");
    for capability in ["get_state", "gameplay_command", "pause_game"] {
        assert!(
            process
                .initialization
                .capabilities
                .iter()
                .any(|declared| declared == capability),
            "missing {capability}"
        );
    }
    process.shutdown().await.expect("shutdown worker");
    drop(listener);
}
