# Runtime Design

Echoo starts with four runtime contracts:

- `AuthRuntime`: access token, refresh token, logout.
- `StorageRuntime`: settings, local messages, sync cursor, offline sync tasks.
- `MessageRuntime`: realtime start, stop, status.
- `NotificationRuntime`: permission and foreground notification display.

Business services depend on contracts only. Platform-specific details live under `apps/client/src/runtimes/web` and `apps/client/src/runtimes/tauri`.

External interface provider details do not enter the chat UI or core agent flow. The client consumes agent conversations and binding status; server connectors resolve which external interface should receive the mirrored model reply.
