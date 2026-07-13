import { describe, expect, it } from "vitest";
import {
  createPendingTextMessage,
  markLocalMessageFailed,
  markLocalMessageSending,
  mergeSentTextMessageResult,
} from "./localMessageState";

describe("optimistic outgoing messages", () => {
  it("moves from sending to the canonical server message", () => {
    const pending = createPendingTextMessage({
      conversationId: "conversation_1",
      clientMessageId: "client_1",
      text: "hello",
      now: 1,
    });
    const merged = mergeSentTextMessageResult([pending], "client_1", {
      message: {
        ...pending,
        id: "msg_1",
        status: "sent",
        updatedAt: 2,
      },
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "msg_1",
      clientMessageId: "client_1",
      status: "sent",
      syncStatus: "synced",
    });
  });

  it("retains failed content for retry with the same client id", () => {
    const pending = createPendingTextMessage({
      conversationId: "conversation_1",
      clientMessageId: "client_1",
      text: "keep me",
      now: 1,
    });
    const [failed] = markLocalMessageFailed([pending], "client_1", 2);
    expect(failed).toMatchObject({
      clientMessageId: "client_1",
      content: { text: "keep me" },
      status: "failed",
      syncStatus: "failed",
    });

    const retrying = markLocalMessageSending(failed, 3);
    expect(retrying).toMatchObject({
      id: "client_1",
      clientMessageId: "client_1",
      content: { text: "keep me" },
      status: "pending",
      syncStatus: "pending",
      updatedAt: 3,
    });
  });
});
