import { publishRealtime } from "./realtime-event-bus.js";

export class AppPushService {
  push(payload: unknown) {
    publishRealtime(null, payload);
  }

  pushToUser(userId: string, payload: unknown) {
    publishRealtime(userId, payload);
  }
}
