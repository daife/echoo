import type {
  NotificationPayload,
  NotificationPermissionState,
} from "@echoo/shared/notifications";
import type { NotificationRuntime } from "../contracts";

export class TauriNotificationRuntime implements NotificationRuntime {
  private lastPermissionState: NotificationPermissionState | null = null;

  async getPermissionState(): Promise<NotificationPermissionState> {
    try {
      const { isPermissionGranted } =
        await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) {
        this.lastPermissionState = "granted";
        return this.lastPermissionState;
      }
      if (this.lastPermissionState !== "denied")
        this.lastPermissionState = "prompt";
      return this.lastPermissionState;
    } catch {
      return "unsupported";
    }
  }

  async requestPermission(): Promise<boolean> {
    try {
      const { isPermissionGranted, requestPermission } =
        await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) {
        this.lastPermissionState = "granted";
        return true;
      }
      const permission = await requestPermission();
      this.lastPermissionState =
        permission === "default" ? "prompt" : permission;
      return this.lastPermissionState === "granted";
    } catch {
      return false;
    }
  }

  async showNotification(payload: NotificationPayload): Promise<void> {
    if ((await this.getPermissionState()) !== "granted") return;
    const { sendNotification } =
      await import("@tauri-apps/plugin-notification");
    sendNotification({ title: payload.title, body: payload.body });
  }
}
