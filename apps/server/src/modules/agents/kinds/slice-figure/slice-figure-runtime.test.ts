import assert from "node:assert/strict";
import test from "node:test";
import type { Message, SliceFigureAgent } from "@echoo/shared";
import { selectSliceFigureContextMessages } from "./slice-figure-runtime.service.js";

test("slice context keeps a repository-selected 100-199 round window intact", () => {
  const history: Message[] = [];
  for (let round = 100; round <= 299; round += 1) {
    history.push(message(`user-${round}`, "user", `user ${round}`));
    history.push(message(`assistant-${round}`, "assistant", `assistant ${round}`));
  }

  const selected = selectSliceFigureContextMessages(agent(), history, false);

  assert.equal(selected.length, 400);
  assert.deepEqual(selected[0], { role: "user", content: "user 100" });
  assert.deepEqual(selected.at(-1), {
    role: "assistant",
    content: "assistant 299",
  });
});

test("slice context only restores a missing opening line in the initial window", () => {
  const history = [message("user-1", "user", "hello")];

  assert.deepEqual(selectSliceFigureContextMessages(agent(), history, true), [
    { role: "assistant", content: "opening" },
    { role: "user", content: "hello" },
  ]);
  assert.deepEqual(selectSliceFigureContextMessages(agent(), history, false), [
    { role: "user", content: "hello" },
  ]);
});

test("slice context excludes failed, empty and non-text messages", () => {
  const history = [
    message("valid", "user", " valid "),
    { ...message("failed", "assistant", "failed"), status: "failed" as const },
    message("empty", "assistant", "   "),
    { ...message("image", "user", "ignored"), contentType: "image" as const },
  ];

  assert.deepEqual(selectSliceFigureContextMessages(agent(""), history, true), [
    { role: "user", content: "valid" },
  ]);
});

function message(id: string, role: "user" | "assistant", text: string): Message {
  return {
    id,
    conversationId: "conversation-1",
    role,
    contentType: "text",
    content: { text },
    status: "delivered",
    createdAt: 1,
    updatedAt: 1,
  };
}

function agent(openingLine = "opening"): SliceFigureAgent {
  return {
    id: "agent-1",
    ownerUserId: "user-1",
    type: "slice-figure",
    name: "Figure",
    attributes: [],
    tags: [],
    introduction: "",
    conversationId: "conversation-1",
    isPublic: false,
    createdAt: 1,
    updatedAt: 1,
    detail: {
      prologueHtml: "",
      currentSituation: "",
      openingLine,
      linkedAgentIds: [],
      persona: "",
      background: "",
      personality: "",
      responseStyle: "",
      systemPrompt: "",
    },
  };
}
