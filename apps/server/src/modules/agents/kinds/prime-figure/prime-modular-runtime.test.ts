import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeFigureAgent, PrimeFigureDecision } from "@echoo/shared";
import { buildRuntimeConfigDefaults } from "../../../runtime-config/runtime-config.defaults.js";
import { PrimeContentOptimizer } from "./prime-content-optimizer.js";
import {
  buildPrimeDecisionResponseFormat,
  parsePrimeDecisionEnvelope,
  PrimeFigureRuntimeService,
} from "./prime-figure-runtime.service.js";
import { PrimeMediaAnnotationService } from "./prime-media-annotation.service.js";
import { primeModelSessionId } from "./prime-model-session.js";
import { buildPrimeSystemPrompt } from "./prime-prompt-composer.js";

test("prime prompt and response schema track every output capability combination", () => {
  for (const imageEnabled of [false, true]) {
    for (const voiceEnabled of [false, true]) {
      const config = buildRuntimeConfigDefaults().primeFigure;
      config.outputs.image.enabled = imageEnabled;
      config.outputs.voice.enabled = voiceEnabled;
      const prompt = buildPrimeSystemPrompt(promptAgent(), config);
      const schema = JSON.stringify(
        buildPrimeDecisionResponseFormat(promptAgent(), config, false, [], []),
      );

      assert.equal(/image 注意事项/.test(prompt), imageEnabled);
      assert.equal(/暂不支持image action/.test(prompt), !imageEnabled);
      assert.equal(/generationPrompt/.test(schema), imageEnabled);
      assert.equal(/voice 注意事项/.test(prompt), voiceEnabled);
      assert.equal(/暂不支持voice action/.test(prompt), !voiceEnabled);
      assert.equal(/transcript/.test(schema), voiceEnabled);
      assert.match(schema, /"text"/);
    }
  }
});

test("sticker and transfer capabilities compose prompts, schema, and dynamic IDs", () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  const agent = promptAgent();
  const disabledPrompt = buildPrimeSystemPrompt(agent, config);
  assert.match(disabledPrompt, /figure不能发送表情/);
  assert.match(disabledPrompt, /figure不能发送、接收或拒收转账/);

  config.outputs.sticker.enabled = true;
  config.outputs.transfer.enabled = true;
  const prompt = buildPrimeSystemPrompt(agent, config);
  const schema = JSON.stringify(
    buildPrimeDecisionResponseFormat(
      agent,
      config,
      false,
      [],
      [],
      false,
      ["sticker_1"],
      ["msg_transfer_1"],
    ),
  );
  assert.match(prompt, /availableStickers/);
  assert.match(prompt, /operation=accept或reject/);
  assert.match(schema, /sticker_1/);
  assert.match(schema, /msg_transfer_1/);
  assert.match(schema, /multipleOf/);

  const parsed = parsePrimeDecisionEnvelope(
    JSON.stringify({
      rationale: "回应转账",
      figureMood: "开心",
      actions: [
        {
          type: "send_message",
          message: { type: "sticker", stickerId: "sticker_1" },
        },
        {
          type: "transfer",
          operation: "accept",
          transferId: "msg_transfer_1",
        },
        {
          type: "transfer",
          operation: "reject",
          transferId: "stale_transfer",
        },
      ],
    }),
    agent,
    [],
    [],
    config,
    ["sticker_1"],
    ["msg_transfer_1"],
  );
  assert.equal(parsed.decision.actions.length, 2);
  assert.deepEqual(parsed.sourceActionIndices, [0, 1]);
});

test("prime variable capability disappears from prompts, schema, and validation", () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  const withoutVariables = promptAgent();
  const withoutVariablePrompt = buildPrimeSystemPrompt(
    withoutVariables,
    config,
  );
  const withoutVariableSchema = JSON.stringify(
    buildPrimeDecisionResponseFormat(withoutVariables, config, false, [], []),
  );
  assert.doesNotMatch(withoutVariablePrompt, /变量/);
  assert.doesNotMatch(withoutVariableSchema, /variables|变量/);

  const ignored = parsePrimeDecisionEnvelope(
    JSON.stringify({
      rationale: "回应",
      figureMood: "平静",
      variables: "模型误输出的无效字段",
      actions: [],
    }),
    withoutVariables,
    [],
    [],
    config,
  );
  assert.deepEqual(ignored.decision.variables, {});

  const withVariables = promptAgent();
  withVariables.detail.variableDefinitions = [
    {
      key: "trust",
      label: "信任",
      type: "number",
      description: "figure 对 end_user 的信任程度",
    },
  ];
  assert.match(buildPrimeSystemPrompt(withVariables, config), /变量：/);
  assert.match(
    JSON.stringify(
      buildPrimeDecisionResponseFormat(withVariables, config, false, [], []),
    ),
    /variables|变量/,
  );
  assert.throws(() =>
    parsePrimeDecisionEnvelope(
      JSON.stringify({
        rationale: "回应",
        figureMood: "平静",
        variables: "无效字段",
        actions: [],
      }),
      withVariables,
      [],
      [],
      config,
    ),
  );
});

