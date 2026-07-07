# Android Keepalive

The Android keepalive plugin lives in `crates/tauri-plugin-keepalive`.

Responsibilities:

- Start and stop a `ForegroundService`.
- Maintain a WebSocket to the Echoo server.
- Show normal message notifications when background messages arrive.
- Send ACK events to the server.

Non-responsibilities:

- Do not write message records.
- Do not write settings.
- Do not update read state.
- Do not connect directly to external provider APIs.
- Do not decide which agent conversation an external interface is bound to.
