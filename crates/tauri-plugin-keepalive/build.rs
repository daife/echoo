fn main() {
    tauri_plugin::Builder::new(&["start", "stop", "status", "handoff"])
        .android_path("android")
        .ios_path("ios")
        .build();
}
