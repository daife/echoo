export class AckService {
  acknowledge(messageId: string) {
    return { messageId, deliveredAt: Date.now() };
  }
}
