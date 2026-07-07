import type { Message } from "@echoo/shared";
import type { ApiClient } from "./client";

export class MessageApi {
  constructor(private readonly client: ApiClient) {}

  listMessages(options?: { after?: string | null }): Promise<Message[]> {
    return this.client.get<Message[]>("/messages", { after: options?.after ?? undefined });
  }

  markRead(messageId: string, readAt: number): Promise<{ ok: true }> {
    return this.client.post<{ ok: true }>(`/messages/${messageId}/read`, { readAt });
  }
}
