//! Chay's Photo Studio — system-webview shell.
//!
//! This crate is intentionally minimal: it opens one window that hosts
//! the Chay's Photo Studio web app (devUrl / frontendDist from
//! tauri.conf.json — override with scripts/webview-config.mjs for
//! release builds). No IPC commands, no plugins: the entire editor
//! runs inside the webview using the browser platform it already
//! targets (WebGL2, File System Access, IndexedDB persistence).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
