import type { NotificationPayload } from "@echoo/shared";

export interface NotificationRuntime {
  requestPermission(): Promise<boolean>;
  showMessageNotification(payload: NotificationPayload): Promise<void>;
}
