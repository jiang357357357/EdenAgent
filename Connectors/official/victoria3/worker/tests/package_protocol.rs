use mon_agent_connector_host::{WorkerLaunchConfig, WorkerProcess};
use mon_agent_connector_package::{LoadPolicy, LoadedPackage, current_platform};
use mon_agent_connector_protocol::{PublishedEvent, method};
use serde_json::{Value, json};
use std::{fs, path::Path, time::Duration};
use tokio::io::AsyncWriteExt;

#[tokio::test]
async fn package_worker_observes_snapshots_and_keeps_control_disabled_by_default() {
    let directory = tempfile::tempdir().expect("tempdir");
    let package_root = directory.path().join("package");
    let worker_relative = if cfg!(windows) {
        "workers/windows-x64/mon-agent-connector-victoria3.exe"
    } else {
        "workers/linux-x64/mon-agent-connector-victoria3"
    };
    let worker_target = package_root.join(worker_relative);
    fs::create_dir_all(worker_target.parent().expect("worker parent")).expect("worker directory");
    fs::copy(
        env!("CARGO_BIN_EXE_mon-agent-connector-victoria3"),
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

    let log_path = directory.path().join("debug.log");
    tokio::fs::write(&log_path, "Victoria 3 startup\n")
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
        b"[MONAGENT]|1|HELLO|bridge_version=0.1.0|mode=observe\n[MONAGENT]|1|SNAPSHOT|date=1842.3.15|country_id=CHI|country_name=Great Qing\n",
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
    assert_eq!(event.payload["fields"]["country_id"], "CHI");

    let state = process
        .client()
        .query("get_state", json!({}))
        .await
        .expect("query state");
    assert_eq!(state["latestSnapshot"]["fields"]["country_id"], "CHI");
    let error = process
        .client()
        .execute("probe_control", json!({}), None)
        .await
        .expect_err("control must be disabled by default");
    assert!(error.to_string().contains("control is disabled"));
    process.shutdown().await.expect("shutdown worker");
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
