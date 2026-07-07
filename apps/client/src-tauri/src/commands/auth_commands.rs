use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

#[derive(Debug, Deserialize)]
pub struct SaveTokensArgs {
    pub tokens: NativeTokens,
}

#[tauri::command]
pub async fn save_tokens_for_native(tokens: NativeTokens) -> Result<(), String> {
    let _ = tokens;
    Ok(())
}
