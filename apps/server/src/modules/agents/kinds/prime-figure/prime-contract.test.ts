import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrimeFigureSchema,
  primeFigureDecisionSchema,
  primeFigureScheduleSchema,
  primeFigureStateSchema,
  updatePrimeFigureSchema,
} from "@echoo/shared";
import type {
  PrimeFigureAction,
  PrimeFigureAgent,
  PrimeFigureDecision,
  PrimeFigureState,
} from "@echoo/shared";
import { truncatePreview } from "../../../conversations/conversation.repository.js";
import { PrimeActionExecutor } from "./prime-action-executor.js";
import { PrimeDecisionStreamParser } from "./prime-decision-stream-parser.js";
import { buildPrimeChatMessages } from "./prime-figure-runtime.service.js";
import { PrimeFigureWakeupScheduler } from "./prime-figure-silence.scheduler.js";
import {
  invalidatesProactiveWakeup,
  nextPrimeRunAt,
} from "./prime-figure-state.repository.js";
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

test("prime contracts accept expanded authoring data and long JSON text", () => {
  const longText = "x".repeat(20_001);
  const created = createPrimeFigureSchema.parse({
    type: "prime-figure",
    name: "Mira",
    isPublic: false,
    persona: longText,
    background: longText,
    personality: longText,
    responseStyle: longText,
    attributes: Array.from({ length: 51 }, (_, index) => ({
      key: `attribute_${index}`,
      value: longText,
    })),
    tags: Array.from({ length: 31 }, (_, index) => `tag_${index}`),
    linkedAgentIds: Array.from({ length: 51 }, (_, index) => `agent_${index}`),
    schedule: {
      segments: Array.from({ length: 101 }, (_, index) => ({
        label: `segment_${index}`,
        days: ["mon"],
        start: "09:00",
        end: "10:00",
        description: longText,
      })),
    },
    variableDefinitions: Array.from({ length: 101 }, (_, index) => ({
      key: `variable_${index}`,
      label: `Variable ${index}`,
      type: "string",
      description: longText,
    })),
    referenceImages: Array.from({ length: 11 }, (_, index) => ({
      resourceId: `res_${index}`,
      description: longText,
    })),
  });

  assert.equal(created.attributes.length, 51);
  assert.equal(created.schedule.segments.length, 101);
  assert.equal(created.variableDefinitions.length, 101);
  assert.equal(created.referenceImages.length, 11);
  assert.equal(created.persona.length, longText.length);
});

