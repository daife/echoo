import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrimeFigureSchema,
  primeFigureDecisionSchema,
  primeFigureScheduleSchema,
  updatePrimeFigureSchema,
} from "@echoo/shared";
import type { PrimeFigureDecision, PrimeFigureState } from "@echoo/shared";
import { PrimeActionExecutor } from "./prime-action-executor.js";
import { PrimeDecisionStreamParser } from "./prime-decision-stream-parser.js";
import { buildPrimeChatMessages } from "./prime-figure-runtime.service.js";
import { buildRuntimeConfigDefaults } from "../../../runtime-config/runtime-config.defaults.js";

test("prime decision parser preserves streamed visible message fields", () => {
  const events: Array<{
    actionIndex: number;
    field: string;
    delta: string;
    complete: boolean;
  }> = [];
  const parser = new PrimeDecisionStreamParser((event) => events.push(event));
  const json = JSON.stringify({
    rationale: "回应",
    figureMood: "平静",
    variables: {},
    actions: [
      { type: "send_message", message: { type: "text", text: "晚上好" } },
    ],
  });
  for (const chunk of json.match(/.{1,7}/g) ?? []) parser.push(chunk);
  assert.equal(
    events
      .filter((event) => event.field === "text")
      .map((event) => event.delta)
      .join(""),
    "晚上好",
  );
  assert.equal(
    events.some((event) => event.field === "text" && event.complete),
    true,
  );
});

test("prime schedule and decision contracts use fixed server timezone", () => {
  assert.deepEqual(primeFigureScheduleSchema.parse({ segments: [] }), {
    segments: [],
  });
  const decision = primeFigureDecisionSchema.parse({
    rationale: "等待",
    figureMood: "专注",
    variables: {},
    stateUpdates: { schedule: { segments: [] } },
    actions: [{ type: "silence" }],
  });
  assert.deepEqual(decision.stateUpdates.schedule, { segments: [] });
  assert.equal("timezone" in (decision.stateUpdates.schedule ?? {}), false);
});

test("prime create and update contracts accept described creator images and current state", () => {
  const base = {
    name: "Mira",
    isPublic: false,
    persona: "角色人设",
    background: "角色背景",
    personality: "角色性格",
    responseStyle: "回复风格",
    referenceImages: [
      {
        upload: {
          fileName: "look.jpg",
          mimeType: "image/jpeg",
          dataBase64: "/9j/",
        },
        description: "角色的日常穿搭",
      },
    ],
  };
  const created = createPrimeFigureSchema.parse({
    type: "prime-figure",
    ...base,
  });
  assert.equal(created.referenceImages[0]?.description, "角色的日常穿搭");
  assert.equal(created.voiceRequestStreaming, false);

  const updated = updatePrimeFigureSchema.parse({
    ...base,
    avatar: null,
    currentVariables: { trust: 72 },
    currentMood: "轻松",
    currentRelationshipStatus: "稳定",
  });
  assert.equal(updated.avatar, null);
  assert.deepEqual(updated.currentVariables, { trust: 72 });
  assert.equal(updated.currentMood, "轻松");
  assert.equal(updated.voiceRequestStreaming, undefined);
});

test("prime creator images require descriptions", () => {
  assert.throws(() =>
    createPrimeFigureSchema.parse({
      type: "prime-figure",
      name: "Mira",
      isPublic: false,
      persona: "角色人设",
      background: "角色背景",
      personality: "角色性格",
      responseStyle: "回复风格",
      referenceImages: [
        {
          upload: {
            fileName: "look.jpg",
            mimeType: "image/jpeg",
            dataBase64: "/9j/",
          },
          description: "",
        },
      ],
    }),
  );
});

test("prime context registers cover and creator images before conversation media", async () => {
  const ensured: Array<{
    resourceId: string;
    description?: string;
    source?: string;
  }> = [];
  await buildPrimeChatMessages(
    {
      id: "agent_1",
      ownerUserId: "user_1",
      type: "prime-figure",
      name: "Mira",
      attributes: [],
      tags: [],
      introduction: "",
      isPublic: false,
      conversationId: "conv_1",
      createdAt: 1,
      updatedAt: 1,
      coverResourcePath: "/api/resources/cover/file",
      detail: {
        prologueHtml: "",
        linkedAgentIds: [],
        persona: "人设",
        background: "背景",
        personality: "性格",
        responseStyle: "风格",
        decisionStyle: "",
        currentSituation: "",
        schedule: { segments: [] },
        itinerary: "",
        variableDefinitions: [],
        referenceImages: [
          {
            resourceId: "res_reference",
            resourcePath: "/api/resources/reference/file",
            description: "日常外观",
          },
        ],
        voiceRequestStreaming: false,
      },
    },
    {
      variables: {},
      memories: [],
      mood: "",
      moodObservedAtMs: 1,
      relationshipStatus: "",
      updatedAt: 1,
    },
    [],
    "end_user_message",
    "user_1",
    {
      async findByPublicPath() {
        return {
          id: "res_cover",
          ownerUserId: "user_1",
          mimeType: "image/png",
        };
      },
      async findById(id: string) {
        return { id, ownerUserId: "user_1", mimeType: "image/png" };
      },
    } as never,
    {
      async ensure(input: {
        resourceId: string;
        description?: string;
        source?: string;
      }) {
        ensured.push(input);
      },
      async listAvailableImages() {
        return [];
      },
    } as never,
    0,
    undefined,
    buildRuntimeConfigDefaults().primeFigure,
  );

  assert.deepEqual(
    ensured.map((item) => [item.resourceId, item.description, item.source]),
    [
      ["res_cover", "figure角色立绘", "figure_cover"],
      ["res_reference", "日常外观", "figure_reference"],
    ],
  );
});

