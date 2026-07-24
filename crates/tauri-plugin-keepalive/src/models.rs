use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KeepAliveStatus {
    Running,
    Stopped,
    Unsupported,
}
