// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

use tauri::{
    Emitter,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent, Wry,
    window::Color,
};

const APP_WINDOW_TITLE: &str = "MonAgent — AI 个人助手";
const DEFAULT_CORE_HOST: &str = "127.0.0.1";
const DEFAULT_CORE_PORT: u16 = 40011;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreLoginRequest {
    username: String,
    password: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CoreAuthUser {
    id: i64,
    username: String,
    ws_session_id: Option<String>,
    is_staff: bool,
    is_superuser: bool,
    date_joined: Option<String>,
    last_login: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CoreLoginResponse {
    message: String,
    user: CoreAuthUser,
    token: String,
    expires_at: String,
    expires_in: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CoreTokenInfo {
    valid: bool,
    user: String,
    created_at: String,
    expires_at: String,
    remaining_hours: f64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CoreVerifyTokenResponse {
    valid: bool,
    user: CoreAuthUser,
    token_info: Option<CoreTokenInfo>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CoreSimpleMessage {
    message: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DevAccount {
    username: String,
    password: String,
}

#[derive(serde::Deserialize)]
struct CoreErrorResponse {
    error: Option<String>,
    message: Option<String>,
}

#[derive(Clone)]
struct AppState {
    quitting: Arc<AtomicBool>,
    character_mode: Arc<AtomicBool>,
    toggle_view_mode: Arc<Mutex<Option<MenuItem<Wry>>>>,
}

fn has_quit_flag() -> bool {
    env::var("OPENCODE_DESKTOP_QUIT_FLAG")
        .ok()
        .is_some_and(|path| Path::new(&path).exists())
}

#[cfg(target_os = "windows")]
mod console_control {
    const CTRL_C_EVENT: u32 = 0;
    const CTRL_BREAK_EVENT: u32 = 1;

    #[link(name = "kernel32")]
    extern "system" {
        fn SetConsoleCtrlHandler(handler: Option<unsafe extern "system" fn(u32) -> i32>, add: i32) -> i32;
    }

    unsafe extern "system" fn handler(control_type: u32) -> i32 {
        match control_type {
            CTRL_C_EVENT | CTRL_BREAK_EVENT => 1,
            _ => 0,
        }
    }

    pub fn ignore_interrupts() {
        unsafe {
            SetConsoleCtrlHandler(Some(handler), 1);
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod console_control {
    pub fn ignore_interrupts() {}
}

#[cfg(target_os = "windows")]
mod single_instance {
    use std::{ffi::c_void, ptr};

    type Handle = *mut c_void;
    type Hwnd = *mut c_void;

    const ERROR_ALREADY_EXISTS: u32 = 183;
    const SW_RESTORE: i32 = 9;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attributes: *mut c_void, initial_owner: i32, name: *const u16) -> Handle;
        fn GetLastError() -> u32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(class_name: *const u16, window_name: *const u16) -> Hwnd;
        fn ShowWindow(window: Hwnd, command: i32) -> i32;
        fn SetForegroundWindow(window: Hwnd) -> i32;
    }

    fn wide(input: &str) -> Vec<u16> {
        input.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn acquire_or_focus_existing(title: &str) -> bool {
        let name = wide("Global\\monagent-ai-personal-assistant");
        let mutex = unsafe { CreateMutexW(ptr::null_mut(), 0, name.as_ptr()) };
        if mutex.is_null() {
            return true;
        }

        let already_running = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        if already_running {
            let title = wide(title);
            let window = unsafe { FindWindowW(ptr::null(), title.as_ptr()) };
            if !window.is_null() {
                unsafe {
                    ShowWindow(window, SW_RESTORE);
                    SetForegroundWindow(window);
                }
            }
            return false;
        }

        true
    }
}

#[cfg(not(target_os = "windows"))]
mod single_instance {
    pub fn acquire_or_focus_existing(_title: &str) -> bool {
        true
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowSizeRequest {
    width: Option<f64>,
    height: Option<f64>,
    aspect_ratio: Option<f64>,
    width_ratio: Option<f64>,
    height_ratio: Option<f64>,
    min_width: Option<f64>,
    min_height: Option<f64>,
    max_width: Option<f64>,
    max_height: Option<f64>,
    center: Option<bool>,
}

fn clamp(value: f64, min: Option<f64>, max: Option<f64>) -> f64 {
    let with_min = min.map_or(value, |min| value.max(min));
    max.map_or(with_min, |max| with_min.min(max))
}

fn parse_monconfig_value(contents: &str, target_section: &str, target_key: &str) -> Option<String> {
    let mut section = String::from("default");

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].trim().to_ascii_lowercase();
            continue;
        }

        let Some(equals_index) = line.find('=') else {
            continue;
        };

        let key = line[..equals_index].trim().to_ascii_uppercase();
        let value = line[equals_index + 1..].trim();

        if section == target_section && key == target_key {
            return Some(value.to_string());
        }
    }

    None
}

fn find_mon_root_from(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start);
    while let Some(path) = current {
        let backend_server = path.join("Backend").join("Server").join(".monconfig");
        if backend_server.exists() {
            return Some(path.to_path_buf());
        }
        current = path.parent();
    }
    None
}

fn find_mon_root() -> Option<PathBuf> {
    let current_dir = env::current_dir().ok();
    let exe_dir = env::current_exe().ok().and_then(|path| path.parent().map(Path::to_path_buf));

    current_dir
        .as_deref()
        .and_then(find_mon_root_from)
        .or_else(|| exe_dir.as_deref().and_then(find_mon_root_from))
}

fn find_agent_monconfig() -> Option<PathBuf> {
    let root = find_mon_root()?;
    let path = root.join("Agent").join(".monconfig");
    if path.exists() { Some(path) } else { None }
}

fn resolve_core_base_url() -> Result<String, String> {
    if let Ok(explicit) = env::var("MONCORE_CORE_BASE_URL") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.trim_end_matches('/').to_string());
        }
    }

    let root = find_mon_root().ok_or_else(|| {
        "未找到 Mon 工作区根目录，无法定位 Backend/Server/.monconfig".to_string()
    })?;
    let config_path = root.join("Backend").join("Server").join(".monconfig");
    let contents = fs::read_to_string(&config_path)
        .map_err(|error| format!("读取 MonCore 配置失败: {} ({})", config_path.display(), error))?;

    let host = parse_monconfig_value(&contents, "server", "HOST")
        .unwrap_or_else(|| DEFAULT_CORE_HOST.to_string());
    let port = parse_monconfig_value(&contents, "server", "PORT")
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_CORE_PORT);

    let normalized_host = match host.as_str() {
        "0.0.0.0" | "::" => DEFAULT_CORE_HOST,
        _ => host.as_str(),
    };

    Ok(format!("http://{}:{}", normalized_host, port))
}

async fn parse_error(response: reqwest::Response) -> String {
    let status = response.status();
    match response.json::<CoreErrorResponse>().await {
        Ok(body) => body
            .error
            .or(body.message)
            .unwrap_or_else(|| format!("{} {}", status.as_u16(), status.canonical_reason().unwrap_or("Request Failed"))),
        Err(_) => format!("{} {}", status.as_u16(), status.canonical_reason().unwrap_or("Request Failed")),
    }
}

async fn core_client() -> Result<(reqwest::Client, String), String> {
    let base_url = resolve_core_base_url()?;
    Ok((reqwest::Client::new(), base_url))
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn set_view_mode(app: &tauri::AppHandle, mode: &str) {
    show_main_window(app);
    let _ = app.emit("opencode-view-mode", mode);
}

fn update_view_mode_menu(app: &tauri::AppHandle, mode: &str) {
    let item = app
        .state::<AppState>()
        .toggle_view_mode
        .lock()
        .ok()
        .and_then(|item| item.clone());

    if let Some(item) = item {
        let text = if mode == "character" {
            "切换到三栏模式"
        } else {
            "切换到角色模式"
        };
        let _ = item.set_text(text);
    }
}

fn fallback_tray_icon() -> Image<'static> {
    const SIZE: u32 = 32;
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - 15.5;
            let dy = y as f32 - 15.5;
            let distance = (dx * dx + dy * dy).sqrt();
            let inside = distance <= 14.0;
            let ring = (9.5..=12.5).contains(&distance);

            let pixel = if !inside {
                [0, 0, 0, 0]
            } else if ring {
                [255, 148, 28, 255]
            } else {
                [24, 24, 27, 255]
            };
            rgba.extend_from_slice(&pixel);
        }
    }

    Image::new_owned(rgba, SIZE, SIZE)
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏到托盘", true, None::<&str>)?;
    let toggle_view_mode = MenuItem::with_id(app, "toggle_view_mode", "切换到角色模式", true, None::<&str>)?;
    let separator_view = PredefinedMenuItem::separator(app)?;
    let separator_quit = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator_view, &toggle_view_mode, &separator_quit, &quit])?;
    if let Ok(mut item) = app.state::<AppState>().toggle_view_mode.lock() {
        *item = Some(toggle_view_mode.clone());
    }

    TrayIconBuilder::with_id("main-tray")
        .icon(fallback_tray_icon())
        .tooltip(APP_WINDOW_TITLE)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
            "toggle_view_mode" => {
                let mode = if app.state::<AppState>().character_mode.load(Ordering::SeqCst) {
                    "chatWithCharacter"
                } else {
                    "character"
                };
                set_view_mode(app, mode);
                app.state::<AppState>().character_mode.store(mode == "character", Ordering::SeqCst);
                update_view_mode_menu(app, mode);
            }
            "quit" => {
                app.state::<AppState>().quitting.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
async fn resolve_core_base_url_command() -> Result<String, String> {
    resolve_core_base_url()
}

#[tauri::command]
fn get_dev_account() -> Result<Option<DevAccount>, String> {
    let config_path = match find_agent_monconfig() {
        Some(path) => path,
        None => return Ok(None),
    };
    let contents = match fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    let username = parse_monconfig_value(&contents, "auth_dev", "USERNAME");
    let password = parse_monconfig_value(&contents, "auth_dev", "PASSWORD");

    match (username, password) {
        (Some(username), Some(password)) => Ok(Some(DevAccount { username, password })),
        _ => Ok(None),
    }
}

#[tauri::command]
async fn core_login(request: CoreLoginRequest) -> Result<CoreLoginResponse, String> {
    let (client, base_url) = core_client().await?;
    let response = client
        .post(format!("{}/api/users/login/", base_url))
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("请求 MonCore 登录接口失败: {error}"))?;

    if !response.status().is_success() {
        return Err(parse_error(response).await);
    }

    response
        .json::<CoreLoginResponse>()
        .await
        .map_err(|error| format!("解析 MonCore 登录响应失败: {error}"))
}

