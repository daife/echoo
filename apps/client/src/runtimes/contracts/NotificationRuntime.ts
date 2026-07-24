import type {
  NotificationPayload,
  NotificationPermissionState,
} from "@echoo/shared/notifications";

export interface NotificationRuntime {
  readonly permissionRequestMode: "automatic" | "manual";
  readonly openSettings?: () => Promise<void>;
  getPermissionState(): Promise<NotificationPermissionState>;
  requestPermission(): Promise<boolean>;
  showNotification(payload: NotificationPayload): Promise<void>;
}
