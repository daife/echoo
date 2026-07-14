import type { RuntimeBundle } from "../factory/RuntimeBundle";
import { WebAuthRuntime } from "./WebAuthRuntime";
import { WebLinkRuntime } from "./WebLinkRuntime";
import { WebMessageRuntime } from "./WebMessageRuntime";
import { WebNotificationRuntime } from "./WebNotificationRuntime";
import { WebStorageRuntime } from "./WebStorageRuntime";

export function createWebRuntime(): RuntimeBundle {
  const auth = new WebAuthRuntime();
  const storage = new WebStorageRuntime();
  return {
    auth,
    storage,
    link: new WebLinkRuntime(),
    message: new WebMessageRuntime(auth),
    notification: new WebNotificationRuntime(),
  };
}
