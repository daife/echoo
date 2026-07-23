import type {
  NotificationPayload,
  NotificationPermissionState,
} from "@echoo/shared/notifications";
import type { NotificationRuntime } from "../contracts";

export class WebNotificationRuntime implements NotificationRuntime {
  async getPermissionState(): Promise<NotificationPermissionState> {
    if (!("Notification" in globalThis)) return "unsupported";
    return Notification.permission === "default"
      ? "prompt"
      : Notification.permission;
  }

  async requestPermission(): Promise<boolean> {
    if (!("Notification" in globalThis)) return false;
    return (await Notification.requestPermission()) === "granted";
  }

  async showNotification(payload: NotificationPayload): Promise<void> {
    if ((await this.getPermissionState()) !== "granted") return;
    const notification = new Notification(payload.title, {
      body: payload.body,
      tag: payload.id,
    });
    notification.onclick = () => {
      globalThis.focus?.();
      notification.close();
    };
  }
}
