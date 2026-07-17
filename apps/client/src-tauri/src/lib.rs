pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_keepalive::init())
        .run(tauri::generate_context!())
        .expect("failed to run Echoo Tauri app");
}
