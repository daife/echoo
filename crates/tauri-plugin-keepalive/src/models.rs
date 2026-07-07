use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KeepAliveStatus {
    Running,
    Stopped,
    Unsupported,
}
