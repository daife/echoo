#[tauri::command]
pub async fn storage_status() -> Result<&'static str, String> {
    Ok("ready")
}
