# Echoo Architecture Overview

Echoo uses a monorepo with one shared client entry and isolated platform runtimes.

```text
client UI and features
  -> services
  -> runtime contracts, api-client, domain
  -> web runtime, tauri runtime, server API
  -> browser APIs, Tauri commands, Rust tasks, Kotlin service
```

Echoo is not a provider-source inbox. The client sees figure sessions. Provider details stay inside the server connector and binding layer.

```text
external interface
  -> bound figure session
  -> model reply
  -> Echoo clients and bound external interface
```

The Android native service is intentionally not a second business system. It maintains background connectivity, shows notifications, and ACKs server messages. Message records and read state are synchronized by the frontend business layer when the app opens or resumes.

## Persistence and execution

MySQL is the only durable source of truth. The schema intentionally keeps six business tables: `users`, `auth_tokens`, `resources`, `agents`, `conversations`, and `messages`. Figure definitions and runtime state are JSON documents on `agents`; prime-figure messages use the canonical `messages` row and its `run_metadata` instead of a duplicate timeline table.

Redis owns transient coordination only: agent-run streams, per-conversation execution locks, coalescing flags, and cross-instance realtime events. A request persists the user message and pending assistant message before enqueueing work. Workers may run on any server instance; MySQL remains authoritative after restarts.

All calendar operations use `Asia/Shanghai`. Timezone is not persisted and is not included in the LLM contract.
