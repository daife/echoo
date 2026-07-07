export interface DeliveryTask {
  id: string;
  messageId: string;
  attempts: number;
  createdAt: number;
}
