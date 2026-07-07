use crate::models::KeepAliveStatus;

#[tauri::command]
pub async fn start() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn stop() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn status() -> Result<KeepAliveStatus, String> {
    Ok(KeepAliveStatus::Unsupported)
}
