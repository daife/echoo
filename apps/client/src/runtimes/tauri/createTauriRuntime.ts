import type { RuntimeBundle } from "../factory/RuntimeBundle";
import { WebStorageRuntime } from "../web/WebStorageRuntime";
import { TauriAuthRuntime } from "./TauriAuthRuntime";
import { TauriMessageRuntime } from "./TauriMessageRuntime";
import { TauriNotificationRuntime } from "./TauriNotificationRuntime";

export function createTauriRuntime(): RuntimeBundle {
  const auth = new TauriAuthRuntime();
  return {
    auth,
    storage: new WebStorageRuntime(),
    message: new TauriMessageRuntime(),
    notification: new TauriNotificationRuntime()
  };
}