test("prime debug hints stay inside the single user packet", async () => {
  const instruction = "发送语音消息：请留下来。";
  const packet = await buildPrimeChatMessages(
    {
      id: "agent_1",
      ownerUserId: "user_1",
      type: "prime-figure",
      name: "Mira",
      attributes: [],
      tags: [],
      introduction: "",
      isPublic: false,
      conversationId: "conv_1",
      createdAt: 1,
      updatedAt: 1,
      detail: {
        prologueHtml: "",
        linkedAgentIds: [],
        persona: "人设",
        background: "背景",
        personality: "性格",
        responseStyle: "风格",
        decisionStyle: "",
        currentSituation: "",
        schedule: { segments: [] },
        itinerary: "",
        variableDefinitions: [],
        referenceImages: [],
        voiceRequestStreaming: false,
      },
    },
    {
      variables: {},
      memories: [],
      mood: "",
      moodObservedAtMs: 1,
      relationshipStatus: "",
      updatedAt: 1,
    },
    [],
    "debug_hint",
    "user_1",
    {} as never,
    {
      async listAvailableImages() {
        return [];
      },
    } as never,
    0,
    instruction,
    buildRuntimeConfigDefaults().primeFigure,
  );

  assert.deepEqual(
    packet.messages.map((message) => message.role),
    ["system", "user"],
  );
  const userContent = packet.messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  const context = userContent.at(-1);
  assert.equal(context?.type, "text");
  assert.match(
    String(context && "text" in context ? context.text : ""),
    /系统调试指令/,
  );
  assert.match(
    String(context && "text" in context ? context.text : ""),
    /请留下来/,
  );
});

test("prime decision distinguishes one-turn silence from message muting", () => {
  const base = { rationale: "等待", figureMood: "平静", variables: {} };
  assert.deepEqual(
    primeFigureDecisionSchema.parse({ ...base, actions: [{ type: "silence" }] })
      .actions,
    [{ type: "silence" }],
  );
  assert.deepEqual(
    primeFigureDecisionSchema.parse({
      ...base,
      actions: [{ type: "mute", revisitAfterMinutes: 5 }],
    }).actions,
    [{ type: "mute", revisitAfterMinutes: 5 }],
  );
  assert.throws(() =>
    primeFigureDecisionSchema.parse({
      ...base,
      actions: [{ type: "silence", revisitAfterMinutes: 5 }],
    }),
  );
});

test("prime decision accepts advisory-only action exclusivity", () => {
  const base = {
    rationale: "先回应再暂时屏蔽",
    figureMood: "平静",
    variables: {},
  };
  assert.deepEqual(
    primeFigureDecisionSchema.parse({
      ...base,
      actions: [
        { type: "silence" },
        { type: "send_message", message: { type: "text", text: "稍后见" } },
        { type: "mute", revisitAfterMinutes: 5 },
      ],
    }).actions,
    [
      { type: "silence" },
      { type: "send_message", message: { type: "text", text: "稍后见" } },
      { type: "mute", revisitAfterMinutes: 5 },
    ],
  );
});

test("prime decision normalizes message-shaped action discriminator mistakes", () => {
  const prompt = [
    "【正向提示词】午餐照片",
    "【负向提示词】畸形",
    "【机位与身体逻辑检查】手机后摄",
    "【推荐比例】3:4",
  ].join("\n");
  const decision = primeFigureDecisionSchema.parse({
    rationale: "发送午餐照片",
    figureMood: "轻松",
    variables: {},
    actions: [
      {
        type: "image",
        ignored: "drop me",
        message: {
          type: "image",
          generationPrompt: prompt,
          ignored: "drop me too",
        },
      },
      {
        type: "text",
        message: { type: "text", text: "给你看", ignored: true },
      },
    ],
  });

  assert.deepEqual(decision.actions, [
    {
      type: "send_message",
      message: {
        type: "image",
        description: "",
        generationPrompt: prompt,
        referenceMediaIds: [],
      },
    },
    {
      type: "send_message",
      message: { type: "text", text: "给你看" },
    },
  ]);
});

