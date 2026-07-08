import type { Message } from "@echoo/shared";
import type { ApiClient } from "./client";

export class MessageApi {
  constructor(private readonly client: ApiClient) {}

  listMessages(options?: { after?: string | null; conversationId?: string | null }): Promise<Message[]> {
    return this.client.get<Message[]>("/messages", {
      after: options?.after ?? undefined,
      conversationId: options?.conversationId ?? undefined
    });
  }

  listConversationMessages(conversationId: string): Promise<Message[]> {
    return this.client.get<Message[]>(`/conversations/${conversationId}/messages`);
  }

  createTextMessage(input: {
    conversationId: string;
    text: string;
    clientMessageId?: string;
    stream?: boolean;
  }): Promise<{ message: Message; assistantMessage?: Message }> {
    return this.client.post<{ message: Message; assistantMessage?: Message }>(`/conversations/${input.conversationId}/messages`, {
      text: input.text,
      clientMessageId: input.clientMessageId,
      stream: input.stream
    });
  }

  markRead(messageId: string, readAt: number): Promise<{ ok: true }> {
    return this.client.post<{ ok: true }>(`/messages/${messageId}/read`, { readAt });
  }
}
