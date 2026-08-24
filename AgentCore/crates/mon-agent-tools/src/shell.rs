use crate::common::{ensure_not_cancelled, fail, required_string, text_output};
use crate::{NativeToolConfig, ProcessSandbox};
use async_trait::async_trait;
use mon_agent_core::{PermissionRequest, Tool, ToolCall, ToolCallContext, ToolDefinition, ToolFailure, ToolOutput};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::env;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt as _;
use tokio_util::sync::CancellationToken;

const DEFAULT_YIELD_TIME_MS: u64 = 10_000;
const MAX_YIELD_TIME_MS: u64 = 30_000;
const MAX_CAPTURE_CHARS: usize = 1_000_000;
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SandboxedProgramOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

pub struct SandboxedProgramRequest<'a> {
    pub workspace_root: &'a Path,
    pub cwd: &'a Path,
    pub program: &'a str,
    pub arguments: &'a [String],
    pub stdin: &'a [u8],
    pub environment: &'a [(&'a str, &'a str)],
    pub timeout: Duration,
}

/// Run one argv-based program inside the configured process sandbox.
///
/// This is intentionally separate from the interactive shell tools: callers
/// provide an executable and argv directly, stdin is closed after one bounded
/// payload, and cancellation/timeout always drops a kill-on-drop child.
pub async fn run_sandboxed_program(
    sandbox: &ProcessSandbox,
    request: SandboxedProgramRequest<'_>,
    cancellation: &CancellationToken,
) -> Result<SandboxedProgramOutput, ToolFailure> {
    let mut command = sandboxed_program_command(
        sandbox,
        request.workspace_root,
        request.cwd,
        "program",
        Path::new(request.program),
        request.arguments,
    )?;
    command
        .current_dir(request.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (name, value) in request.environment {
        command.env(name, value);
    }
    configure_process_group(&mut command);
    let mut command = tokio::process::Command::from(command);
    command.kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| fail("command_spawn_failed", error.to_string()))?;
    if let Some(mut child_stdin) = child.stdin.take() {
        if let Err(error) = child_stdin.write_all(request.stdin).await
            && error.kind() != ErrorKind::BrokenPipe
        {
            return Err(fail("stdin_write_failed", error.to_string()));
        }
    }
    let wait = child.wait_with_output();
    tokio::pin!(wait);
    let output = tokio::select! {
        _ = cancellation.cancelled() => {
            return Err(fail("command_aborted", "sandboxed program was cancelled"));
        }
        _ = tokio::time::sleep(request.timeout) => {
            return Err(fail("command_timeout", format!("sandboxed program exceeded {} seconds", request.timeout.as_secs())));
        }
        result = &mut wait => result.map_err(|error| fail("command_wait_failed", error.to_string()))?,
    };
    Ok(SandboxedProgramOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code(),
    })
}

#[derive(Default)]
struct CapturedStreams {
    output: String,
    stdout: String,
    stderr: String,
    cursor: usize,
    stdout_cursor: usize,
    stderr_cursor: usize,
    captured_chars: usize,
}

impl CapturedStreams {
    fn append(&mut self, text: &str, stderr: bool) {
        let remaining = MAX_CAPTURE_CHARS.saturating_sub(self.captured_chars);
        if remaining == 0 {
            return;
        }
        let value: String = text.chars().take(remaining).collect();
        self.captured_chars += value.chars().count();
        self.output.push_str(&value);
        if stderr {
            self.stderr.push_str(&value);
        } else {
            self.stdout.push_str(&value);
        }
    }

    fn consume(&mut self) -> StreamSlice {
        let slice = StreamSlice {
            output: self.output[self.cursor..].to_owned(),
            stdout: self.stdout[self.stdout_cursor..].to_owned(),
            stderr: self.stderr[self.stderr_cursor..].to_owned(),
        };
        self.cursor = self.output.len();
        self.stdout_cursor = self.stdout.len();
        self.stderr_cursor = self.stderr.len();
        slice
    }
}

struct StreamSlice {
    output: String,
    stdout: String,
    stderr: String,
}

struct ProcessSession {
    id: String,
    command: String,
    cwd: PathBuf,
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    streams: Arc<Mutex<CapturedStreams>>,
    open_streams: Arc<AtomicUsize>,
    created_at: Instant,
    launcher: &'static str,
}