test("prime decision accepts image prompts without enforcing prompt prose structure", () => {
  const decision = primeFigureDecisionSchema.parse({
    rationale: "发送午餐照片",
    figureMood: "轻松",
    variables: {},
    actions: [
      {
        type: "send_message",
        message: {
          type: "image",
          description: "一张午餐照片",
          generationPrompt: "A casual phone photo of lunch on the table.",
          referenceMediaIds: [],
        },
      },
    ],
  });

  assert.equal(
    decision.actions[0]?.type === "send_message" &&
      decision.actions[0].message.type === "image"
      ? decision.actions[0].message.generationPrompt
      : undefined,
    "A casual phone photo of lunch on the table.",
  );
});

test("prime decision keeps required outgoing message fields strict", () => {
  const base = { rationale: "回应", figureMood: "平静", variables: {} };
  assert.throws(() =>
    primeFigureDecisionSchema.parse({
      ...base,
      actions: [{ type: "voice", message: { type: "voice" } }],
    }),
  );
  assert.throws(() =>
    primeFigureDecisionSchema.parse({
      ...base,
      actions: [{ type: "image", message: { type: "image" } }],
    }),
  );
});

test("prime image without description is failed when generation produced no media", async () => {
  const saved: Array<Record<string, unknown>> = [];
  let previewUpdates = 0;
  const executor = new PrimeActionExecutor(
    { async save() {} } as never,
    { async applyRuntimeUpdates() {} } as never,
    {
      async save(input: Record<string, unknown>) {
        saved.push(input);
        return input;
      },
    } as never,
    { async save() {} } as never,
    {
      async updatePreview() {
        previewUpdates += 1;
      },
    } as never,
    { pushToUser() {} } as never,
  );
  const prompt = [
    "【正向提示词】午餐照片",
    "【负向提示词】畸形",
    "【机位与身体逻辑检查】手机后摄",
    "【推荐比例】3:4",
  ].join("\n");

  await executor.executeDecision({
    ownerUserId: "user_1",
    conversationId: "conversation_1",
    agent: {
      id: "agent_1",
      detail: { variableDefinitions: [] },
    } as never,
    state: {
      variables: {},
      memories: [],
      mood: "",
      moodObservedAtMs: 0,
      relationshipStatus: "",
      updatedAt: 0,
    },
    decision: primeFigureDecisionSchema.parse({
      rationale: "发送图片",
      figureMood: "轻松",
      variables: {},
      actions: [
        {
          type: "image",
          message: { type: "image", generationPrompt: prompt },
        },
      ],
    }) as PrimeFigureDecision,
    providerId: "test-provider",
    model: "test-model",
    imageGenerationErrors: new Map([[0, "generation failed"]]),
  });

  assert.equal(saved[0]?.status, "failed");
  assert.equal(previewUpdates, 0);
});

test("prime executor sends messages and starts mute when actions coexist", async () => {
  const savedMessages: Array<Record<string, unknown>> = [];
  let savedState: PrimeFigureState | undefined;
  let previewUpdates = 0;
  const executor = new PrimeActionExecutor(
    {
      async save(
        _ownerUserId: string,
        _agentId: string,
        state: PrimeFigureState,
      ) {
        savedState = state;
      },
    } as never,
    { async applyRuntimeUpdates() {} } as never,
    {
      async save(input: Record<string, unknown>) {
        savedMessages.push(input);
        return input;
      },
    } as never,
    { async save() {} } as never,
    {
      async updatePreview() {
        previewUpdates += 1;
      },
    } as never,
    { pushToUser() {} } as never,
  );
  const muteMessageCutoffAtMs = 1_700_000_000_000;

  await executor.executeDecision({
    ownerUserId: "user_1",
    conversationId: "conversation_1",
    agent: {
      id: "agent_1",
      detail: { variableDefinitions: [] },
    } as never,
    state: {
      variables: {},
      memories: [],
      mood: "",
      moodObservedAtMs: 0,
      relationshipStatus: "",
      updatedAt: 0,
    },
    decision: primeFigureDecisionSchema.parse({
      rationale: "回应后暂时屏蔽",
      figureMood: "平静",
      variables: {},
      actions: [
        { type: "silence" },
        { type: "send_message", message: { type: "text", text: "稍后见" } },
        { type: "mute", revisitAfterMinutes: 5 },
      ],
    }) as PrimeFigureDecision,
    providerId: "test-provider",
    model: "test-model",
    muteMessageCutoffAtMs,
  });

  assert.equal(savedMessages.length, 1);
  assert.deepEqual(savedMessages[0]?.content, { text: "稍后见" });
  assert.equal(previewUpdates, 1);
  assert.equal(savedState?.silenceStartedAtMs, muteMessageCutoffAtMs);
  assert.ok((savedState?.silenceUntilMs ?? 0) > Date.now());
});
