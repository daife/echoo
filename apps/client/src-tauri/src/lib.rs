mod commands;
mod plugins;
mod realtime;
mod state;
mod storage;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_keepalive::init())
        .invoke_handler(tauri::generate_handler![commands::auth_commands::save_tokens_for_native])
        .run(tauri::generate_context!())
        .expect("failed to run Echoo Tauri app");
}
