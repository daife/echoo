# Echoo

Echoo is a multi-end agent chat app scaffolded as a pnpm monorepo.

The client is agent-conversation first. External providers are not shown as message sources in the chat UI. Instead, one external interface can be bound to one agent conversation. After a binding is active, a message sent through that interface enters the bound agent conversation, and the model reply is delivered both to Echoo clients and back through the bound interface.

The project follows the structure from `reference/推荐项目结构.md`, renamed from the draft name to `echoo`.

## Layout

```text
apps/client                    Web + Tauri shared frontend
apps/client/src/runtimes        Runtime contracts and platform adapters
apps/client/src-tauri           Tauri shell, Rust commands, desktop realtime
apps/server                    API, WebSocket, account, messaging, and binding backend
packages/shared                Shared types, protocols, constants
packages/domain                Pure business rules
packages/api-client            Typed API client
packages/ui                    Shared React UI primitives
crates/tauri-plugin-keepalive  Android keepalive, notification, ACK plugin
```

## First Run

```bash
pnpm install
pnpm dev:client
pnpm dev:server
```

The client uses the Luminous Monochrome design direction from `reference/frontend-refer`.
The Android keepalive plugin is intentionally separated from frontend storage logic: it should only maintain background connection, show notifications, and ACK server messages.

## Binding Rule

```text
external interface
  -> binds to exactly one agent conversation
  -> inbound text is handled by that agent conversation
  -> model reply is pushed to all Echoo clients
  -> model reply is also sent back through the bound interface
```

The frontend does not label chat messages as coming from Telegram, WeChat, QQ, or native client surfaces. Provider details belong to the server connector layer.
