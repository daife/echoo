import type { RuntimeBundle } from "../factory/RuntimeBundle";
import { WebAuthRuntime } from "./WebAuthRuntime";
import { WebMessageRuntime } from "./WebMessageRuntime";
import { WebNotificationRuntime } from "./WebNotificationRuntime";
import { WebStorageRuntime } from "./WebStorageRuntime";

export function createWebRuntime(): RuntimeBundle {
  const auth = new WebAuthRuntime();
  const storage = new WebStorageRuntime();
  return {
    auth,
    storage,
    message: new WebMessageRuntime(auth),
    notification: new WebNotificationRuntime()
  };
}
