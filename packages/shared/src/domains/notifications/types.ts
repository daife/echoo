export type NotificationKind = "message" | "activity";

export type NotificationPermissionState =
  "granted" | "denied" | "prompt" | "unsupported";

export interface NotificationPayload {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  conversationId?: string;
}

export interface NotificationState {
  activityUnread: boolean;
  activityUpdatedAt: number;
}