impl ProcessSession {
    fn start(
        command_text: &str,
        cwd: &Path,
        workspace_root: &Path,
        launcher: ProcessLauncher,
        sandbox: &ProcessSandbox,
    ) -> Result<Arc<Self>, ToolFailure> {
        let (program, arguments) = launcher.command(command_text)?;
        let mut command = sandboxed_command(sandbox, workspace_root, cwd, launcher, &program, &arguments)?;
        command
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_group(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| fail("command_spawn_failed", error.to_string()))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let streams = Arc::new(Mutex::new(CapturedStreams::default()));
        let open_streams = Arc::new(AtomicUsize::new(0));
        if let Some(stdout) = stdout {
            start_reader(stdout, false, streams.clone(), open_streams.clone());
        }
        if let Some(stderr) = stderr {
            start_reader(stderr, true, streams.clone(), open_streams.clone());
        }
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let sequence = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
        Ok(Arc::new(Self {
            id: format!("proc_{epoch:x}{sequence:x}"),
            command: command_text.to_owned(),
            cwd: cwd.to_path_buf(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            streams,
            open_streams,
            created_at: Instant::now(),
            launcher: launcher.name(),
        }))
    }

    fn exit_code(&self) -> Option<i32> {
        self.child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .try_wait()
            .ok()
            .flatten()
            .and_then(|status| status.code())
    }

    fn complete(&self) -> bool {
        self.exit_code().is_some() && self.open_streams.load(Ordering::Acquire) == 0
    }

    fn phase(&self) -> &'static str {
        if self.exit_code().is_none() {
            "foreground"
        } else if self.open_streams.load(Ordering::Acquire) == 0 {
            "completed"
        } else {
            "background"
        }
    }

    fn can_write(&self) -> bool {
        self.exit_code().is_none()
            && self
                .stdin
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .is_some()
    }

    fn write(&self, chars: &str) -> Result<(), ToolFailure> {
        let mut stdin = self.stdin.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(stdin) = stdin.as_mut() else {
            return Err(fail("stdin_closed", "Process stdin is no longer available"));
        };
        stdin
            .write_all(chars.as_bytes())
            .and_then(|()| stdin.flush())
            .map_err(|error| fail("stdin_write_failed", error.to_string()))
    }

    fn terminate(&self) {
        self.stdin
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        let pid = self.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).id();
        terminate_process_group(pid);
        let mut child = self.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.kill();
        }
    }

    fn consume(&self) -> StreamSlice {
        self.streams
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .consume()
    }

    fn details(&self, streams: &StreamSlice) -> Value {
        let running = !self.complete();
        let launcher_exit_code = self.exit_code();
        let captured = self
            .streams
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .captured_chars;
        json!({
            "command": self.command,
            "launcher": self.launcher,
            "cwd": self.cwd.to_string_lossy(),
            "session_id": self.id,
            "status": if running { "running" } else { "completed" },
            "phase": self.phase(),
            "exit_code": if running { None } else { launcher_exit_code },
            "launcher_exit_code": launcher_exit_code,
            "can_write": self.can_write(),
            "can_terminate": running,
            "poll_after_ms": if running { Some(1_000) } else { None },
            "stdout": streams.stdout,
            "stderr": streams.stderr,
            "duration_ms": self.created_at.elapsed().as_millis(),
            "truncated": captured >= MAX_CAPTURE_CHARS,
            "captured_chars": captured,
        })
    }

    fn result(&self, streams: StreamSlice) -> ToolOutput {
        let phase = self.phase();
        let exit_code = self.exit_code();
        let text = if phase == "foreground" {
            let suffix = format!(
                "Process still running with session ID {}. Use write_stdin to poll output, send input, or terminate it.",
                self.id
            );
            if streams.output.is_empty() {
                suffix
            } else {
                format!("{}\n\n{suffix}", streams.output.trim_end())
            }
        } else if phase == "background" {
            let suffix = format!(
                "Launcher exited with code {}, but background descendants or inherited output streams are still active under session ID {}. Use write_stdin to poll output or terminate the process group; do not start the same task again.",
                exit_code.unwrap_or_default(),
                self.id
            );
            if streams.output.is_empty() {
                suffix
            } else {
                format!("{}\n\n{suffix}", streams.output.trim_end())
            }
        } else if streams.output.is_empty() {
            "(no output)".to_owned()
        } else {
            streams.output.clone()
        };
        let details = self.details(&streams);
        text_output(text, Some(details))
    }
}

#[derive(Clone, Copy)]
enum ProcessLauncher {
    Bash,
    PowerShell,
}

impl ProcessLauncher {
    fn name(self) -> &'static str {
        match self {
            Self::Bash => "bash",
            Self::PowerShell => "powershell",
        }
    }

    fn command(self, command_text: &str) -> Result<(PathBuf, Vec<String>), ToolFailure> {
        match self {
            Self::Bash => Ok((resolve_bash()?, vec!["-lc".to_owned(), command_text.to_owned()])),
            Self::PowerShell => Ok((
                resolve_powershell()?,
                vec![
                    "-NoLogo".to_owned(),
                    "-NoProfile".to_owned(),
                    "-NonInteractive".to_owned(),
                    "-Command".to_owned(),
                    powershell_script(command_text),
                ],
            )),
        }
    }
}

