import { NotificationsApi } from "@echoo/api-client";

export class NotificationService {
  constructor(private readonly api: NotificationsApi) {}

  getState() {
    return this.api.getState();
  }

  markActivityRead() {
    return this.api.markActivityRead();
  }
}
