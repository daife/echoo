mod commands;
mod desktop;
mod mobile;
mod models;

pub use commands::{start, status, stop};

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("keepalive")
        .invoke_handler(tauri::generate_handler![start, stop, status])
        .build()
}
