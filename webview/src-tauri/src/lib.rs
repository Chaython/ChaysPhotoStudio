//! Chay's Photo Studio — system-webview shell.
//!
//! This crate is intentionally minimal: it opens one window that hosts
//! the Chay's Photo Studio web app (devUrl / frontendDist from
//! tauri.conf.json — override with scripts/webview-config.mjs for
//! release builds). No custom IPC commands: the editor
//! runs inside the webview using the browser platform it already
//! targets (WebGL2, File System Access, IndexedDB persistence).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Desktop-only automatic persistence: state remains in Tauri's local
        // app-data directory and does not require frontend JS capabilities.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
