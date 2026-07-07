#[tauri::command]
pub async fn realtime_status() -> Result<&'static str, String> {
    Ok("unsupported")
}
