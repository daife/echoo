import type { NotificationPayload } from "@echoo/shared";
import type { NotificationRuntime } from "../contracts";

export class TauriNotificationRuntime implements NotificationRuntime {
  async requestPermission(): Promise<boolean> {
    return true;
  }

  async showMessageNotification(_payload: NotificationPayload): Promise<void> {
    return;
  }
}
