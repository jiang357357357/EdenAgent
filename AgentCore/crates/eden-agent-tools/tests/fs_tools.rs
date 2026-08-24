use eden_agent_core::{ContentBlock, Tool, ToolCall, ToolCallContext, ToolDefinition, event_channel};
#[cfg(windows)]
use eden_agent_tools::PowerShellTool;
use eden_agent_tools::{
    ApplyPatchTool, BashTool, EditTool, FindTool, GetDiffTool, GrepTool, LsTool, NativeToolConfig, ProcessSandbox,
    ReadTool, WriteStdinTool, WriteTool,
};
use serde_json::{Value, json};
use std::fs;
use std::process::Command;
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

fn context() -> ToolCallContext {
    let (events, _receiver) = event_channel(8);
    ToolCallContext {
        cancellation: CancellationToken::new(),
        events,
        session_id: None,
        metadata: json!({}),
    }
}

fn call(name: &str, arguments: Value) -> ToolCall {
    ToolCall {
        id: "call-1".to_owned(),
        name: name.to_owned(),
        arguments,
    }
}

fn definition(name: &str) -> ToolDefinition {
    ToolDefinition::direct(name, format!("{name} test tool"))
}

fn output_text(output: &eden_agent_core::ToolOutput) -> &str {
    match output.content.first() {
        Some(ContentBlock::Text { text }) => text,
        other => panic!("expected text output, got {other:?}"),
    }
}

#[tokio::test]
async fn read_and_ls_match_wire_shapes() {
    let root = TempDir::new().expect("tempdir");
    fs::create_dir(root.path().join("folder")).expect("folder");
    fs::write(root.path().join("notes.txt"), "one\ntwo\nthree\nfour").expect("fixture");
    let config = NativeToolConfig::new(root.path());

    let read = ReadTool::new(definition("read"), config.clone());
    let result = read
        .execute(
            &call("read", json!({ "path": "notes.txt", "offset": 2, "limit": 2 })),
            context(),
        )
        .await
        .expect("read succeeds");
    assert!(result.success);
    assert!(output_text(&result).starts_with("two\nthree"));
    assert_eq!(result.details["start_line"], 2);
    assert_eq!(result.details["next_offset"], 4);
    assert_eq!(result.structured_content, Some(result.details.clone()));

    let ls = LsTool::new(definition("ls"), config);
    let result = ls
        .execute(&call("ls", json!({})), context())
        .await
        .expect("ls succeeds");
    assert_eq!(output_text(&result), "folder/\nnotes.txt");
}

#[tokio::test]
async fn read_attaches_small_images() {
    let root = TempDir::new().expect("tempdir");
    fs::write(root.path().join("pixel.png"), b"not-a-real-png").expect("fixture");
    let read = ReadTool::new(definition("read"), NativeToolConfig::new(root.path()));
    let result = read
        .execute(&call("read", json!({ "path": "pixel.png" })), context())
        .await
        .expect("read succeeds");
    assert!(matches!(result.content.get(1), Some(ContentBlock::Image { mime_type, .. }) if mime_type == "image/png"));
}

#[tokio::test]
async fn find_and_grep_respect_ignore_glob_and_limits() {
    let root = TempDir::new().expect("tempdir");
    fs::create_dir(root.path().join("src")).expect("folder");
    fs::write(root.path().join(".gitignore"), "ignored.txt\n").expect("ignore");
    fs::write(root.path().join("ignored.txt"), "needle\n").expect("ignored fixture");
    fs::write(root.path().join(".hidden.txt"), "hidden needle\n").expect("hidden fixture");
    fs::write(root.path().join("src").join("main.rs"), "before\nNeedle here\nafter\n").expect("source");
    let config = NativeToolConfig::new(root.path());

    let find = FindTool::new(definition("find"), config.clone());
    let result = find
        .execute(&call("find", json!({ "pattern": "*.txt" })), context())
        .await
        .expect("find succeeds");
    assert!(output_text(&result).contains(".hidden.txt"));
    assert!(!output_text(&result).contains("ignored.txt"));

    let grep = GrepTool::new(definition("grep"), config);
    let result = grep
        .execute(
            &call(
                "grep",
                json!({ "pattern": "needle", "ignoreCase": true, "glob": "*.rs", "context": 1 }),
            ),
            context(),
        )
        .await
        .expect("grep succeeds");
    assert_eq!(
        output_text(&result),
        "src/main.rs-1- before\nsrc/main.rs:2: Needle here\nsrc/main.rs-3- after"
    );
}

