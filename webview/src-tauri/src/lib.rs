//! Native Tauri shell with opt-in associated-file launch support.
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

struct LaunchFiles(Mutex<Vec<PathBuf>>);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch_files = std::env::args_os().skip(1)
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .take(16)
        .collect::<Vec<_>>();
    tauri::Builder::default()
        .manage(LaunchFiles(Mutex::new(launch_files)))
        .invoke_handler(tauri::generate_handler![take_associated_files])
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
