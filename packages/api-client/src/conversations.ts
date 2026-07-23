import type { Conversation } from "@echoo/shared";
import type { ApiClient } from "./client";

export class ConversationsApi {
  constructor(private readonly client: ApiClient) {}

  list(): Promise<Conversation[]> {
    return this.client.get("/conversations");
  }

  markRead(conversationId: string): Promise<Conversation> {
    return this.client.post(`/conversations/${conversationId}/read`);
  }
}
