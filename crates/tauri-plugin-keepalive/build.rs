fn main() {
    tauri_plugin::Builder::new(&[
        "start",
        "stop",
        "status",
        "handoff",
        "prepare_notifications",
        "show_notification",
        "open_notification_settings",
    ])
    .android_path("android")
    .ios_path("ios")
    .build();
}
