import type { RuntimeBundle } from "../factory/RuntimeBundle";
import { WebLinkRuntime } from "../web/WebLinkRuntime";
import { WebStorageRuntime } from "../web/WebStorageRuntime";
import { TauriAuthRuntime } from "./TauriAuthRuntime";
import { TauriMessageRuntime } from "./TauriMessageRuntime";
import { TauriNotificationRuntime } from "./TauriNotificationRuntime";

export function createTauriRuntime(): RuntimeBundle {
  const auth = new TauriAuthRuntime();
  return {
    auth,
    storage: new WebStorageRuntime(),
    // Tauri uses the web URL parser for now; replace this with a native deep-link runtime when app links are wired.
    link: new WebLinkRuntime(),
    message: new TauriMessageRuntime(),
    notification: new TauriNotificationRuntime()
  };
}
