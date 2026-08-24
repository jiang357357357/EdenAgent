use mon_agent_connector_host::{WorkerLaunchConfig, WorkerProcess};
use mon_agent_connector_package::{LoadPolicy, LoadedPackage, current_platform};
use mon_agent_connector_protocol::{PublishedEvent, method};
use mon_agent_connectors::{ConnectorService, ConnectorServiceConfig};
use mon_agent_store::Store;
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::io::AsyncWriteExt;

#[tokio::test]
async fn worker_observes_log_and_answers_generic_query() {
    let directory = tempfile::tempdir().expect("tempdir");
    let package_root = directory.path().join("package");
    let worker_relative = if cfg!(windows) {
        "workers/windows-x64/mon-agent-connector-hoi4.exe"
    } else {
        "workers/linux-x64/mon-agent-connector-hoi4"
    };
    let worker_target = package_root.join(worker_relative);
    fs::create_dir_all(worker_target.parent().expect("worker parent")).expect("worker directory");
    fs::copy(
        env!("CARGO_BIN_EXE_mon-agent-connector-hoi4"),
        &worker_target,
    )
    .expect("copy worker");
    let mut manifest: Value =
        serde_json::from_str(include_str!("../../package/connector.json")).expect("manifest");
    manifest["entrypoints"] = json!({
        current_platform(): {"path": worker_relative, "args": []}
    });
    fs::write(
        package_root.join("connector.json"),
        serde_json::to_vec(&manifest).expect("serialize manifest"),
    )
    .expect("write manifest");

    let log_path = directory.path().join("game.log");
    tokio::fs::write(&log_path, "HOI4 startup\n")
        .await
        .expect("seed log");
    let package =
        LoadedPackage::load(&package_root, LoadPolicy::Development).expect("load package");
    let mut process = WorkerProcess::launch(WorkerLaunchConfig::new(
        package,
        "test-instance",
        json!({"logPath":path_text(&log_path)}),
        directory.path().join("data"),
    ))
    .await
    .expect("launch worker");
    assert!(
        process
            .initialization
            .capabilities
            .iter()
            .any(|capability| capability == "get_state")
    );

    let mut file = tokio::fs::OpenOptions::new()
        .append(true)
        .open(&log_path)
        .await
        .expect("open log");
    file.write_all(
        b"MONAGENT_HOI4|1|HELLO|bridge_version=0.1.0|mode=observe\nMONAGENT_HOI4|1|SNAPSHOT|date=1939.9.1|country_tag=GER|political_power=125.5|at_war=1\n",
    )
    .await
    .expect("append bridge lines");

    let event = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let notification = process.recv_notification().await.expect("notification");
            if notification.method != method::EVENT_PUBLISH {
                continue;
            }
            let event: PublishedEvent =
                serde_json::from_value(notification.params).expect("published event");
            if event.event_type == "snapshot" {
                break event;
            }
        }
    })
    .await
    .expect("snapshot timeout");
    assert_eq!(event.payload["country"]["countryTag"], "GER");

    let state = process
        .client()
        .query("get_state", json!({}))
        .await
        .expect("query state");
    assert_eq!(state["latestSnapshot"]["country"]["countryTag"], "GER");
    process.shutdown().await.expect("shutdown worker");
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tokio::test]
async fn server_supervisor_persists_worker_events_and_routes_queries() {
    let directory = tempfile::tempdir().expect("tempdir");
    let packages_root = directory.path().join("packages");
    install_test_package(&packages_root);
    let log_path = directory.path().join("game.log");
    tokio::fs::write(&log_path, "HOI4 startup\n")
        .await
        .expect("seed log");
    let store = Store::open(directory.path().join("agent.db"))
        .await
        .expect("store");
    let connector = store
        .register_connector(
            "hoi4",
            "local",
            "Hearts of Iron IV",
            "connected",
            json!({"logPath":path_text(&log_path)}),
        )
        .await
        .expect("register connector");
    let service = ConnectorService::with_config(
        store.clone(),
        ConnectorServiceConfig {
            manifest_root: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../../Server/connectors/manifests"),
            package_root: packages_root,
            package_policy: LoadPolicy::Development,
            connector_data_root: directory.path().join("runtime"),
        },
    )
    .expect("connector service");
    let reconcile_task = service.start();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if service
                .query(&connector, "get_state", json!({}))
                .await
                .is_ok()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("worker startup timeout");

    let mut file = tokio::fs::OpenOptions::new()
        .append(true)
        .open(&log_path)
        .await
        .expect("open log");
    file.write_all(
        b"MONAGENT_HOI4|1|HELLO|bridge_version=0.1.0|mode=observe\nMONAGENT_HOI4|1|SNAPSHOT|date=1939.9.1|country_tag=GER|political_power=125.5\n",
    )
    .await
    .expect("append bridge lines");

    let state = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let state = service
                .query(&connector, "get_state", json!({}))
                .await
                .expect("query state");
            if state["latestSnapshot"]["country"]["countryTag"] == "GER" {
                break state;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("state timeout");
    assert_eq!(state["latestSnapshot"]["country"]["politicalPower"], 125.5);

    let events = tokio::time::timeout(Duration::from_secs(5), async {
        let mut observed = Vec::new();
        loop {
            let events = store
                .claim_connector_events(connector.id, 10, 60_000)
                .await
                .expect("claim events");
            observed.extend(events);
            let has_snapshot = observed
                .iter()
                .any(|event| event.event_type == "hoi4.snapshot");
            let has_bridge_ready = observed
                .iter()
                .any(|event| event.event_type == "hoi4.bridge_ready");
            if has_snapshot && has_bridge_ready {
                break observed;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("event timeout");
    assert!(
        events
            .iter()
            .any(|event| event.event_type == "hoi4.bridge_ready")
    );

    service.shutdown().await;
    reconcile_task.abort();
}

fn install_test_package(packages_root: &Path) {
    let package_root = packages_root.join("hoi4");
    let worker_relative = if cfg!(windows) {
        "workers/windows-x64/mon-agent-connector-hoi4.exe"
    } else {
        "workers/linux-x64/mon-agent-connector-hoi4"
    };
    let worker_target = package_root.join(worker_relative);
    fs::create_dir_all(worker_target.parent().expect("worker parent")).expect("worker directory");
    fs::copy(
        env!("CARGO_BIN_EXE_mon-agent-connector-hoi4"),
        &worker_target,
    )
    .expect("copy worker");
    let mut manifest: Value =
        serde_json::from_str(include_str!("../../package/connector.json")).expect("manifest");
    manifest["entrypoints"] = json!({
        current_platform(): {"path": worker_relative, "args": []}
    });
    fs::write(
        package_root.join("connector.json"),
        serde_json::to_vec(&manifest).expect("serialize manifest"),
    )
    .expect("write manifest");
}
