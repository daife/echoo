mod commands;
mod desktop;
#[cfg(target_os = "android")]
mod mobile;
mod models;

pub use commands::{
    handoff, open_notification_settings, prepare_notifications, show_notification, start, status,
    stop,
};

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let builder =
        tauri::plugin::Builder::new("keepalive").invoke_handler(tauri::generate_handler![
            start,
            stop,
            status,
            handoff,
            prepare_notifications,
            show_notification,
            open_notification_settings
        ]);

    #[cfg(target_os = "android")]
    let builder = builder.setup(|app, api| {
        use tauri::Manager;

        app.manage(mobile::init(app, api)?);
        Ok(())
    });

    builder.build()
}
