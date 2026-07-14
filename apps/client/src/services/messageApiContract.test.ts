import { MessageApi } from "@echoo/api-client";
import { describe, expect, it, vi } from "vitest";

describe("MessageApi text message contract", () => {
  it("sends only the canonical text message fields", async () => {
    const post = vi.fn().mockResolvedValue({ message: { id: "msg_1" } });
    const api = new MessageApi({ post } as never);

    await api.createTextMessage({
      conversationId: "conversation_1",
      text: "hello",
      clientMessageId: "client_1",
    });

    expect(post).toHaveBeenCalledWith(
      "/conversations/conversation_1/messages",
      {
        text: "hello",
        clientMessageId: "client_1",
      },
    );
  });
});
