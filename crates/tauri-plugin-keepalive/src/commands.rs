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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShowNotificationArgs {
    id: String,
    kind: String,
    title: String,
    body: String,
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

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn prepare_notifications<R: Runtime>(
    _app: AppHandle<R>,
    keepalive: State<'_, KeepAlive<R>>,
) -> Result<(), String> {
    keepalive.run("prepareNotifications", ())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn prepare_notifications() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command(rename_all = "camelCase")]
pub async fn show_notification<R: Runtime>(
    _app: AppHandle<R>,
    keepalive: State<'_, KeepAlive<R>>,
    id: String,
    kind: String,
    title: String,
    body: String,
) -> Result<(), String> {
    keepalive.run(
        "showNotification",
        ShowNotificationArgs {
            id,
            kind,
            title,
            body,
        },
    )
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn show_notification(
    _id: String,
    _kind: String,
    _title: String,
    _body: String,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn open_notification_settings<R: Runtime>(
    _app: AppHandle<R>,
    keepalive: State<'_, KeepAlive<R>>,
) -> Result<(), String> {
    keepalive.run("openNotificationSettings", ())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn open_notification_settings() -> Result<(), String> {
    Ok(())
}
