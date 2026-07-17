import {
  publishRealtime,
  publishRealtimeBinary,
} from "./realtime-event-bus.js";

export class AppPushService {
  pushToUser(userId: string, payload: unknown) {
    publishRealtime(userId, payload);
  }


  pushBinaryToUser(userId: string, header: unknown, data: Buffer) {
    publishRealtimeBinary(userId, header, data);
  }
}