#[tauri::command]
async fn core_verify_token(token: String) -> Result<CoreVerifyTokenResponse, String> {
    let (client, base_url) = core_client().await?;
    let response = client
        .get(format!("{}/api/users/verify-token/", base_url))
        .header("Authorization", format!("Token {}", token))
        .send()
        .await
        .map_err(|error| format!("请求 MonCore token 验证接口失败: {error}"))?;

    if !response.status().is_success() {
        return Err(parse_error(response).await);
    }

    response
        .json::<CoreVerifyTokenResponse>()
        .await
        .map_err(|error| format!("解析 MonCore token 验证响应失败: {error}"))
}

#[tauri::command]
async fn core_logout(token: String) -> Result<CoreSimpleMessage, String> {
    let (client, base_url) = core_client().await?;
    let response = client
        .post(format!("{}/api/users/logout/", base_url))
        .header("Authorization", format!("Token {}", token))
        .send()
        .await
        .map_err(|error| format!("请求 MonCore 登出接口失败: {error}"))?;

    if !response.status().is_success() {
        return Err(parse_error(response).await);
    }

    response
        .json::<CoreSimpleMessage>()
        .await
        .map_err(|error| format!("解析 MonCore 登出响应失败: {error}"))
}

#[tauri::command]
fn set_window_size(window: tauri::WebviewWindow, request: WindowSizeRequest) -> Result<(), String> {
    let monitor_size = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .map(|monitor| monitor.size().to_logical::<f64>(monitor.scale_factor()));

    let mut width = match (request.width, request.width_ratio, monitor_size.as_ref()) {
        (Some(width), _, _) => width,
        (_, Some(ratio), Some(size)) => size.width * ratio,
        _ => 900.0,
    };
    let height = match (request.height, request.height_ratio, monitor_size.as_ref()) {
        (Some(height), _, _) => height,
        (_, Some(ratio), Some(size)) => size.height * ratio,
        _ => 620.0,
    };

    let height = clamp(height, request.min_height, request.max_height);
    if let Some(aspect_ratio) = request.aspect_ratio {
        width = height * aspect_ratio;
    }
    let width = clamp(width, request.min_width, request.max_width);

    if request.min_width.is_some() || request.min_height.is_some() {
        window
            .set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                width: request.min_width.unwrap_or(1.0),
                height: request.min_height.unwrap_or(1.0),
            })))
            .map_err(|error| error.to_string())?;
    }

    if request.max_width.is_some() || request.max_height.is_some() {
        window
            .set_max_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                width: request.max_width.unwrap_or(f64::INFINITY),
                height: request.max_height.unwrap_or(f64::INFINITY),
            })))
            .map_err(|error| error.to_string())?;
    }

    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|error| error.to_string())?;

    if request.center.unwrap_or(true) {
        window.center().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn set_window_appearance(window: tauri::WebviewWindow, mode: String) -> Result<(), String> {
    let character = mode == "character";
    let background = if character {
        Some(Color(0, 0, 0, 0))
    } else {
        Some(Color(245, 245, 244, 255))
    };

    window
        .set_decorations(!character)
        .map_err(|error| error.to_string())?;
    window
        .set_shadow(!character)
        .map_err(|error| error.to_string())?;
    window
        .set_background_color(background)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn set_view_mode_state(app: tauri::AppHandle, mode: String) {
    app.state::<AppState>()
        .character_mode
        .store(mode == "character", Ordering::SeqCst);
    update_view_mode_menu(&app, &mode);
}

#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

fn main() {
    console_control::ignore_interrupts();

    if !single_instance::acquire_or_focus_existing(APP_WINDOW_TITLE) {
        return;
    }

    tauri::Builder::default()
        .manage(AppState {
            quitting: Arc::new(AtomicBool::new(false)),
            character_mode: Arc::new(AtomicBool::new(false)),
            toggle_view_mode: Arc::new(Mutex::new(None)),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            resolve_core_base_url_command,
            get_dev_account,
            core_login,
            core_verify_token,
            core_logout,
            set_window_size,
            set_window_appearance,
            set_view_mode_state,
            start_window_drag
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let is_quitting = window
                    .app_handle()
                    .state::<AppState>()
                    .quitting
                    .load(Ordering::SeqCst)
                    || has_quit_flag();

                if !is_quitting {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            setup_tray(app)?;
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
