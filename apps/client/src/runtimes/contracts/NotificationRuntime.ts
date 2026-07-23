import type {
  NotificationPayload,
  NotificationPermissionState,
} from "@echoo/shared/notifications";

export interface NotificationRuntime {
  getPermissionState(): Promise<NotificationPermissionState>;
  requestPermission(): Promise<boolean>;
  showNotification(payload: NotificationPayload): Promise<void>;
}
