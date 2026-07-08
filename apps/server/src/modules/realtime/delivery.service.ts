import { wsSessionManager } from "./ws-session-manager.js";

export class AppPushService {
  push(payload: unknown) {
    wsSessionManager.broadcast(payload);
  }

  pushToUser(userId: string, payload: unknown) {
    wsSessionManager.broadcastToUser(userId, payload);
  }
}
