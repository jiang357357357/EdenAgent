use crate::{CommandAck, ObserverHandle, PROTOCOL_VERSION};
use serde::Serialize;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::fs;
use uuid::Uuid;

const DEFAULT_CONSOLE_VIRTUAL_KEY: u16 = 0xC0;

#[derive(Clone, Debug)]
pub struct ControlConfig {
    pub enabled: bool,
    pub command_directory: PathBuf,
    pub console_virtual_key: u16,
    pub ack_timeout: Duration,
    pub focus_delay: Duration,
    pub key_delay: Duration,
}

impl ControlConfig {
    #[must_use]
    pub fn from_settings(settings: &Value, log_path: &Path) -> Self {
        let enabled = settings
            .get("controlEnabled")
            .and_then(Value::as_bool)
            .or_else(|| {
                std::env::var("MON_VICTORIA3_CONTROL_ENABLED")
                    .ok()
                    .and_then(|value| parse_bool(&value))
            })
            .unwrap_or(false);
        let command_directory = settings
            .get("commandDirectory")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("MON_VICTORIA3_COMMAND_DIRECTORY").map(PathBuf::from))
            .unwrap_or_else(|| default_command_directory(log_path));
        let console_virtual_key = settings
            .get("consoleVirtualKey")
            .and_then(Value::as_u64)
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value > 0 && *value <= u16::from(u8::MAX))
            .unwrap_or(DEFAULT_CONSOLE_VIRTUAL_KEY);
        Self {
            enabled,
            command_directory,
            console_virtual_key,
            ack_timeout: setting_duration(settings, "ackTimeoutMs", 10_000, 1_000, 30_000),
            focus_delay: setting_duration(settings, "focusDelayMs", 350, 100, 2_000),
            key_delay: setting_duration(settings, "keyDelayMs", 8, 1, 100),
        }
    }
}

#[derive(Clone)]
pub struct Controller {
    config: ControlConfig,
    observer: ObserverHandle,
}

impl Controller {
    #[must_use]
    pub fn new(config: ControlConfig, observer: ObserverHandle) -> Self {
        Self { config, observer }
    }

