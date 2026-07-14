import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFigureMemorySummaryPrompt,
  type Message,
  type SliceFigureAgent,
} from "@echoo/shared";
import {
  selectSliceFigureContextMessages,
  SliceFigureRuntimeService,
} from "./slice-figure-runtime.service.js";

test("slice context keeps a repository-selected 100-199 round window intact", () => {
  const history: Message[] = [];
  for (let round = 100; round <= 299; round += 1) {
    history.push(message(`user-${round}`, "user", `user ${round}`));
    history.push(
      message(`assistant-${round}`, "assistant", `assistant ${round}`),
    );
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

test("slice context starts with the latest memory summary and never restores the opening line", () => {
  const summary: Message = {
    id: "summary-1",
    sequence: 1001,
    conversationId: "conversation-1",
    role: "system",
    contentType: "system",
    content: { text: "用户喜欢雨天。" },
    status: "delivered",
    metadata: { kind: "memory_summary", coveredThroughSequence: 1000 },
    createdAt: 2,
    updatedAt: 2,
  };
  const selected = selectSliceFigureContextMessages(
    agent(),
    [summary, message("user-501", "user", "继续聊")],
    false,
  );
  assert.deepEqual(selected, [
    { role: "system", content: "此前对话的滚动记忆总结：\n用户喜欢雨天。" },
    { role: "user", content: "继续聊" },
  ]);
});

test("memory summary prompt resolves the same safe figure placeholders", () => {
  const value = buildFigureMemorySummaryPrompt(
    {
      ...agent().detail,
      memorySummaryPrompt:
        "{{user.name}}/{{figure.persona}}/{{figure.currentSituation}}",
    },
    { user: { displayName: "小林" } },
  );
  assert.equal(value, "小林//");
});

test("memory summary rolls the previous summary into only the next completed batch", async () => {
  const previous: Message = {
    id: "summary-1",
    sequence: 1001,
    conversationId: "conversation-1",
    role: "system",
    contentType: "system",
    content: { text: "第一阶段的重要记忆" },
    status: "delivered",
    metadata: { kind: "memory_summary", coveredThroughSequence: 1000 },
    createdAt: 1,
    updatedAt: 1,
  };
  const boundary = {
    ...message("assistant-1000", "assistant", "新的回复"),
    sequence: 2000,
  };
  let latest: Message | null = previous;
  let requestText = "";
  const repository = {
    findLatestMemorySummary: async () => latest,
    findSliceMemorySummaryBoundary: async (
      _owner: string,
      _conversation: string,
      after: number,
    ) => (after === 1000 ? boundary : null),
    listSliceMemorySummarySource: async () => [
      { ...message("user-1000", "user", "本周期的新原文"), sequence: 1999 },
      boundary,
    ],
    findPendingMemorySummary: async () => null,
    save: async (input: Message & { ownerUserId: string }) => ({
      ...input,
      sequence: 2001,
    }),
    completeMemorySummary: async (input: {
      messageId: string;
      text: string;
    }) => {
      latest = {
        id: input.messageId,
        sequence: 2001,
        conversationId: "conversation-1",
        role: "system",
        contentType: "system",
        content: { text: input.text },
        status: "delivered",
        metadata: { kind: "memory_summary", coveredThroughSequence: 2000 },
        createdAt: 2,
        updatedAt: 2,
      };
      return latest;
    },
  };
  const provider = {
    id: "openrouter" as const,
    createChatCompletion: async (input: {
      messages: Array<{ content: string }>;
    }) => {
      requestText = input.messages.at(-1)?.content ?? "";
      return {
        text: "第二阶段滚动总结",
        providerId: "openrouter" as const,
        model: "model",
      };
    },
  };
  const runtime = new SliceFigureRuntimeService(
    { findByConversation: async () => agent() } as never,
    repository as never,
    { createProvider: () => provider } as never,
    { findById: async () => null } as never,
    {
      resolveConversationConfig: async () => ({
        config: {
          version: 1,
          llm: {
            provider: "openrouter",
            baseUrl: "https://example.test",
            apiKey: "key",
            model: "model",
            temperature: 0.8,
            maxTokens: 1200,
          },
          context: {
            minimumRounds: 100,
            maximumRounds: 199,
            memorySummaryRounds: 500,
          },
        },
      }),
    } as never,
  );

  const summaries = await runtime.createPendingMemorySummaries({
    ownerUserId: "user-1",
    conversationId: "conversation-1",
  });

  assert.equal(summaries.length, 1);
  assert.match(requestText, /第一阶段的重要记忆/);
  assert.match(requestText, /本周期的新原文/);
  assert.doesNotMatch(requestText, /第一阶段原始对话/);
});

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
): Message {
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
      memorySummaryPrompt: "summarize",
      replyAutoSegment: false,
    },
  };
}