#[tokio::test]
async fn write_and_edit_preserve_crlf_and_return_workspace_diff() {
    let root = TempDir::new().expect("tempdir");
    let config = NativeToolConfig::new(root.path());
    let write = WriteTool::new(definition("write"), config.clone());
    let result = write
        .execute(
            &call(
                "write",
                json!({ "path": "nested/file.txt", "content": "alpha\r\nbeta\r\n" }),
            ),
            context(),
        )
        .await
        .expect("write succeeds");
    assert_eq!(result.details["kind"], "workspace_diff");
    assert_eq!(result.details["files"][0]["status"], "added");

    let edit = EditTool::new(definition("edit"), config);
    let result = edit
        .execute(
            &call(
                "edit",
                json!({ "path": "nested/file.txt", "edits": [{ "oldText": "beta", "newText": "gamma" }] }),
            ),
            context(),
        )
        .await
        .expect("edit succeeds");
    assert_eq!(
        fs::read(root.path().join("nested/file.txt")).expect("result"),
        b"alpha\r\ngamma\r\n"
    );
    assert_eq!(result.details["files"][0]["firstChangedLine"], 2);
}

#[tokio::test]
async fn edits_reject_ambiguous_and_overlapping_text() {
    let root = TempDir::new().expect("tempdir");
    fs::write(root.path().join("file.txt"), "same same\nunique block\n").expect("fixture");
    let edit = EditTool::new(definition("edit"), NativeToolConfig::new(root.path()));
    let error = edit
        .execute(
            &call(
                "edit",
                json!({ "path": "file.txt", "edits": [{ "oldText": "same", "newText": "x" }] }),
            ),
            context(),
        )
        .await
        .expect_err("ambiguous text must fail");
    assert_eq!(error.info.code, "ambiguous_text");

    let error = edit
        .execute(
            &call(
                "edit",
                json!({ "path": "file.txt", "edits": [
                    { "oldText": "unique block", "newText": "x" },
                    { "oldText": "block", "newText": "y" }
                ] }),
            ),
            context(),
        )
        .await
        .expect_err("overlap must fail");
    assert_eq!(error.info.code, "overlapping_edits");
}

#[tokio::test]
async fn workspace_escape_and_cancellation_are_rejected() {
    let root = TempDir::new().expect("tempdir");
    let read = ReadTool::new(definition("read"), NativeToolConfig::new(root.path()));
    let error = read
        .execute(&call("read", json!({ "path": "../outside.txt" })), context())
        .await
        .expect_err("escape must fail");
    assert_eq!(error.info.code, "path_outside_workspace");

    let cancelled = context();
    cancelled.cancellation.cancel();
    let error = read
        .execute(&call("read", json!({ "path": "missing.txt" })), cancelled)
        .await
        .expect_err("cancelled operation must fail first");
    assert_eq!(error.info.code, "operation_aborted");
}

#[tokio::test]
async fn bash_reports_success_and_structured_failures() {
    let root = TempDir::new().expect("tempdir");
    let config = NativeToolConfig::new(root.path()).with_process_sandbox(ProcessSandbox::Direct);
    let bash = BashTool::new(definition("bash"), config);
    let result = bash
        .execute(&call("bash", json!({ "command": "printf native-shell" })), context())
        .await
        .expect("command succeeds");
    assert_eq!(output_text(&result), "native-shell");
    assert_eq!(result.details["status"], "completed");
    assert_eq!(result.details["exit_code"], 0);

    let error = bash
        .execute(
            &call("bash", json!({ "command": "printf failed-output; exit 7" })),
            context(),
        )
        .await
        .expect_err("nonzero command fails");
    assert_eq!(error.info.code, "command_failed");
    assert_eq!(error.details["exit_code"], 7);
    assert!(error.message.contains("failed-output"));
}