fn sandboxed_command(
    sandbox: &ProcessSandbox,
    workspace_root: &Path,
    cwd: &Path,
    launcher: ProcessLauncher,
    program: &Path,
    arguments: &[String],
) -> Result<Command, ToolFailure> {
    sandboxed_program_command(sandbox, workspace_root, cwd, launcher.name(), program, arguments)
}

pub fn sandboxed_program_command(
    sandbox: &ProcessSandbox,
    workspace_root: &Path,
    cwd: &Path,
    launcher: &str,
    program: &Path,
    arguments: &[String],
) -> Result<Command, ToolFailure> {
    match sandbox {
        ProcessSandbox::Disabled => Err(fail(
            "sandbox_unavailable",
            "Command execution is disabled because no OS sandbox is configured",
        )),
        ProcessSandbox::Bubblewrap(executable) => {
            let workspace = workspace_root
                .canonicalize()
                .map_err(|error| fail("sandbox_workspace", error.to_string()))?;
            let cwd = cwd
                .canonicalize()
                .map_err(|error| fail("sandbox_cwd", error.to_string()))?;
            if !cwd.starts_with(&workspace) {
                return Err(fail("sandbox_cwd", "command cwd is outside the workspace"));
            }
            let mut command = Command::new(executable);
            command
                .args(["--die-with-parent", "--new-session", "--unshare-all"])
                .args(["--ro-bind", "/", "/"])
                .arg("--bind")
                .arg(&workspace)
                .arg(&workspace)
                .args(["--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev"])
                .arg("--chdir")
                .arg(cwd)
                .arg("--")
                .arg(program)
                .args(arguments);
            Ok(command)
        }
        ProcessSandbox::External(executable) => {
            let mut command = Command::new(executable);
            command
                .arg("--workspace")
                .arg(workspace_root)
                .arg("--cwd")
                .arg(cwd)
                .arg("--launcher")
                .arg(launcher)
                .arg("--")
                .arg(program)
                .args(arguments);
            Ok(command)
        }
        ProcessSandbox::Direct => {
            let mut command = Command::new(program);
            command.args(arguments);
            Ok(command)
        }
    }
}

fn powershell_script(command_text: &str) -> String {
    // Windows PowerShell 5.1 otherwise writes redirected text using the active
    // legacy code page. Normalize both PowerShell and native child output so
    // the runtime's UTF-8 stream decoder receives a deterministic encoding.
    format!(
        "$__monUtf8 = [System.Text.UTF8Encoding]::new($false); \
[Console]::InputEncoding = $__monUtf8; \
[Console]::OutputEncoding = $__monUtf8; \
$OutputEncoding = $__monUtf8;\n{command_text}"
    )
}

fn start_reader(
    mut stream: impl Read + Send + 'static,
    stderr: bool,
    captured: Arc<Mutex<CapturedStreams>>,
    open_streams: Arc<AtomicUsize>,
) {
    open_streams.fetch_add(1, Ordering::Release);
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut pending = Vec::new();
        loop {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    pending.extend_from_slice(&buffer[..read]);
                    decode_available(&mut pending, &captured, stderr, false);
                }
            }
        }
        decode_available(&mut pending, &captured, stderr, true);
        open_streams.fetch_sub(1, Ordering::Release);
    });
}

fn decode_available(pending: &mut Vec<u8>, captured: &Mutex<CapturedStreams>, stderr: bool, final_chunk: bool) {
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                captured
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .append(text, stderr);
                pending.clear();
                return;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    let text = std::str::from_utf8(&pending[..valid]).expect("validated UTF-8 prefix");
                    captured
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .append(text, stderr);
                    pending.drain(..valid);
                }
                match error.error_len() {
                    Some(length) => {
                        captured
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .append("\u{fffd}", stderr);
                        pending.drain(..length.min(pending.len()));
                    }
                    None if final_chunk => {
                        let text = String::from_utf8_lossy(pending);
                        captured
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .append(&text, stderr);
                        pending.clear();
                        return;
                    }
                    None => return,
                }
            }
        }
    }
}

