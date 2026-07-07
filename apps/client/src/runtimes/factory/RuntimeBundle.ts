import type { AuthRuntime, MessageRuntime, NotificationRuntime, StorageRuntime } from "../contracts";

export interface RuntimeBundle {
  auth: AuthRuntime;
  storage: StorageRuntime;
  message: MessageRuntime;
  notification: NotificationRuntime;
}
