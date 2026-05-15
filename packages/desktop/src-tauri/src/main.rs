// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::{env, path::Path};

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const APP_WINDOW_TITLE: &str = "opencode — AI 个人助手";

#[derive(Clone)]
struct AppState {
    quitting: Arc<AtomicBool>,
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
        let name = wide("Global\\opencode-ai-personal-assistant");
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
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;
    TrayIconBuilder::with_id("main-tray")
        .icon(fallback_tray_icon())
        .tooltip(APP_WINDOW_TITLE)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
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
fn set_window_size(window: tauri::WebviewWindow, request: WindowSizeRequest) -> Result<(), String> {
    let monitor_size = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .map(|monitor| monitor.size().to_logical::<f64>(monitor.scale_factor()));

    let width = match (request.width, request.width_ratio, monitor_size.as_ref()) {
        (Some(width), _, _) => width,
        (_, Some(ratio), Some(size)) => size.width * ratio,
        _ => 900.0,
    };
    let height = match (request.height, request.height_ratio, monitor_size.as_ref()) {
        (Some(height), _, _) => height,
        (_, Some(ratio), Some(size)) => size.height * ratio,
        _ => 620.0,
    };

    let width = clamp(width, request.min_width, request.max_width);
    let height = clamp(height, request.min_height, request.max_height);

    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|error| error.to_string())?;

    if request.center.unwrap_or(true) {
        window.center().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn main() {
    console_control::ignore_interrupts();

    if !single_instance::acquire_or_focus_existing(APP_WINDOW_TITLE) {
        return;
    }

    tauri::Builder::default()
        .manage(AppState {
            quitting: Arc::new(AtomicBool::new(false)),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![set_window_size])
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