test("prime recall guidance is composed only with the recall tool", () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  const agent = promptAgent();
  const unavailablePrompt = buildPrimeSystemPrompt(agent, config);
  const unavailableSchema = JSON.stringify(
    buildPrimeDecisionResponseFormat(agent, config, false, [], []),
  );
  assert.doesNotMatch(unavailablePrompt, /search_recall/);
  assert.doesNotMatch(unavailableSchema, /search_recall/);

  const availablePrompt = buildPrimeSystemPrompt(agent, config, {
    recallAvailable: true,
  });
  const availableSchema = JSON.stringify(
    buildPrimeDecisionResponseFormat(agent, config, false, [], [], true),
  );
  assert.match(availablePrompt, /search_recall/);
  assert.match(availableSchema, /search_recall/);
  assert.doesNotMatch(
    availablePrompt,
    /省略.*(?:工具|tool)|(?:工具|tool).*省略/,
  );
});

test("prime runtime only sends and executes recall tools when recall is available", async () => {
  for (const recallAvailable of [false, true]) {
    const calls: any[] = [];
    let searches = 0;
    const provider = {
      id: "fake",
      async createChatCompletion(input: any) {
        calls.push(input);
        if (calls.length === 1)
          return {
            providerId: "fake",
            model: "fake",
            text: "",
            toolCalls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "search_recall",
                  arguments: '{"keywords":["旧事"],"limit":3}',
                },
              },
            ],
          };
        return {
          providerId: "fake",
          model: "fake",
          text: JSON.stringify({
            rationale: "回应",
            figureMood: "平静",
            memoryWrites: [{ content: "整合后的记忆", eventAt: null }],
            actions: [],
          }),
        };
      },
    };
    const runtime = new PrimeFigureRuntimeService(
      {} as never,
      {} as never,
      {
        async searchByKeywords() {
          searches += 1;
          return [];
        },
      } as never,
    );
    const complete = (
      runtime as unknown as {
        completeWithOptionalRecall(input: any): Promise<unknown>;
      }
    ).completeWithOptionalRecall.bind(runtime);
    const config = buildRuntimeConfigDefaults().primeFigure;
    await complete({
      request: {
        ownerUserId: "user_1",
        agent: promptAgent(),
        state: { variables: {}, memories: [] },
        runtimeConfig: config,
      },
      provider,
      completionBase: {
        model: "fake",
        temperature: 0,
        maxTokens: 1_000,
        reasoningMode: "disabled",
      },
      packet: {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "user" },
        ],
        pendingMedia: [],
        availableReferenceImages: [],
        recallAvailable,
      },
      streamSession: { handleField() {} },
      diagnostics: { rawResponse: "", providerId: "fake", model: "fake" },
    });

    assert.equal("tools" in calls[0], recallAvailable);
    assert.equal(calls.length, recallAvailable ? 2 : 1);
    assert.equal(searches, recallAvailable ? 1 : 0);
    if (recallAvailable) {
      assert.deepEqual(
        calls[1].messages.map((message: { role: string }) => message.role),
        ["system", "user", "assistant", "tool"],
      );
      assert.equal(
        calls[1].responseFormat.json_schema.schema.properties.memoryWrites
          .minItems,
        1,
      );
    }
  }
});

test("disabled output actions are ignored before validation and retain source indices", () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.outputs.image.enabled = false;
  config.outputs.voice.enabled = false;
  const envelope = parsePrimeDecisionEnvelope(
    JSON.stringify({
      rationale: "只执行当前支持的动作",
      figureMood: "平静",
      variables: {},
      stateUpdates: { currentSituation: "新的处境" },
      actions: [
        { type: "voice", message: { type: "voice" } },
        { type: "send_message", message: { type: "text", text: "保留" } },
        { type: "image" },
        { type: "mute", revisitAfterMinutes: 5 },
      ],
    }),
    promptAgent(),
    [],
    [],
    config,
  );

  assert.deepEqual(envelope.decision.actions, [
    { type: "send_message", message: { type: "text", text: "保留" } },
    { type: "mute", revisitAfterMinutes: 5 },
  ]);
  assert.deepEqual(envelope.sourceActionIndices, [1, 3]);
  assert.equal(envelope.decision.stateUpdates?.currentSituation, "新的处境");

  const ignoredOnly = parsePrimeDecisionEnvelope(
    JSON.stringify({
      rationale: "能力已关闭",
      figureMood: "平静",
      variables: {},
      actions: [
        { type: "send_message", message: { type: "voice" } },
        { type: "image", message: { type: "image" } },
      ],
    }),
    promptAgent(),
    [],
    [],
    config,
  );
  assert.deepEqual(ignoredOnly.decision.actions, []);
  assert.deepEqual(ignoredOnly.sourceActionIndices, []);
});

