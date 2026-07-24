mod commands;
mod desktop;
#[cfg(target_os = "android")]
mod mobile;
mod models;

pub use commands::{handoff, start, status, stop};

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let builder = tauri::plugin::Builder::new("keepalive")
        .invoke_handler(tauri::generate_handler![start, stop, status, handoff]);

    #[cfg(target_os = "android")]
    let builder = builder.setup(|app, api| {
        use tauri::Manager;

        app.manage(mobile::init(app, api)?);
        Ok(())
    });

    builder.build()
}
