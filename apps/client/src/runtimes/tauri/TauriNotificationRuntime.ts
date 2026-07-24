import type {
  NotificationPayload,
  NotificationPermissionState,
} from "@echoo/shared/notifications";
import type { NotificationRuntime } from "../contracts";
import { tauriInvoke } from "./tauriInvoke";

export class TauriNotificationRuntime implements NotificationRuntime {
  private lastPermissionState: NotificationPermissionState | null = null;
  private readonly android = isAndroid();
  private readonly preparation = this.android
    ? tauriInvoke<void>("plugin:keepalive|prepare_notifications").catch(
        () => undefined,
      )
    : Promise.resolve();
  readonly permissionRequestMode = this.android ? "automatic" : "manual";
  readonly openSettings = this.android
    ? async () => {
        await this.preparation;
        await tauriInvoke<void>("plugin:keepalive|open_notification_settings");
      }
    : undefined;

  async getPermissionState(): Promise<NotificationPermissionState> {
    try {
      await this.preparation;
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
    if (this.android) {
      await tauriInvoke<void>("plugin:keepalive|show_notification", {
        id: payload.id,
        kind: payload.kind,
        title: payload.title,
        body: payload.body,
      });
      return;
    }
    const { sendNotification } =
      await import("@tauri-apps/plugin-notification");
    sendNotification({ title: payload.title, body: payload.body });
  }
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}