fn resolve_bash() -> Result<PathBuf, ToolFailure> {
    if let Some(configured) = env::var_os("MON_AGENT_SHELL").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(&configured);
        if path.is_file() {
            return Ok(path);
        }
        if let Some(found) = find_in_path(Path::new(&configured)) {
            return Ok(found);
        }
    }
    if let Some(found) = find_in_path(Path::new(if cfg!(windows) { "bash.exe" } else { "bash" })) {
        return Ok(found);
    }
    #[cfg(not(windows))]
    let candidates = vec![PathBuf::from("/bin/bash")];
    #[cfg(windows)]
    let mut candidates = vec![PathBuf::from("/bin/bash")];
    #[cfg(windows)]
    {
        if let Some(program_files) = env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("Git/bin/bash.exe"));
            candidates
                .push(PathBuf::from(env::var_os("ProgramFiles").unwrap_or_default()).join("Git/usr/bin/bash.exe"));
        }
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("Programs/Git/bin/bash.exe"));
        }
    }
    candidates.into_iter().find(|path| path.is_file()).ok_or_else(|| {
        fail(
            "bash_unavailable",
            "Bash is unavailable. Install Bash or set MON_AGENT_SHELL to its executable path.",
        )
    })
}

fn resolve_powershell() -> Result<PathBuf, ToolFailure> {
    if let Some(configured) = env::var_os("MON_AGENT_POWERSHELL").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(&configured);
        if path.is_file() {
            return Ok(path);
        }
        if let Some(found) = find_in_path(Path::new(&configured)) {
            return Ok(found);
        }
    }
    for name in if cfg!(windows) {
        ["pwsh.exe", "powershell.exe"]
    } else {
        ["pwsh", "powershell"]
    } {
        if let Some(found) = find_in_path(Path::new(name)) {
            return Ok(found);
        }
    }
    #[cfg(windows)]
    if let Some(system_root) = env::var_os("SystemRoot") {
        let candidate = PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(fail(
        "powershell_unavailable",
        "PowerShell is unavailable. Install PowerShell or set MON_AGENT_POWERSHELL to its executable path.",
    ))
}

fn find_in_path(name: &Path) -> Option<PathBuf> {
    env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| env::split_paths(&paths).collect::<Vec<_>>())
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
}

#[cfg(unix)]
fn terminate_process_group(pid: u32) {
    #[allow(unsafe_code)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
}

#[cfg(windows)]
fn terminate_process_group(pid: u32) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

struct ProcessRegistryInner {
    sessions: Mutex<HashMap<String, Arc<ProcessSession>>>,
}

impl Drop for ProcessRegistryInner {
    fn drop(&mut self) {
        let sessions = self.sessions.get_mut().unwrap_or_else(|poisoned| poisoned.into_inner());
        for session in sessions.values() {
            session.terminate();
        }
    }
}

#[derive(Clone)]
pub(crate) struct ProcessRegistry(Arc<ProcessRegistryInner>);

impl ProcessRegistry {
    pub(crate) fn new() -> Self {
        Self(Arc::new(ProcessRegistryInner {
            sessions: Mutex::new(HashMap::new()),
        }))
    }

    fn start(
        &self,
        command: &str,
        cwd: &Path,
        workspace_root: &Path,
        launcher: ProcessLauncher,
        sandbox: &ProcessSandbox,
    ) -> Result<Arc<ProcessSession>, ToolFailure> {
        let session = ProcessSession::start(command, cwd, workspace_root, launcher, sandbox)?;
        self.0
            .sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(session.id.clone(), session.clone());
        Ok(session)
    }

    fn get(&self, id: &str) -> Result<Arc<ProcessSession>, ToolFailure> {
        self.0
            .sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(id)
            .cloned()
            .ok_or_else(|| fail("process_not_found", format!("Process session not found: {id}")))
    }

    fn discard_if_complete(&self, session: &ProcessSession) {
        if session.complete() {
            session
                .stdin
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
            self.0
                .sessions
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&session.id);
        }
    }

    pub(crate) fn active_count(&self) -> usize {
        let mut sessions = self.0.sessions.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        sessions.retain(|_, session| !session.complete());
        sessions.len()
    }
}

