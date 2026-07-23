import type { NotificationState } from "@echoo/shared/notifications";
import type { ApiClient } from "./client";

export class NotificationsApi {
  constructor(private readonly client: ApiClient) {}

  getState(): Promise<NotificationState> {
    return this.client.get("/notifications/state");
  }

  markActivityRead(): Promise<NotificationState> {
    return this.client.post("/notifications/activity/read");
  }
}
