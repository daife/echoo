export interface AckPayload {
  messageId: string;
  deviceId?: string;
  deliveredAt: number;
}
