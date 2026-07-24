fn main() {
    tauri_plugin::Builder::new(&["start", "stop", "status", "handoff", "background"])
        .android_path("android")
        .ios_path("ios")
        .build();
}