#[cfg(windows)]
#[tokio::test]
async fn powershell_preserves_variables_and_utf8_output() {
    let root = TempDir::new().expect("tempdir");
    let powershell = PowerShellTool::new(
        definition("powershell"),
        NativeToolConfig::new(root.path()).with_process_sandbox(ProcessSandbox::Direct),
    );
    let result = powershell
        .execute(
            &call(
                "powershell",
                json!({
                    "command": "$value = [pscustomobject]@{ Used = 3 }; $value | ForEach-Object { Write-Output (\"值=$($_.Used) 中文\") }"
                }),
            ),
            context(),
        )
        .await
        .expect("PowerShell command succeeds");
    assert_eq!(output_text(&result).trim(), "值=3 中文");
    assert_eq!(result.details["launcher"], "powershell");
    assert_eq!(result.details["exit_code"], 0);

    let error = powershell
        .execute(
            &call("powershell", json!({ "command": "Write-Error '中文错误'; exit 7" })),
            context(),
        )
        .await
        .expect_err("nonzero PowerShell command fails");
    assert_eq!(error.info.code, "command_failed");
    assert_eq!(error.details["exit_code"], 7);
    assert!(error.message.contains("中文错误"));
    assert!(!error.message.contains('\u{fffd}'));
}

#[tokio::test]
async fn write_stdin_resumes_a_yielded_process_session() {
    let root = TempDir::new().expect("tempdir");
    let config = NativeToolConfig::new(root.path()).with_process_sandbox(ProcessSandbox::Direct);
    let bash = BashTool::new(definition("bash"), config.clone());
    let input = WriteStdinTool::new(definition("write_stdin"), config);
    let started = bash
        .execute(
            &call(
                "bash",
                json!({ "command": "read value; printf 'got:%s' \"$value\"", "yield_time_ms": 250 }),
            ),
            context(),
        )
        .await
        .expect("process yields");
    assert_eq!(started.details["phase"], "foreground");
    let session_id = started.details["session_id"].as_str().expect("session id");
    let completed = input
        .execute(
            &call(
                "write_stdin",
                json!({ "session_id": session_id, "chars": "hello\n", "yield_time_ms": 2_000 }),
            ),
            context(),
        )
        .await
        .expect("stdin succeeds");
    assert_eq!(output_text(&completed), "got:hello");
    assert_eq!(completed.details["phase"], "completed");
    assert_eq!(completed.details["can_write"], false);
}

#[tokio::test]
async fn apply_patch_adds_updates_deletes_and_moves_atomically() {
    let root = TempDir::new().expect("tempdir");
    fs::write(root.path().join("update.txt"), "old\n").expect("update fixture");
    fs::write(root.path().join("delete.txt"), "remove\n").expect("delete fixture");
    fs::write(root.path().join("move.txt"), "before\n").expect("move fixture");
    let tool = ApplyPatchTool::new(definition("apply_patch"), NativeToolConfig::new(root.path()));
    let patch = "*** Begin Patch\n*** Update File: update.txt\n@@\n-old\n+new\n*** Add File: added.txt\n+added\n*** Delete File: delete.txt\n*** Update File: move.txt\n*** Move to: nested/moved.txt\n@@\n-before\n+after\n*** End Patch";
    let result = tool
        .execute(&call("apply_patch", json!({ "patch": patch })), context())
        .await
        .expect("patch succeeds");
    assert_eq!(output_text(&result), "Successfully applied patch to 4 file(s).");
    assert_eq!(
        fs::read_to_string(root.path().join("update.txt")).expect("update"),
        "new\n"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("added.txt")).expect("add"),
        "added\n"
    );
    assert!(!root.path().join("delete.txt").exists());
    assert!(!root.path().join("move.txt").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("nested/moved.txt")).expect("move"),
        "after\n"
    );
    assert_eq!(result.details["kind"], "workspace_diff");
    assert_eq!(result.details["files"].as_array().expect("files").len(), 4);
}

