import type { Message } from "@echoo/shared";
import type { ApiClient } from "./client";

export class MessageApi {
  constructor(private readonly client: ApiClient) {}

  listMessages(options?: { after?: string | null; conversationId?: string | null; limit?: number | null }): Promise<Message[]> {
    return this.client.get<Message[]>("/messages", {
      after: options?.after ?? undefined,
      conversationId: options?.conversationId ?? undefined,
      limit: options?.limit ?? undefined
    });
  }

  listConversationMessages(
    conversationId: string,
    options?: { after?: string | null; before?: string | null; limit?: number | null }
  ): Promise<Message[]> {
    return this.client.get<Message[]>(`/conversations/${conversationId}/messages`, {
      after: options?.after ?? undefined,
      before: options?.before ?? undefined,
      limit: options?.limit ?? undefined
    });
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

  triggerPrimeFigureHint(
    conversationId: string,
    instruction: string
  ): Promise<{ ok: true }> {
    return this.client.post<{ ok: true }>(
      `/conversations/${conversationId}/prime-figure/hint`,
      { instruction }
    );
  }

  markRead(messageId: string, readAt: number): Promise<{ ok: true }> {
    return this.client.post<{ ok: true }>(`/messages/${messageId}/read`, { readAt });
  }

  deleteConversation(conversationId: string): Promise<{ ok: true }> {
    return this.client.delete<{ ok: true }>(`/conversations/${conversationId}`);
  }

  rollbackConversation(conversationId: string, messageId: string): Promise<{ ok: true; retainedThroughMessageId: string; deletedCount: number }> {
    return this.client.post<{ ok: true; retainedThroughMessageId: string; deletedCount: number }>(
      `/conversations/${conversationId}/rollback`,
      { messageId }
    );
  }
}
