import { DeliveryRepository } from "./delivery.repository.js";

export class DeliveryService {
  constructor(private readonly repository = new DeliveryRepository()) {}

  enqueue(messageId: string) {
    return this.repository.enqueue({
      id: `delivery_${crypto.randomUUID()}`,
      messageId,
      attempts: 0,
      createdAt: Date.now(),
    });
  }
}
