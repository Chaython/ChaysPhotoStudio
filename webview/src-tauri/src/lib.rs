//! Native file-association delivery for the system webview.
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

struct LaunchFiles(Mutex<Vec<PathBuf>>);

fn queue_files(store: &LaunchFiles, paths: impl IntoIterator<Item = PathBuf>) {
    if let Ok(mut queue) = store.0.lock() {
        for path in paths {
            if queue.len() >= 16 { break; }
            if path.is_file() && !queue.contains(&path) { queue.push(path); }
        }
    }
}

#[tauri::command]
fn take_associated_files(state: State<'_, LaunchFiles>) -> Vec<(String, Vec<u8>)> {
    let Ok(mut guard) = state.0.lock() else { return Vec::new() };
    let paths = std::mem::take(&mut *guard);
    drop(guard);
    paths.into_iter().filter_map(|path| {
        let name = path.file_name()?.to_str()?.to_string();
        let metadata = std::fs::metadata(&path).ok()?;
        if !metadata.is_file() || metadata.len() > 100 * 1024 * 1024 { return None; }
        let bytes = std::fs::read(&path).ok()?;
        Some((name, bytes))
    }).collect()
}

// Only the fixed GitHub Sponsors destination is exposed, not an arbitrary URL.
#[tauri::command]
fn open_sponsors_page() -> Result<(), String> {
    const URL: &str = "https://github.com/sponsors/Chaython";
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("rundll32.exe");
        cmd.args(["url.dll,FileProtocolHandler", URL]);
        cmd
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(URL);
        cmd
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = {
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(URL);
        cmd
    };
    command.spawn().map(|_| ()).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch_files = std::env::args_os().skip(1)
        .map(PathBuf::from).filter(|path| path.is_file())
        .take(16).collect::<Vec<_>>();
    let builder = tauri::Builder::default()
        .manage(LaunchFiles(Mutex::new(launch_files)))
        .invoke_handler(tauri::generate_handler![take_associated_files, open_sponsors_page])
        .plugin(tauri_plugin_window_state::Builder::default().build());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        queue_files(&app.state::<LaunchFiles>(), args.into_iter().skip(1).map(PathBuf::from));
        if let Some(window) = app.get_webview_window("main") { let _ = window.set_focus(); }
    }));
    builder.build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                queue_files(&app.state::<LaunchFiles>(), urls.into_iter().filter_map(|u| u.to_file_path().ok()));
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