test("proactive wakeup action follows its capability boundary", () => {
  const disabled = buildRuntimeConfigDefaults().primeFigure;
  const disabledPrompt = buildPrimeSystemPrompt(promptAgent(), disabled);
  const disabledSchema = JSON.stringify(
    buildPrimeDecisionResponseFormat(promptAgent(), disabled, false, [], []),
  );
  assert.match(disabledPrompt, /未开放 schedule_wakeup/);
  assert.doesNotMatch(disabledSchema, /schedule_wakeup/);
  assert.deepEqual(
    parsePrimeDecisionEnvelope(
      JSON.stringify({
        rationale: "能力关闭",
        figureMood: "平静",
        variables: {},
        actions: [{ type: "schedule_wakeup", afterMinutes: 5 }],
      }),
      promptAgent(),
      [],
      [],
      disabled,
    ).decision.actions,
    [],
  );

  const enabled = structuredClone(disabled);
  enabled.wakeups.proactive.enabled = true;
  assert.match(buildPrimeSystemPrompt(promptAgent(), enabled), /安排若干分钟/);
  assert.match(
    JSON.stringify(
      buildPrimeDecisionResponseFormat(promptAgent(), enabled, false, [], []),
    ),
    /schedule_wakeup/,
  );
});

test("enabled malformed and unknown actions remain invalid", () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  const base = {
    rationale: "测试严格边界",
    figureMood: "平静",
    variables: {},
  };
  assert.throws(() =>
    parsePrimeDecisionEnvelope(
      JSON.stringify({
        ...base,
        actions: [{ type: "voice", message: { type: "voice" } }],
      }),
      promptAgent(),
      [],
      [],
      config,
    ),
  );
  assert.throws(() =>
    parsePrimeDecisionEnvelope(
      JSON.stringify({ ...base, actions: [{ type: "teleport" }] }),
      promptAgent(),
      [],
      [],
      config,
    ),
  );
});

test("prime prompt stays strict while the decision schema remains tolerant", () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  const prompt = buildPrimeSystemPrompt(promptAgent(), config);
  const response = buildPrimeDecisionResponseFormat(
    promptAgent(),
    config,
    false,
    [],
    [],
  ) as any;
  const schema = response.json_schema.schema;
  const actions = schema.properties.actions;
  const memoryWrites = schema.properties.memoryWrites;

  assert.equal(response.json_schema.strict, false);
  assert.equal(schema.required.includes("actions"), false);
  assert.equal("minItems" in actions, false);
  assert.equal("maxItems" in actions, false);
  assert.ok(Array.isArray(actions.items.anyOf));
  assert.equal("maxItems" in memoryWrites, false);
  assert.match(prompt, /revisitAfterMinutes.*null.*解除/);
  assert.match(prompt, /只返回符合严格 schema 的 JSON/);
  assert.doesNotMatch(
    prompt,
    /互斥|唯一动作|没有数量限制|宽松处理|发送消息.*解除.*mute/,
  );
});

test("prime prompt guidance levels are independently composable", () => {
  const basic = buildRuntimeConfigDefaults().primeFigure;
  basic.outputs.image.guidanceLevel = "basic";
  basic.outputs.voice.guidanceLevel = "basic";
  const advanced = structuredClone(basic);
  advanced.outputs.image.guidanceLevel = "advanced";
  advanced.outputs.voice.guidanceLevel = "advanced";
  assert.doesNotMatch(buildPrimeSystemPrompt(promptAgent(), basic), /高级要求/);
  const advancedPrompt = buildPrimeSystemPrompt(promptAgent(), advanced);
  assert.match(advancedPrompt, /参考图人物身份/);
  assert.match(advancedPrompt, /情绪发展安排重音/);
});