#[tokio::test]
async fn apply_patch_prevalidates_and_rejects_workspace_escape() {
    let root = TempDir::new().expect("tempdir");
    let tool = ApplyPatchTool::new(definition("apply_patch"), NativeToolConfig::new(root.path()));
    let patch = "*** Begin Patch\n*** Add File: should-not-exist.txt\n+content\n*** Update File: missing.txt\n@@\n-old\n+new\n*** End Patch";
    let error = tool
        .execute(&call("apply_patch", json!({ "patch": patch })), context())
        .await
        .expect_err("missing source rejects whole patch");
    assert_eq!(error.info.code, "file_not_found");
    assert!(!root.path().join("should-not-exist.txt").exists());

    let escape = "*** Begin Patch\n*** Add File: ../escaped.txt\n+blocked\n*** End Patch";
    let error = tool
        .execute(&call("apply_patch", json!({ "patch": escape })), context())
        .await
        .expect_err("escape rejected");
    assert_eq!(error.info.code, "path_outside_workspace");
}

#[tokio::test]
async fn get_diff_reports_native_git_patch_and_line_counts() {
    let root = TempDir::new().expect("tempdir");
    let git = |arguments: &[&str]| {
        let status = Command::new("git")
            .args(arguments)
            .current_dir(root.path())
            .status()
            .expect("run git");
        assert!(status.success(), "git command failed: {arguments:?}");
    };
    git(&["init", "-q"]);
    git(&["config", "user.email", "tests@edenagent.local"]);
    git(&["config", "user.name", "Eden Agent Tests"]);
    fs::write(root.path().join("tracked.txt"), "before\n").expect("tracked fixture");
    git(&["add", "tracked.txt"]);
    git(&["commit", "-qm", "fixture"]);
    fs::write(root.path().join("tracked.txt"), "after\nsecond\n").expect("modify fixture");

    let tool = GetDiffTool::new(definition("get_diff"), NativeToolConfig::new(root.path()));
    let result = tool
        .execute(
            &call("get_diff", json!({"scope": "working_tree", "path": "."})),
            context(),
        )
        .await
        .expect("native diff succeeds");
    assert!(output_text(&result).starts_with("1 changed file(s)"));
    assert_eq!(result.details["kind"], "workspace_diff");
    assert_eq!(result.details["files"][0]["path"], "tracked.txt");
    assert_eq!(result.details["files"][0]["additions"], 2);
    assert_eq!(result.details["files"][0]["deletions"], 1);
    assert!(
        result.details["files"][0]["patch"]
            .as_str()
            .expect("file patch")
            .contains("+second")
    );
    assert!(result.details.get("patch").is_none());
    assert_eq!(
        result.structured_content.as_ref().expect("summary")["kind"],
        "workspace_diff_summary"
    );
}

#[tokio::test]
async fn get_diff_bounds_large_model_and_review_payloads() {
    let root = TempDir::new().expect("tempdir");
    let git = |arguments: &[&str]| {
        let status = Command::new("git")
            .args(arguments)
            .current_dir(root.path())
            .status()
            .expect("run git");
        assert!(status.success(), "git command failed: {arguments:?}");
    };
    git(&["init", "-q"]);
    git(&["config", "user.email", "tests@edenagent.local"]);
    git(&["config", "user.name", "Eden Agent Tests"]);
    fs::write(root.path().join("large.txt"), "before\n").expect("tracked fixture");
    git(&["add", "large.txt"]);
    git(&["commit", "-qm", "fixture"]);
    fs::write(
        root.path().join("large.txt"),
        format!("{}\n", "changed\n".repeat(80_000)),
    )
    .expect("large modification");

    let tool = GetDiffTool::new(definition("get_diff"), NativeToolConfig::new(root.path()));
    let result = tool
        .execute(&call("get_diff", json!({"path":".","max_chars":1000})), context())
        .await
        .expect("bounded diff succeeds");

    assert!(output_text(&result).chars().count() < 1_200);
    assert!(serde_json::to_string(&result.details).expect("details").chars().count() < 45_000);
    assert!(
        serde_json::to_string(result.structured_content.as_ref().expect("structured summary"))
            .expect("structured JSON")
            .chars()
            .count()
            < 10_000
    );
    assert_eq!(result.details["patchTruncated"], true);
}