async fn wait_for_session(
    session: &ProcessSession,
    milliseconds: u64,
    cancellation: &tokio_util::sync::CancellationToken,
) -> bool {
    let deadline = Instant::now() + Duration::from_millis(milliseconds);
    while !session.complete() && Instant::now() < deadline {
        if cancellation.is_cancelled() {
            session.terminate();
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

fn requested_yield(arguments: &Value, default: u64) -> u64 {
    arguments
        .get("yield_time_ms")
        .and_then(Value::as_u64)
        .unwrap_or(default)
        .min(MAX_YIELD_TIME_MS)
}

pub struct BashTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl BashTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for BashTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    fn permission_request(&self, arguments: &Value) -> Option<PermissionRequest> {
        let command = arguments.get("command").and_then(Value::as_str).unwrap_or("<unknown>");
        Some(PermissionRequest {
            permission: "shell.execute".to_owned(),
            patterns: vec![command.to_owned()],
            always: vec![command.to_owned()],
        })
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let command = required_string(&call.arguments, "command")?;
        execute_process_tool(&self.config, command, &call.arguments, &context, ProcessLauncher::Bash).await
    }
}

pub struct PowerShellTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl PowerShellTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for PowerShellTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    fn permission_request(&self, arguments: &Value) -> Option<PermissionRequest> {
        let command = arguments.get("command").and_then(Value::as_str).unwrap_or("<unknown>");
        Some(PermissionRequest {
            permission: "shell.execute".to_owned(),
            patterns: vec![command.to_owned()],
            always: vec![command.to_owned()],
        })
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let command = required_string(&call.arguments, "command")?;
        execute_process_tool(
            &self.config,
            command,
            &call.arguments,
            &context,
            ProcessLauncher::PowerShell,
        )
        .await
    }
}

async fn execute_process_tool(
    config: &NativeToolConfig,
    command: &str,
    arguments: &Value,
    context: &ToolCallContext,
    launcher: ProcessLauncher,
) -> Result<ToolOutput, ToolFailure> {
    let session = config.process_registry.start(
        command,
        config.workspace_root(),
        config.workspace_root(),
        launcher,
        config.process_sandbox(),
    )?;
    let aborted = wait_for_session(
        &session,
        requested_yield(arguments, DEFAULT_YIELD_TIME_MS),
        &context.cancellation,
    )
    .await;
    let streams = session.consume();
    if aborted {
        let _ = wait_for_session(&session, 1_000, &tokio_util::sync::CancellationToken::new()).await;
        let details = session.details(&streams);
        config.process_registry.discard_if_complete(&session);
        return Err(fail(
            "command_aborted",
            format!("{}\n\nCommand aborted", streams.output.trim_end())
                .trim()
                .to_owned(),
        )
        .with_details(details));
    }
    if session.complete() && session.exit_code().is_some_and(|code| code != 0) {
        let exit_code = session.exit_code().unwrap_or_default();
        let details = session.details(&streams);
        config.process_registry.discard_if_complete(&session);
        return Err(fail(
            "command_failed",
            format!(
                "{}\n\nCommand exited with code {exit_code}",
                if streams.output.is_empty() {
                    "(no output)"
                } else {
                    &streams.output
                }
            ),
        )
        .with_details(details));
    }
    let result = session.result(streams);
    config.process_registry.discard_if_complete(&session);
    Ok(result)
}

pub struct WriteStdinTool {
    definition: ToolDefinition,
    config: NativeToolConfig,
}

impl WriteStdinTool {
    pub fn new(definition: ToolDefinition, config: NativeToolConfig) -> Self {
        Self { definition, config }
    }
}

#[async_trait]
impl Tool for WriteStdinTool {
    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    fn permission_request(&self, arguments: &Value) -> Option<PermissionRequest> {
        let session = arguments
            .get("session_id")
            .and_then(Value::as_str)
            .unwrap_or("<unknown>");
        Some(PermissionRequest {
            permission: "shell.interact".to_owned(),
            patterns: vec![session.to_owned()],
            always: Vec::new(),
        })
    }

    async fn execute(&self, call: &ToolCall, context: ToolCallContext) -> Result<ToolOutput, ToolFailure> {
        ensure_not_cancelled(&context.cancellation)?;
        let id = required_string(&call.arguments, "session_id")?;
        let session = self.config.process_registry.get(id)?;
        let terminated = call
            .arguments
            .get("terminate")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if terminated {
            session.terminate();
        } else if let Some(chars) = call
            .arguments
            .get("chars")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            session.write(chars)?;
        }
        wait_for_session(&session, requested_yield(&call.arguments, 1_000), &context.cancellation).await;
        let streams = session.consume();
        if session.complete() && session.exit_code().is_some_and(|code| code != 0) && !terminated {
            let exit_code = session.exit_code().unwrap_or_default();
            let details = session.details(&streams);
            self.config.process_registry.discard_if_complete(&session);
            return Err(fail(
                "command_failed",
                format!(
                    "{}\n\nCommand exited with code {exit_code}",
                    if streams.output.is_empty() {
                        "(no output)"
                    } else {
                        &streams.output
                    }
                ),
            )
            .with_details(details));
        }
        let result = session.result(streams);
        self.config.process_registry.discard_if_complete(&session);
        Ok(result)
    }
}
