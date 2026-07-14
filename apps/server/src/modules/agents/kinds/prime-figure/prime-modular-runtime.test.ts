import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeFigureAgent, PrimeFigureDecision } from "@echoo/shared";
import { buildRuntimeConfigDefaults } from "../../../runtime-config/runtime-config.defaults.js";
import { PrimeContentOptimizer } from "./prime-content-optimizer.js";
import { buildPrimeDecisionResponseFormat } from "./prime-figure-runtime.service.js";
import { PrimeMediaAnnotationService } from "./prime-media-annotation.service.js";
import { buildPrimeSystemPrompt } from "./prime-prompt-composer.js";

test("prime prompt and response schema remove disabled media capabilities", () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.outputs.image.enabled = false;
  config.outputs.voice.enabled = false;
  const prompt = buildPrimeSystemPrompt(promptAgent(), config);
  const schema = JSON.stringify(
    buildPrimeDecisionResponseFormat(promptAgent(), config, false, [], []),
  );
  assert.doesNotMatch(prompt, /image 注意事项|voice 注意事项/);
  assert.doesNotMatch(schema, /generationPrompt|transcript/);
  assert.match(schema, /"text"/);
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
  const calls: string[] = [];
  const service = new PrimeMediaAnnotationService(
    {
      createProvider() {
        return {
          id: "fake",
          async createChatCompletion(input: any) {
            const system = String(input.messages[0]?.content);
            calls.push(system);
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
    [
      { id: "media_1", messageId: "m1", type: "image", resourceId: "image" },
      { id: "media_2", messageId: "m2", type: "voice", resourceId: "voice" },
    ],
    config,
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(annotations.map((item) => item.id).sort(), [
    "media_1",
    "media_2",
  ]);
});

test("extra optimizers replace media drafts and expose voice deltas", async () => {
  const config = buildRuntimeConfigDefaults().primeFigure;
  config.optimization.image.enabled = true;
  config.optimization.voice.enabled = true;
  const optimizer = new PrimeContentOptimizer({
    createProvider() {
      return {
        id: "fake",
        async createChatCompletion() {
          return {
            providerId: "fake",
            model: "fake",
            text: JSON.stringify({ generationPrompt: "优化后的图片提示词" }),
          };
        },
        async *streamChatCompletion() {
          yield { text: '{"transcript":"[轻声]' };
          yield { text: '你好"}' };
        },
      };
    },
  } as never);
  const voiceDeltas: string[] = [];
  const result = await optimizer.optimizeDecision(mediaDecision(), config, {
    onVoiceDelta: (_index, delta) => voiceDeltas.push(delta),
  });
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
  const result = await optimizer.optimizeDecision(original, config, {
    onFailure: (failure) => failures.push(failure.kind),
  });
  assert.deepEqual(result.actions, original.actions);
  assert.deepEqual(failures.sort(), ["image", "voice"]);
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