    pub async fn probe(&self) -> Result<ControlProbeResult, String> {
        if !self.config.enabled {
            return Err(
                "Victoria 3 control is disabled; set connector setting controlEnabled=true"
                    .to_owned(),
            );
        }
        let observer_state = self.observer.state().await;
        if !observer_state.attached {
            return Err("Victoria 3 log observer is not attached".to_owned());
        }
        if !observer_state.bridge_seen {
            return Err(
                "Victoria 3 Observer Bridge has not emitted HELLO; enable the mod and wait until the campaign is loaded"
                    .to_owned(),
            );
        }

        let command_id = Uuid::now_v7().to_string();
        let stem = format!("edenagent_{}", command_id.replace('-', ""));
        let command_path = self.config.command_directory.join(format!("{stem}.txt"));
        write_command_file(&command_path, &render_probe_effect(&command_id)).await?;

        let injection = ConsoleInjection {
            command_stem: stem,
            console_virtual_key: self.config.console_virtual_key,
            focus_delay: self.config.focus_delay,
            key_delay: self.config.key_delay,
        };
        let injection_result =
            match tokio::task::spawn_blocking(move || inject_console_run(&injection)).await {
                Ok(result) => result,
                Err(error) => Err(format!("Victoria 3 console injector task failed: {error}")),
            };
        if let Err(error) = injection_result {
            let _ = fs::remove_file(&command_path).await;
            return Err(error);
        }

        let ack = self
            .observer
            .wait_for_ack(&command_id, self.config.ack_timeout)
            .await;
        let _ = fs::remove_file(&command_path).await;
        let ack = ack?;
        if ack.status != "success" {
            return Err(format!(
                "Victoria 3 rejected control probe {command_id}: {}",
                ack.status
            ));
        }
        Ok(ControlProbeResult {
            command_id,
            status: ack.status.clone(),
            action: "probe_control".to_owned(),
            acknowledged: true,
            ack,
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlProbeResult {
    pub command_id: String,
    pub status: String,
    pub action: String,
    pub acknowledged: bool,
    pub ack: CommandAck,
}

#[cfg_attr(not(windows), allow(dead_code))]
struct ConsoleInjection {
    command_stem: String,
    console_virtual_key: u16,
    focus_delay: Duration,
    key_delay: Duration,
}

fn render_probe_effect(command_id: &str) -> String {
    format!(
        "debug_log = \"[EDENAGENT]|{PROTOCOL_VERSION}|ACK|command_id={command_id}|status=success|action=probe_control\"\n"
    )
}

async fn write_command_file(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Victoria 3 command path has no parent directory".to_owned())?;
    fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("failed to create Victoria 3 run directory: {error}"))?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, contents)
        .await
        .map_err(|error| format!("failed to write Victoria 3 command file: {error}"))?;
    fs::rename(&temporary, path)
        .await
        .map_err(|error| format!("failed to publish Victoria 3 command file: {error}"))
}

fn setting_duration(
    settings: &Value,
    name: &str,
    default_ms: u64,
    minimum_ms: u64,
    maximum_ms: u64,
) -> Duration {
    Duration::from_millis(
        settings
            .get(name)
            .and_then(Value::as_u64)
            .unwrap_or(default_ms)
            .clamp(minimum_ms, maximum_ms),
    )
}

fn default_command_directory(log_path: &Path) -> PathBuf {
    log_path.parent().and_then(Path::parent).map_or_else(
        || PathBuf::from("Victoria 3").join("run"),
        |root| root.join("run"),
    )
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn inject_console_run(injection: &ConsoleInjection) -> Result<(), String> {
    windows::inject_console_run(injection)
}

#[cfg(not(target_os = "windows"))]
fn inject_console_run(_injection: &ConsoleInjection) -> Result<(), String> {
    Err("Victoria 3 console control probe is currently supported only on Windows".to_owned())
}

#[cfg(target_os = "windows")]
mod windows {
    use super::ConsoleInjection;
    use std::{mem::size_of, ptr, thread};
    use windows_sys::{
        Win32::{
            Foundation::{CloseHandle, HWND, LPARAM},
            System::Threading::{
                AttachThreadInput, GetCurrentThreadId, OpenProcess,
                PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
            },
            UI::{
                Input::KeyboardAndMouse::{
                    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
                    SendInput, VK_RETURN,
                },
                WindowsAndMessaging::{
                    BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowThreadProcessId,
                    IsIconic, IsWindowVisible, SW_RESTORE, SetForegroundWindow, ShowWindow,
                },
            },
        },
        core::BOOL,
    };

    struct WindowSearch {
        hwnd: HWND,
    }

    pub(super) fn inject_console_run(injection: &ConsoleInjection) -> Result<(), String> {
        let hwnd = find_game_window()?;
        focus_window(hwnd);
        thread::sleep(injection.focus_delay);
        if unsafe { GetForegroundWindow() } != hwnd {
            return Err(
                "Victoria 3 could not be focused; click the game window and retry the probe"
                    .to_owned(),
            );
        }

        tap_virtual_key(injection.console_virtual_key)?;
        thread::sleep(injection.focus_delay);
        type_unicode(
            &format!("run {}", injection.command_stem),
            injection.key_delay,
        )?;
        tap_virtual_key(VK_RETURN)?;
        thread::sleep(injection.focus_delay);
        tap_virtual_key(injection.console_virtual_key)
    }

    fn focus_window(hwnd: HWND) {
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }

            let current_thread = GetCurrentThreadId();
            let foreground = GetForegroundWindow();
            let foreground_thread = if foreground.is_null() {
                0
            } else {
                GetWindowThreadProcessId(foreground, ptr::null_mut())
            };
            let target_thread = GetWindowThreadProcessId(hwnd, ptr::null_mut());

            let attached_foreground = foreground_thread != 0
                && foreground_thread != current_thread
                && AttachThreadInput(current_thread, foreground_thread, 1) != 0;
            let attached_target = target_thread != 0
                && target_thread != current_thread
                && target_thread != foreground_thread
                && AttachThreadInput(current_thread, target_thread, 1) != 0;

            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);

            if attached_target {
                AttachThreadInput(current_thread, target_thread, 0);
            }
            if attached_foreground {
                AttachThreadInput(current_thread, foreground_thread, 0);
            }
        }
    }