test("auxiliary visual and audio understanding run separately and return keyed annotations", async () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.understanding.visual.mode = "auxiliary";
  config.understanding.audio.mode = "auxiliary";
  const calls: Array<{ system: string; sessionId?: string }> = [];
  const service = new PrimeMediaAnnotationService(
    {
      createProvider() {
        return {
          id: "fake",
          async createChatCompletion(input: any) {
            const system = String(input.messages[0]?.content);
            calls.push({ system, sessionId: input.sessionId });
            return {
              providerId: "fake",
              model: "fake",
              text: system.includes("转写")
                ? JSON.stringify({
                    annotations: [
                      { id: "media_2", type: "voice", transcript: "你好" },
                    ],
                  })
                : JSON.stringify({
                    annotations: [
                      {
                        id: "media_1",
                        type: "image",
                        description: "窗边的一杯咖啡",
                      },
                    ],
                  }),
            };
          },
        };
      },
    } as never,
    {
      async readForOwner(_owner: string, id: string) {
        return {
          record: {
            mimeType: id === "voice" ? "audio/mpeg" : "image/jpeg",
          },
          data: Buffer.from("media"),
        };
      },
    } as never,
  );
  const annotations = await service.annotate(
    "user_1",
    "conversation_1",
    [
      { id: "media_1", messageId: "m1", type: "image", resourceId: "image" },
      { id: "media_2", messageId: "m2", type: "voice", resourceId: "voice" },
    ],
    config,
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.sessionId).sort(),
    [
      primeModelSessionId("conversation_1", "audio"),
      primeModelSessionId("conversation_1", "visual"),
    ].sort(),
  );
  assert.deepEqual(annotations.map((item) => item.id).sort(), [
    "media_1",
    "media_2",
  ]);
});

test("extra optimizers replace media drafts and expose voice deltas", async () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.optimization.image.enabled = true;
  config.optimization.voice.enabled = true;
  const sessionIds: string[] = [];
  const optimizer = new PrimeContentOptimizer({
    createProvider() {
      return {
        id: "fake",
        async createChatCompletion(input: any) {
          sessionIds.push(input.sessionId);
          return {
            providerId: "fake",
            model: "fake",
            text: JSON.stringify({ generationPrompt: "优化后的图片提示词" }),
          };
        },
        async *streamChatCompletion(input: any) {
          sessionIds.push(input.sessionId);
          yield { text: '{"transcript":"[轻声]' };
          yield { text: '你好"}' };
        },
      };
    },
  } as never);
  const voiceDeltas: string[] = [];
  const result = await optimizer.optimizeDecision(
    mediaDecision(),
    config,
    "conversation_1",
    { onVoiceDelta: (_index, delta) => voiceDeltas.push(delta) },
  );
  assert.equal(
    result.actions[0]?.type === "send_message" &&
      result.actions[0].message.type === "image"
      ? result.actions[0].message.generationPrompt
      : "",
    "优化后的图片提示词",
  );
  assert.equal(
    result.actions[1]?.type === "send_message" &&
      result.actions[1].message.type === "voice"
      ? result.actions[1].message.transcript
      : "",
    "[轻声]你好",
  );
  assert.equal(voiceDeltas.join(""), "[轻声]你好");
  assert.deepEqual(
    sessionIds.sort(),
    [
      primeModelSessionId("conversation_1", "image-optimizer"),
      primeModelSessionId("conversation_1", "voice-optimizer"),
    ].sort(),
  );
});

test("extra optimizer failures fall back to decision drafts", async () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.optimization.image.enabled = true;
  config.optimization.voice.enabled = true;
  const failures: string[] = [];
  const optimizer = new PrimeContentOptimizer({
    createProvider() {
      return {
        id: "fake",
        async createChatCompletion() {
          throw new Error("optimizer unavailable");
        },
        async *streamChatCompletion() {
          throw new Error("optimizer unavailable");
        },
      };
    },
  } as never);
  const original = mediaDecision();
  const result = await optimizer.optimizeDecision(
    original,
    config,
    "conversation_1",
    { onFailure: (failure) => failures.push(failure.kind) },
  );
  assert.deepEqual(result.actions, original.actions);
  assert.deepEqual(failures.sort(), ["image", "voice"]);
});

test("prime model session ids are stable and isolated by role", () => {
  const decision = primeModelSessionId("conversation_1", "decision");
  assert.equal(decision, primeModelSessionId("conversation_1", "decision"));
  assert.ok(decision.length <= 22);
  assert.notEqual(decision, primeModelSessionId("conversation_1", "visual"));
  assert.notEqual(decision, primeModelSessionId("conversation_2", "decision"));
});

function promptAgent(): PrimeFigureAgent {
  return {
    id: "agent_1",
    ownerUserId: "user_1",
    type: "prime-figure",
    name: "Mira",
    attributes: [],
    tags: [],
    introduction: "",
    isPublic: false,
    conversationId: "conversation_1",
    createdAt: 1,
    updatedAt: 1,
    detail: {
      prologueHtml: "",
      linkedAgentIds: [],
      persona: "人设",
      background: "背景",
      personality: "性格",
      responseStyle: "回复风格",
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

function mediaDecision(): PrimeFigureDecision {
  return {
    rationale: "发送媒体",
    figureMood: "轻松",
    variables: {},
    actions: [
      {
        type: "send_message",
        message: {
          type: "image",
          description: "咖啡",
          generationPrompt: "原图片提示词",
          referenceMediaIds: [],
        },
      },
      {
        type: "send_message",
        message: { type: "voice", transcript: "你好" },
      },
    ],
  };
}
