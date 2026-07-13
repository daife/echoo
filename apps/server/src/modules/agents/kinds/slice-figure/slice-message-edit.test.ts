import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "@echoo/shared";
import { MessagingService } from "../../../messaging/messaging.service.js";

test("slice message edit keeps later history and only refreshes the last-message preview when needed", async () => {
  const target = message("target", "delivered");
  const later = message("later", "delivered");
  const previews: string[] = [];
  const events: unknown[] = [];
  let lastMessage = later;
  const repository = {
    findByIdInConversation: async () => target,
    findLastPreviewMessage: async () => lastMessage,
    updateText: async (_owner: string, _conversation: string, _id: string, text: string, updatedAt: number) => ({
      ...target,
      content: { text },
      updatedAt,
    }),
  };
  const conversations = {
    findByIdForOwner: async () => ({ id: "conversation", type: "slice-figure" }),
    updatePreview: async (input: { preview: string }) => { previews.push(input.preview); },
  };
  const appPush = { pushToUser: (_owner: string, event: unknown) => events.push(event) };
  const service = new MessagingService(
    repository as never,
    conversations as never,
    appPush as never,
  );

  const olderResult = await service.updateAssistantTextMessage({
    ownerUserId: "owner",
    conversationId: "conversation",
    messageId: target.id,
    text: "修改后",
  });
  assert.equal(olderResult.kind, "ok");
  assert.deepEqual(previews, []);
  assert.equal((events[0] as { type: string }).type, "message.updated");

  lastMessage = target;
  await service.updateAssistantTextMessage({
    ownerUserId: "owner",
    conversationId: "conversation",
    messageId: target.id,
    text: "最后一条",
  });
  assert.deepEqual(previews, ["最后一条"]);
});

test("slice message edit rejects pending and non-assistant messages", async () => {
  let current = message("pending", "pending");
  const service = new MessagingService(
    {
      findByIdInConversation: async () => current,
    } as never,
    {
      findByIdForOwner: async () => ({ id: "conversation", type: "slice-figure" }),
    } as never,
  );
  assert.equal((await service.updateAssistantTextMessage({ ownerUserId: "owner", conversationId: "conversation", messageId: current.id, text: "x" })).kind, "pending");
  current = { ...current, role: "user", status: "sent" };
  assert.equal((await service.updateAssistantTextMessage({ ownerUserId: "owner", conversationId: "conversation", messageId: current.id, text: "x" })).kind, "unsupported_message");
});

function message(id: string, status: Message["status"]): Message {
  return {
    id,
    conversationId: "conversation",
    role: "assistant",
    contentType: "text",
    content: { text: "原文" },
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}
