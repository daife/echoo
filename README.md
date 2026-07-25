# Echoo

Echoo is a multi-end figure session app scaffolded as a pnpm monorepo.

The client is figure-session first. External providers are not shown as message sources in the chat UI. Instead, one external interface can be bound to one figure session. After a binding is active, a message sent through that interface enters the bound figure session, and the model reply is delivered both to Echoo clients and back through the bound interface.

The project follows the structure from `reference/推荐项目结构.md`, renamed from the draft name to `echoo`.

## Layout

```text
apps/client                    Web + Tauri shared frontend
apps/client/src/runtimes        Runtime contracts and platform adapters
apps/client/src-tauri           Tauri shell and Android background handoff
apps/server                    API, durable sync, WebSocket, account, and messaging backend
packages/shared                Shared types, protocols, constants
packages/domain                Pure business rules
packages/api-client            Typed API client
packages/ui                    Shared React UI primitives
crates/tauri-plugin-keepalive  Android background realtime and notification plugin
```

## First Run

```bash
pnpm install
pnpm dev:client
pnpm dev:server
```

Environment variables, administrator settings, and user runtime settings are
separated by lifecycle and ownership. See [docs/configuration.md](docs/configuration.md).

For the Ubuntu production deployment of `www.echooo.uk` (Nginx, systemd,
Docker Compose, and Cloudflare R2), see
[docs/production-deployment.md](docs/production-deployment.md).
For a complete and rollback-safe move to another production server, see
[docs/server-migration.md](docs/server-migration.md).

The client uses the Luminous Monochrome design direction from `reference/frontend-refer`.
The Android keepalive plugin owns the connection only while the WebView is in the background. Foreground restoration stops the native socket first and uses the durable cursor stream to fill the handoff window.

## Storage reset

This schema intentionally has no legacy-data compatibility path. To permanently recreate the configured MySQL database and delete only Redis keys under `echoo:*`, run:

```bash
ECHOO_CONFIRM_RECREATE=echoo pnpm db:recreate
```

## External interfaces

Telegram, WeChat, and QQ remain domain contracts only. Their connector, binding, and delivery interfaces and shared types are reserved for future expansion, but no fake binding repository, placeholder connector, webhook, or public channel route is registered at runtime.

## Future binding rule

```text
external interface
  -> binds to exactly one figure session
  -> inbound text is handled by that figure session
  -> model reply is pushed to all Echoo clients
  -> model reply is also sent back through the bound interface
```

The frontend does not label chat messages as coming from Telegram, WeChat, QQ, or native client surfaces. These external channel runtimes are currently disabled.
