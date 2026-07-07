# Echoo Architecture Overview

Echoo uses a monorepo with one shared client entry and isolated platform runtimes.

```text
client UI and features
  -> services
  -> runtime contracts, api-client, domain
  -> web runtime, tauri runtime, server API
  -> browser APIs, Tauri commands, Rust tasks, Kotlin service
```

Echoo is not a provider-source inbox. The client sees agent conversations. Provider details stay inside the server connector and binding layer.

```text
external interface
  -> bound agent conversation
  -> model reply
  -> Echoo clients and bound external interface
```

The Android native service is intentionally not a second business system. It maintains background connectivity, shows notifications, and ACKs server messages. Message records and read state are synchronized by the frontend business layer when the app opens or resumes.