test("prime state contract does not reject or discard older memories", () => {
  const memories = Array.from({ length: 1_001 }, (_, index) => ({
    id: `memory_${index}`,
    content: `memory ${index}`,
    eventAtMs: index,
    recordedAtMs: index,
  }));
  const state = primeFigureStateSchema.parse({
    variables: {},
    memories,
    mood: "calm",
    moodObservedAtMs: 0,
    relationshipStatus: "stable",
    updatedAt: 0,
  });
  assert.equal(state.memories.length, 1_001);
  assert.equal(state.memories[0]?.id, "memory_0");
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

test("passive wakeup hint is neutral and reports inactivity", async () => {
  const packet = await buildPrimeChatMessages(
    minimalPrimeAgent(),
    {
      variables: {},
      memories: [],
      mood: "",
      moodObservedAtMs: 1,
      relationshipStatus: "",
      passiveWakeup: {
        token: "wake_1",
        stage: 1,
        anchorActivityAtMs: Date.now() - 15 * 60_000,
        dueAtMs: Date.now(),
        baselineEndUserSequence: 0,
        milestonesMinutes: [15, 180, 1_440],
      },
      updatedAt: 1,
    },
    [],
    "passive_wakeup",
    "user_1",
    {} as never,
    {
      async listAvailableImages() {
        return [];
      },
    } as never,
    0,
    undefined,
    buildRuntimeConfigDefaults().primeFigure,
  );
  const userContent = packet.messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  const contextPart = userContent.at(-1);
  const serialized = String(
    contextPart && "text" in contextPart ? contextPart.text : "",
  );
  assert.match(serialized, /系统定时唤醒/);
  assert.match(serialized, /约 15 分钟/);
  assert.doesNotMatch(serialized, /挽留|召回|留存/);
});

test("prime dynamic figure context lives only in the final user packet", async () => {
  const agent = {
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
      persona: "固定人设",
      background: "固定背景",
      personality: "固定性格",
      responseStyle: "固定风格",
      decisionStyle: "",
      currentSituation: "独特处境 2026-07-14T10:30:45+08:00",
      itinerary: "独特行程",
      schedule: {
        segments: [
          {
            label: "独特日程",
            days: ["tue"],
            start: "10:00",
            end: "11:00",
            description: "独特说明 2026-07-14T10:00:30+08:00",
          },
        ],
      },
      variableDefinitions: [],
      referenceImages: [],
      voiceRequestStreaming: false,
    },
  } as PrimeFigureAgent;
  const buildPacket = (value: PrimeFigureAgent) =>
    buildPrimeChatMessages(
      value,
      {
        variables: {},
        memories: [],
        mood: "平静",
        moodObservedAtMs: 1,
        relationshipStatus: "朋友",
        updatedAt: 1,
      },
      [],
      "end_user_message",
      "user_1",
      {} as never,
      {
        async listAvailableImages() {
          return [];
        },
      } as never,
      0,
      undefined,
      buildRuntimeConfigDefaults().primeFigure,
    );
  const packet = await buildPacket(agent);
  const changed = structuredClone(agent);
  changed.detail.currentSituation = "另一个处境";
  changed.detail.itinerary = "另一个行程";
  changed.detail.schedule = { segments: [] };
  const changedPacket = await buildPacket(changed);

  const system = String(packet.messages[0]?.content);
  assert.equal(system, changedPacket.messages[0]?.content);
  assert.doesNotMatch(system, /独特处境|独特行程|独特日程|独特说明/);

  const userContent = packet.messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  const contextPart = userContent.at(-1);
  assert.equal(contextPart?.type, "text");
  const context = JSON.parse(
    String(contextPart && "text" in contextPart ? contextPart.text : "{}"),
  ) as {
    figureNow: {
      currentSituation: string;
      itinerary: string;
      schedule: PrimeFigureAgent["detail"]["schedule"];
    };
  };
  assert.equal(context.figureNow.currentSituation, "独特处境 2026-07-14T10:30");
  assert.equal(context.figureNow.itinerary, "独特行程");
  assert.deepEqual(context.figureNow.schedule, {
    segments: [
      {
        label: "独特日程",
        days: ["tue"],
        start: "10:00",
        end: "11:00",
        description: "独特说明 2026-07-14T10:00",
      },
    ],
  });
});

test("prime context exposes only the latest twenty persistent memories", async () => {
  const packet = await buildPrimeChatMessages(
    {
      id: "agent_1",
      type: "prime-figure",
      name: "Mira",
      conversationId: "conv_1",
      detail: {
        persona: "persona",
        background: "background",
        personality: "personality",
        responseStyle: "style",
        decisionStyle: "",
        currentSituation: "",
        schedule: { segments: [] },
        itinerary: "",
        variableDefinitions: [],
        referenceImages: [],
      },
    } as never,
    {
      variables: {},
      memories: Array.from({ length: 25 }, (_, index) => ({
        id: `memory_${index}`,
        content: `memory ${index}`,
        eventAtMs: index + 1,
        recordedAtMs: index + 1,
      })),
      mood: "",
      moodObservedAtMs: 1,
      relationshipStatus: "",
      updatedAt: 1,
    },
    [],
    "end_user_message",
    "user_1",
    {} as never,
    {
      async listAvailableImages() {
        return [];
      },
    } as never,
    0,
    undefined,
    buildRuntimeConfigDefaults().primeFigure,
  );

  const userContent = packet.messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  const contextPart = userContent.at(-1);
  assert.equal(contextPart?.type, "text");
  const context = JSON.parse(
    String(contextPart && "text" in contextPart ? contextPart.text : "{}"),
  ) as { memories: Array<[string, string]> };
  assert.equal(context.memories.length, 20);
  assert.equal(context.memories[0]?.[1], "memory 5");
  assert.equal(context.memories.at(-1)?.[1], "memory 24");
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
  assert.deepEqual(
    primeFigureDecisionSchema.parse({
      ...base,
      actions: [{ type: "silence", revisitAfterMinutes: 5 }],
    }).actions,
    [{ type: "silence" }],
  );
});

test("prime decision accepts omitted, empty, and expanded action and memory arrays", () => {
  const base = {
    rationale: "No response is needed",
    figureMood: "calm",
    variables: {},
  };
  assert.deepEqual(primeFigureDecisionSchema.parse(base).actions, []);
  assert.deepEqual(
    primeFigureDecisionSchema.parse({ ...base, actions: [] }).actions,
    [],
  );

  const expanded = primeFigureDecisionSchema.parse({
    ...base,
    memoryWrites: Array.from({ length: 9 }, (_, index) => ({
      content: `memory ${index}`,
      eventAt: null,
    })),
    actions: Array.from({ length: 13 }, () => ({ type: "silence" })),
  });
  assert.equal(expanded.memoryWrites.length, 9);
  assert.equal(expanded.actions.length, 13);
});

test("prime decision accepts proactive wakeup scheduling and cancellation", () => {
  const base = {
    rationale: "稍后再看",
    figureMood: "平静",
    variables: {},
  };
  assert.deepEqual(
    primeFigureDecisionSchema.parse({
      ...base,
      actions: [
        { type: "schedule_wakeup", afterMinutes: 30 },
        { type: "schedule_wakeup", afterMinutes: null },
      ],
    }).actions,
    [
      { type: "schedule_wakeup", afterMinutes: 30 },
      { type: "schedule_wakeup", afterMinutes: null },
    ],
  );
});

test("prime decision accepts mute null and strips unknown action fields", () => {
  const decision = primeFigureDecisionSchema.parse({
    rationale: "Clear mute",
    figureMood: "calm",
    variables: {},
    actions: [
      { type: "silence", ignored: true },
      { type: "mute", revisitAfterMinutes: null, ignored: true },
    ],
  });
  assert.deepEqual(decision.actions, [
    { type: "silence" },
    { type: "mute", revisitAfterMinutes: null },
  ]);
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

test("prime executor preserves mute for empty and silence-only decisions", async () => {
  for (const actions of [[], [{ type: "silence" } as const]]) {
    const result = await executePrimeDecisionCase({
      actions,
      state: {
        silenceStartedAtMs: 100,
        silenceUntilMs: Date.now() + 60_000,
      },
    });
    assert.equal(result.state.silenceStartedAtMs, 100);
    assert.ok((result.state.silenceUntilMs ?? 0) > Date.now());
    assert.equal(result.events.length, 0);
  }
});

test("prime executor clears mute for send actions and explicit null", async () => {
  const muted = {
    silenceStartedAtMs: 100,
    silenceUntilMs: Date.now() + 60_000,
  };
  const failedImage = await executePrimeDecisionCase({
    actions: [
      {
        type: "send_message",
        message: {
          type: "image",
          description: "",
          generationPrompt: "image prompt",
          referenceMediaIds: [],
        },
      },
    ],
    state: muted,
  });
  assert.equal(failedImage.messages[0]?.status, "failed");
  assert.equal(failedImage.state.silenceStartedAtMs, undefined);
  assert.equal(failedImage.state.silenceUntilMs, undefined);
  assert.equal(failedImage.events[0]?.muteUntilMs, null);

  const explicitClear = await executePrimeDecisionCase({
    actions: [{ type: "mute", revisitAfterMinutes: null }],
    state: muted,
  });
  assert.equal(explicitClear.state.silenceUntilMs, undefined);
  assert.equal(explicitClear.events[0]?.muteUntilMs, null);
});

test("prime executor gives the last numeric mute priority over send and null", async () => {
  const cutoff = 1_700_000_000_000;
  const before = Date.now();
  const result = await executePrimeDecisionCase({
    actions: [
      { type: "send_message", message: { type: "text", text: "hello" } },
      { type: "mute", revisitAfterMinutes: null },
      { type: "mute", revisitAfterMinutes: 2 },
      { type: "mute", revisitAfterMinutes: 7 },
    ],
    state: {
      silenceStartedAtMs: 100,
      silenceUntilMs: before + 60_000,
    },
    muteMessageCutoffAtMs: cutoff,
  });
  assert.equal(result.state.silenceStartedAtMs, cutoff);
  assert.ok((result.state.silenceUntilMs ?? 0) >= before + 7 * 60_000);
  assert.equal(result.events[0]?.muteUntilMs, result.state.silenceUntilMs);
});

test("prime executor appends memories without a retention cutoff", async () => {
  const memories = Array.from({ length: 1_000 }, (_, index) => ({
    id: `memory_${index}`,
    content: `memory ${index}`,
    eventAtMs: index,
    recordedAtMs: index,
  }));
  const result = await executePrimeDecisionCase({
    actions: [],
    state: { memories },
    memoryWrites: [
      { content: "memory 1000", eventAt: null },
      { content: "memory 1001", eventAt: null },
    ],
  });
  assert.equal(result.state.memories.length, 1_002);
  assert.equal(result.state.memories[0]?.id, "memory_0");
});

test("conversation previews honor the database column without truncating content", () => {
  const preview = `${"🙂".repeat(500)}tail`;
  const truncated = truncatePreview(preview);
  assert.equal(Array.from(truncated ?? "").length, 500);
  assert.equal(truncated, "🙂".repeat(500));
});

test("prime executor schedules the last proactive wakeup after same-run messages", async () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.wakeups.proactive.enabled = true;
  const result = await executePrimeDecisionCase({
    actions: [
      {
        type: "send_message",
        message: { type: "text", text: "我过一会儿再来。" },
      },
      { type: "schedule_wakeup", afterMinutes: 3 },
      { type: "schedule_wakeup", afterMinutes: 7 },
    ],
    runtimeConfig: config,
  });
  assert.equal(result.state.proactiveWakeup?.interactionAfterSequence, 1);
  assert.equal(
    result.state.proactiveWakeup!.dueAtMs -
      result.state.proactiveWakeup!.scheduledAtMs,
    7 * 60_000,
  );
});

test("proactive wakeup interaction window uses exact time and sequence boundaries", () => {
  const wakeup = {
    token: "wake_1",
    scheduledAtMs: 1_000,
    dueAtMs: 11 * 60_000,
    interactionAfterSequence: 8,
    interactionInvalidationWindowMinutes: 10,
  };
  assert.equal(invalidatesProactiveWakeup(wakeup, 9, 60_000), true);
  assert.equal(invalidatesProactiveWakeup(wakeup, 9, 11 * 60_000), true);
  assert.equal(invalidatesProactiveWakeup(wakeup, 8, 60_000), false);
  assert.equal(invalidatesProactiveWakeup(wakeup, 9, 59_999), false);
  assert.equal(
    nextPrimeRunAt({
      variables: {},
      memories: [],
      mood: "",
      moodObservedAtMs: 0,
      relationshipStatus: "",
      silenceUntilMs: 50_000,
      proactiveWakeup: wakeup,
      updatedAt: 0,
    }),
    50_000,
  );
});

test("unified scheduler publishes mute end while selecting one timed trigger", async () => {
  const events: unknown[] = [];
  const jobs: unknown[] = [];
  const scheduler = new PrimeFigureWakeupScheduler(
    {
      async claimDueWakeups() {
        return [
          {
            ownerUserId: "user_1",
            agentId: "agent_1",
            conversationId: "conv_1",
            trigger: "scheduled_wakeup" as const,
            wakeupToken: "wake_1",
            muteEnded: true,
          },
        ];
      },
    } as never,
    {
      async enqueue(job: unknown) {
        jobs.push(job);
      },
    } as never,
    {
      pushToUser(_ownerUserId: string, event: unknown) {
        events.push(event);
      },
    } as never,
  );

  await (scheduler as any).tick();

  assert.equal(events.length, 1);
  assert.deepEqual(jobs, [
    {
      ownerUserId: "user_1",
      conversationId: "conv_1",
      kind: "prime-figure",
      trigger: "scheduled_wakeup",
      wakeupToken: "wake_1",
      passiveStage: undefined,
    },
  ]);
});

test("prime executor advances and exhausts passive wakeup milestones", async () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.wakeups.passive.enabled = true;
  const first = await executePrimeDecisionCase({
    actions: [{ type: "silence" }],
    runtimeConfig: config,
    trigger: "passive_wakeup",
    wakeupToken: "wake_1",
    passiveStage: 1,
    state: {
      passiveWakeup: {
        token: "wake_1",
        stage: 1,
        anchorActivityAtMs: 100,
        dueAtMs: 200,
        baselineEndUserSequence: 4,
        milestonesMinutes: [15, 180, 1_440],
      },
    },
    inputThroughEndUserSeq: 4,
  });
  assert.equal(first.state.passiveWakeup?.stage, 2);
  assert.equal(
    first.state.passiveWakeup!.dueAtMs -
      first.state.passiveWakeup!.anchorActivityAtMs,
    165 * 60_000,
  );

  const third = await executePrimeDecisionCase({
    actions: [],
    runtimeConfig: config,
    trigger: "passive_wakeup",
    wakeupToken: "wake_3",
    passiveStage: 3,
    state: {
      passiveWakeup: {
        token: "wake_3",
        stage: 3,
        anchorActivityAtMs: 100,
        dueAtMs: 200,
        baselineEndUserSequence: 4,
        milestonesMinutes: [15, 180, 1_440],
      },
    },
    inputThroughEndUserSeq: 4,
  });
  assert.equal(third.state.passiveWakeup, undefined);
  assert.equal(third.state.passiveWakeupExhaustedAfterEndUserSequence, 4);

  const restarted = await executePrimeDecisionCase({
    actions: [],
    runtimeConfig: config,
    state: { passiveWakeupExhaustedAfterEndUserSequence: 4 },
    inputThroughEndUserSeq: 5,
  });
  assert.equal(restarted.state.passiveWakeup?.stage, 1);
  assert.equal(restarted.state.passiveWakeup?.baselineEndUserSequence, 5);
});

async function executePrimeDecisionCase(input: {
  actions: PrimeFigureAction[];
  state?: Partial<PrimeFigureState>;
  memoryWrites?: PrimeFigureDecision["memoryWrites"];
  muteMessageCutoffAtMs?: number;
  runtimeConfig?: ReturnType<typeof buildRuntimeConfigDefaults>["primeFigure"];
  trigger?: "end_user_message" | "scheduled_wakeup" | "passive_wakeup";
  wakeupToken?: string;
  passiveStage?: 1 | 2 | 3;
  inputThroughEndUserSeq?: number;
}) {
  let savedState: PrimeFigureState | undefined;
  const messages: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
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
      async save(message: Record<string, unknown>) {
        const saved = { ...message, sequence: messages.length + 1 };
        messages.push(saved);
        return saved;
      },
    } as never,
    { async save() {} } as never,
    { async updatePreview() {} } as never,
    {
      pushToUser(_ownerUserId: string, event: Record<string, unknown>) {
        events.push(event);
      },
    } as never,
  );

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
      ...input.state,
    },
    decision: {
      rationale: "test",
      figureMood: "calm",
      variables: {},
      memoryWrites: input.memoryWrites ?? [],
      actions: input.actions,
    },
    providerId: "test-provider",
    model: "test-model",
    muteMessageCutoffAtMs: input.muteMessageCutoffAtMs,
    runtimeConfig: input.runtimeConfig,
    trigger: input.trigger,
    wakeupToken: input.wakeupToken,
    passiveStage: input.passiveStage,
    inputThroughEndUserSeq: input.inputThroughEndUserSeq,
  });

  if (!savedState) throw new Error("Expected prime state to be saved.");
  return { state: savedState, messages, events };
}

function minimalPrimeAgent(): PrimeFigureAgent {
  return {
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
  };
}
