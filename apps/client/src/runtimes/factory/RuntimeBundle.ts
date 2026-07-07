import type { AuthRuntime, LinkRuntime, MessageRuntime, NotificationRuntime, StorageRuntime } from "../contracts";

export interface RuntimeBundle {
  auth: AuthRuntime;
  storage: StorageRuntime;
  link: LinkRuntime;
  message: MessageRuntime;
  notification: NotificationRuntime;
}
