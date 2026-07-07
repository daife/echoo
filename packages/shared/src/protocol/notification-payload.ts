export interface NotificationPayload {
  title: string;
  body: string;
  messageId?: string;
  conversationId?: string;
  data?: Record<string, unknown>;
}
