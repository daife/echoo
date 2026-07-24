use crate::models::KeepAliveStatus;

#[cfg(target_os = "android")]
use crate::mobile::KeepAlive;
#[cfg(target_os = "android")]
use serde::Serialize;
#[cfg(target_os = "android")]
use tauri::{AppHandle, Runtime, State};

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartArgs {
    access_token: String,
    refresh_token: String,
    ws_url: String,
    api_base_url: String,
    expires_at: i64,
    cursor: i64,
    ensure_service: bool,
    activate_socket: bool,
    resume_only: bool,
}

#[cfg(target_os = "android")]
#[tauri::command(rename_all = "camelCase")]
pub async fn start<R: Runtime>(
    _app: AppHandle<R>,
    keepalive: State<'_, KeepAlive<R>>,
    access_token: String,
    refresh_token: String,
    ws_url: String,
    api_base_url: String,
    expires_at: i64,
    cursor: i64,
    ensure_service: bool,
    activate_socket: bool,
    resume_only: bool,
) -> Result<(), String> {
    keepalive.run(
        "start",
        StartArgs {
            access_token,
            refresh_token,
            ws_url,
            api_base_url,
            expires_at,
            cursor,
            ensure_service,
            activate_socket,
            resume_only,
        },
    )
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn start() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn stop<R: Runtime>(
    _app: AppHandle<R>,
    keepalive: State<'_, KeepAlive<R>>,
) -> Result<(), String> {
    keepalive.run("stop", ())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn stop() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn status<R: Runtime>(
    _app: AppHandle<R>,
    keepalive: State<'_, KeepAlive<R>>,
) -> Result<KeepAliveStatus, String> {
    keepalive.run("status", ())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn status() -> Result<KeepAliveStatus, String> {
    Ok(KeepAliveStatus::Unsupported)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn handoff<R: Runtime>(
    _app: AppHandle<R>,
    keepalive: State<'_, KeepAlive<R>>,
) -> Result<serde_json::Value, String> {
    keepalive.run("handoff", ())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn handoff() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "accessToken": "",
        "refreshToken": "",
        "expiresAt": 0,
        "cursor": 0
    }))
}