    fn find_game_window() -> Result<HWND, String> {
        let mut search = WindowSearch {
            hwnd: ptr::null_mut(),
        };
        unsafe {
            EnumWindows(
                Some(enum_window),
                (&raw mut search).cast::<core::ffi::c_void>() as LPARAM,
            );
        }
        if search.hwnd.is_null() {
            Err("Victoria 3 is not running or has no visible game window".to_owned())
        } else {
            Ok(search.hwnd)
        }
    }

    unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if unsafe { IsWindowVisible(hwnd) } == 0 {
            return 1;
        }
        let mut process_id = 0_u32;
        unsafe { GetWindowThreadProcessId(hwnd, &raw mut process_id) };
        if process_id != 0 && process_name(process_id).as_deref() == Some("victoria3.exe") {
            let search = unsafe { &mut *(lparam as *mut WindowSearch) };
            search.hwnd = hwnd;
            return 0;
        }
        1
    }

    fn process_name(process_id: u32) -> Option<String> {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
        if process.is_null() {
            return None;
        }
        let mut buffer = vec![0_u16; 32_768];
        let mut length = 32_768_u32;
        let succeeded =
            unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &raw mut length) };
        unsafe { CloseHandle(process) };
        if succeeded == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..usize::try_from(length).ok()?]);
        path.rsplit(['\\', '/']).next().map(str::to_ascii_lowercase)
    }

    fn tap_virtual_key(key: u16) -> Result<(), String> {
        send_inputs(&[
            keyboard_input(key, 0, 0),
            keyboard_input(key, 0, KEYEVENTF_KEYUP),
        ])
    }

    fn type_unicode(text: &str, delay: std::time::Duration) -> Result<(), String> {
        for unit in text.encode_utf16() {
            send_inputs(&[
                keyboard_input(0, unit, KEYEVENTF_UNICODE),
                keyboard_input(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
            ])?;
            thread::sleep(delay);
        }
        Ok(())
    }

    fn keyboard_input(virtual_key: u16, scan_code: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: virtual_key,
                    wScan: scan_code,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send_inputs(inputs: &[INPUT]) -> Result<(), String> {
        let count = u32::try_from(inputs.len())
            .map_err(|_| "too many Victoria 3 keyboard inputs".to_owned())?;
        let sent = unsafe {
            SendInput(
                count,
                inputs.as_ptr(),
                i32::try_from(size_of::<INPUT>()).expect("INPUT size fits i32"),
            )
        };
        if sent == count {
            Ok(())
        } else {
            Err(format!(
                "Windows sent {sent}/{count} Victoria 3 keyboard inputs: {}",
                std::io::Error::last_os_error()
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_command_directory_next_to_logs() {
        let log_path =
            Path::new("C:/Users/test/Documents/Paradox Interactive/Victoria 3/logs/debug.log");
        assert_eq!(
            default_command_directory(log_path),
            Path::new("C:/Users/test/Documents/Paradox Interactive/Victoria 3/run")
        );
        let config =
            ControlConfig::from_settings(&serde_json::json!({"controlEnabled": false}), log_path);
        assert!(!config.enabled);
    }

    #[test]
    fn renders_only_the_ack_probe_effect() {
        let effect = render_probe_effect("018f-test");
        assert_eq!(
            effect,
            "debug_log = \"[EDENAGENT]|1|ACK|command_id=018f-test|status=success|action=probe_control\"\n"
        );
        assert!(!effect.contains("add_building"));
        assert!(!effect.contains("set_variable"));
    }
}
