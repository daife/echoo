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

#[tauri::command]
pub async fn handoff() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "accessToken": "",
        "refreshToken": "",
        "expiresAt": 0,
        "cursor": 0
    }))
}
