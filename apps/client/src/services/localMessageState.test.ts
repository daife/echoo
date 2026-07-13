import { describe, expect, it } from "vitest";
import type { LocalMessage } from "@echoo/shared";
import {
  createPendingTextMessage,
  markLocalMessageFailed,
  markLocalMessageSending,
  mergeIncomingMessage,
  mergeLocalMessage,
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

  it("places a memory summary after its covered reply and clears it while rebuilding", () => {
    const base = {
      conversationId: "conversation_1",
      content: { text: "reply" },
      status: "delivered" as const,
      syncStatus: "synced" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const reply = {
      ...base,
      id: "reply",
      sequence: 10,
      role: "assistant" as const,
      contentType: "text" as const,
    };
    const later = {
      ...base,
      id: "later",
      sequence: 11,
      role: "user" as const,
      contentType: "text" as const,
    };
    const summary = {
      ...base,
      id: "summary",
      sequence: 20,
      role: "system" as const,
      contentType: "system" as const,
      metadata: { kind: "memory_summary", coveredThroughSequence: 10 },
    };
    const ordered = [later, summary, reply].reduce(
      (messages, message) => mergeLocalMessage(messages, message),
      [] as LocalMessage[],
    );
    expect(ordered.map((message) => message.id)).toEqual([
      "reply",
      "summary",
      "later",
    ]);

    const rebuilt = mergeIncomingMessage(ordered, {
      ...summary,
      content: { text: "" },
      status: "pending",
    });
    expect(rebuilt.find((message) => message.id === "summary")?.content.text).toBe("");
  });
});
