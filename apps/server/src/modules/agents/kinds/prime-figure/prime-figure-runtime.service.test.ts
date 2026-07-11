import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  CreatePrimeFigureRequest,
  PrimeFigureDecision,
} from "@echoo/shared";
import { primeFigureDecisionSchema } from "@echoo/shared";
import {
  closeDatabase,
  getDatabase,
} from "../../../../infra/database/sqlite.js";
import type {
  ChatCompletionContentPart,
  ChatCompletionInput,
  ChatCompletionResult,
  AiTextProvider,
} from "../../../ai/ai-provider.interface.js";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import { AgentRepository } from "../../agent.repository.js";
import { MessageRepository } from "../../../messaging/message.repository.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { FishAudioTtsService } from "../../../tts/fish-audio-tts.service.js";
import { OpenRouterImageGenerationService } from "../../../image-generation/openrouter-image-generation.service.js";
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";
import { PrimeActionExecutor } from "./prime-action-executor.js";
import { PrimeFigureHandler } from "./prime-figure.handler.js";
import { PrimeMessageRepository } from "./prime-message.repository.js";
import { PrimeFigureRuntimeService } from "./prime-figure-runtime.service.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";
import { PrimeConversationMediaRepository } from "./prime-conversation-media.repository.js";
import { PrimeDecisionStreamSession } from "./prime-decision-stream-session.js";
import { formatReadableMinute, parseReadableMinute } from "./prime-time.js";

class FakeProvider implements AiTextProvider {
  readonly id = "openrouter" as const;
  readonly inputs: ChatCompletionInput[] = [];

  constructor(private readonly responses: ChatCompletionResult[]) {}

  async createChatCompletion(input: ChatCompletionInput) {
    this.inputs.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected model call.");
    return response;
  }

  async *streamChatCompletion(input: ChatCompletionInput) {
    this.inputs.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected model call.");
    for (let index = 0; index < response.text.length; index += 11)
      yield { text: response.text.slice(index, index + 11) };
    if (response.toolCalls?.length) {
      yield {
        toolCalls: response.toolCalls.map((call, index) => ({
          index,
          id: call.id,
          type: call.type,
          function: call.function,
        })),
      };
    }
  }
}

class FakeRegistry {
  constructor(private readonly provider: FakeProvider) {}
  getDefaultProvider() {
    return this.provider;
  }
  getDefaultModel() {
    return "test/prime-figure";
  }
}

test("Prime Figure V2 runs strict reply, recall, and persisted silence end to end", async () => {
  const directory = mkdtempSync(join(tmpdir(), "echoo-prime-v2-"));
  process.env.AUTH_DATABASE_FILE = join(directory, "test.sqlite");

  try {
    const db = getDatabase();
    const now = Date.now();
    db.prepare(
      "INSERT INTO auth_users (id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "user_prime_test",
      "prime@example.test",
      "Prime Tester",
      "test",
      now,
      now,
    );

    const request: CreatePrimeFigureRequest = {
      type: "prime-figure",
      name: "Mira",
      isPublic: false,
      persona: "A self-directed long-term companion.",
      background: "Keeps her own routine and remembers meaningful events.",
      personality: "Reserved, perceptive, and not eager to please.",
      responseStyle: "Short natural Chinese messages.",
      decisionStyle: "Protect continuity and personal boundaries.",
      currentSituation: "Living an ordinary weekday routine.",
      schedule: {
        timezone: "Asia/Shanghai",
        segments: [
          {
            label: "夜间独处",
            days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            start: "20:00",
            end: "23:59",
            description: "通常准备休息，回复会比较短。",
          },
        ],
      },
      itinerary: "2026-07-12T09:30 前往上海。",
      variableDefinitions: [
        {
          key: "trust",
          label: "信任",
          type: "number",
          description: "Figure此刻对enduser的信任程度。",
          defaultValue: 40,
          min: 0,
          max: 100,
        },
      ],
      initialMood: "平静",
      initialRelationshipStatus: "熟悉但有边界",
    };
    const agent = new PrimeFigureHandler().create("user_prime_test", request);
    assert.equal(agent.type, "prime-figure");

    const primeMessages = new PrimeMessageRepository();
    const states = new PrimeFigureStateRepository();
    primeMessages.save({
      ownerUserId: "user_prime_test",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: { type: "text", text: "你还在生气吗？" },
      occurredAtMs: now,
      timezone: "Asia/Shanghai",
    });

    const firstDecision: PrimeFigureDecision = {
      rationale: "我已经不再生气，但仍想保持一点距离。",
      figureMood: "平静但克制",
      variables: { trust: 41 },
      stateUpdates: {
        currentSituation: "刚结束一段令人疲惫的对话。",
        schedule: {
          timezone: "Asia/Shanghai",
          segments: [
            {
              label: "晚间休息",
              days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
              start: "21:00",
              end: "23:59",
              description: "减少社交，准备休息。",
            },
          ],
        },
        itinerary: "2026-07-13T10:00 处理个人事务。",
        relationshipStatus: "熟悉，但暂时需要一点距离",
      },
      actions: [
        {
          type: "send_message",
          message: { type: "text", text: "没有。" },
        },
        {
          type: "send_message",
          message: { type: "text", text: "只是刚才不太想说话。" },
        },
      ],
    };
    const firstProvider = new FakeProvider([result(firstDecision)]);
    await createRuntime(firstProvider).requestDecision({
      ownerUserId: "user_prime_test",
      conversationId: agent.conversationId,
    });

    assert.equal(
      firstProvider.inputs.length,
      1,
      "ordinary decision should use one model request",
    );
    assert.equal(
      firstProvider.inputs[0]?.tools?.[0]?.function.name,
      "search_recall",
      "recall tool is exposed on every request",
    );
    assert.equal(
      (
        firstProvider.inputs[0]?.responseFormat as {
          json_schema?: { strict?: boolean };
        }
      ).json_schema?.strict,
      true,
    );
    const responseSchema =
      (
        firstProvider.inputs[0]?.responseFormat as {
          json_schema?: { schema?: Record<string, unknown> };
        }
      ).json_schema?.schema ?? {};
    assertSchemaFieldDescriptions(responseSchema);
    const stateUpdatesSchema = schemaProperty(responseSchema, "stateUpdates");
    const scheduleSchema = schemaProperty(stateUpdatesSchema, "schedule");
    const scheduleObjectSchema =
      (
        scheduleSchema.anyOf as Array<Record<string, unknown>> | undefined
      )?.find((schema) => schema.type === "object") ?? {};
    const segmentsSchema = schemaProperty(scheduleObjectSchema, "segments");
    assert.equal(
      segmentsSchema.maxItems,
      undefined,
      "Gemini response schema must not carry the nested schedule maxItems limit",
    );
    assert.throws(
      () =>
        primeFigureDecisionSchema.parse({
          ...firstDecision,
          stateUpdates: {
            schedule: {
              timezone: "Asia/Shanghai",
              segments: Array.from({ length: 101 }, (_, index) => ({
                label: `时段${index}`,
                days: ["mon"],
                start: "09:00",
                end: "10:00",
                description: "测试日程",
              })),
            },
          },
        }),
      "the server must retain the 100-segment validation limit",
    );
    const firstPacket = JSON.stringify(firstProvider.inputs[0]?.messages);
    assert.doesNotMatch(
      firstPacket,
      /\b1\d{12}\b/,
      "LLM packet must not contain millisecond timestamps",
    );
    assert.doesNotMatch(
      firstPacket,
      /pmsg_|pmem_|agent_|conv_/,
      "LLM packet must not contain persistence IDs",
    );
    assert.equal(
      new MessageRepository()
        .listByConversation("user_prime_test", agent.conversationId)
        .at(-1)?.content.text,
      "只是刚才不太想说话。",
    );
    assert.equal(
      states.findByAgent("user_prime_test", agent.id)?.mood,
      "平静但克制",
    );
    assert.equal(
      states.findByAgent("user_prime_test", agent.id)?.variables.trust,
      41,
    );
    assert.equal(
      states.findByAgent("user_prime_test", agent.id)?.relationshipStatus,
      "熟悉，但暂时需要一点距离",
    );
    const updatedAgent = new AgentRepository().findById(
      "user_prime_test",
      agent.id,
    );
    assert.equal(
      updatedAgent?.type === "prime-figure"
        ? updatedAgent.detail.currentSituation
        : undefined,
      "刚结束一段令人疲惫的对话。",
    );
    assert.equal(
      updatedAgent?.type === "prime-figure"
        ? updatedAgent.detail.schedule.segments[0]?.label
        : undefined,
      "晚间休息",
    );
    assert.equal(
      updatedAgent?.type === "prime-figure"
        ? updatedAgent.detail.itinerary
        : undefined,
      "2026-07-13T10:00 处理个人事务。",
    );
    assert.equal(
      new MessageRepository()
        .listByConversation("user_prime_test", agent.conversationId)
        .filter((message) => message.role === "assistant").length,
      2,
      "one decision may persist multiple ordered send_message actions",
    );
    const userParts = getUserContentParts(firstProvider.inputs[0]!);
    const packet = JSON.parse(getTextPart(userParts.at(-1))) as {
      now?: string;
      weekday?: string;
    };
    assert.match(packet.now ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.match(packet.weekday ?? "", /^(mon|tue|wed|thu|fri|sat|sun)$/);
    assert.equal("timezone" in packet, false);
    assert.equal("currentTime" in packet, false);
    const rationaleRows = getDatabase()
      .prepare(
        "SELECT rationale FROM prime_action_logs WHERE agent_id = ? AND action_type = 'send_message' ORDER BY created_at, id",
      )
      .all(agent.id) as Array<{ rationale: string | null }>;
    assert.equal(rationaleRows.length, 2);
    assert.ok(
      rationaleRows.every((row) => row.rationale === firstDecision.rationale),
      "the decision rationale must be stored with every applied action",
    );

    const oldEventAt = now - 90 * 24 * 60 * 60_000;
    primeMessages.save({
      ownerUserId: "user_prime_test",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: { type: "text", text: "我最喜欢白色郁金香。" },
      occurredAtMs: oldEventAt,
      timezone: "Asia/Shanghai",
    });
    primeMessages.save({
      ownerUserId: "user_prime_test",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: { type: "text", text: "你还记得我最喜欢什么花吗？" },
      occurredAtMs: now + 1000,
      timezone: "Asia/Shanghai",
    });

    const recallDecision: PrimeFigureDecision = {
      rationale: "旧对话能够确认这件事，我会把它整理成稳定记忆。",
      figureMood: "平静，略带无奈",
      variables: { trust: 42 },
      memoryWrites: [
        {
          content: "enduser最喜欢白色郁金香。",
          eventAt: formatReadableMinute(oldEventAt, "Asia/Shanghai"),
        },
      ],
      actions: [
        {
          type: "send_message",
          message: { type: "text", text: "白色郁金香。" },
        },
      ],
    };
    const recallProvider = new FakeProvider([
      {
        providerId: "openrouter",
        model: "test/prime-figure",
        text: "",
        toolCalls: [
          {
            id: "call_recall",
            type: "function",
            function: {
              name: "search_recall",
              arguments: '{"keywords":["白色","郁金香"],"limit":6}',
            },
          },
        ],
      },
      result(recallDecision),
    ]);
    await createRuntime(recallProvider).requestDecision({
      ownerUserId: "user_prime_test",
      conversationId: agent.conversationId,
    });
    assert.equal(recallProvider.inputs.length, 2);
    const recallToolContent =
      recallProvider.inputs[1]?.messages.find(
        (message) => message.role === "tool",
      )?.content ?? "";
    assert.ok(typeof recallToolContent === "string");
    const recallToolResult = recallToolContent;
    assert.match(recallToolResult, /^\{"history":/);
    assert.doesNotMatch(recallToolResult, /pmsg_|\b1\d{12}\b/);
    assert.equal(
      states.findByAgent("user_prime_test", agent.id)?.memories.at(-1)
        ?.eventAtMs,
      parseReadableMinute(
        formatReadableMinute(oldEventAt, "Asia/Shanghai"),
        "Asia/Shanghai",
      ),
    );

    primeMessages.save({
      ownerUserId: "user_prime_test",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: { type: "text", text: "你怎么不说话？" },
      occurredAtMs: now + 2000,
      timezone: "Asia/Shanghai",
    });
    const silenceDecision: PrimeFigureDecision = {
      rationale: "我现在不想继续这段交流，需要独处。",
      figureMood: "烦躁并想保持距离",
      variables: { trust: 39 },
      memoryWrites: [],
      stateUpdates: {
        relationshipStatus: "暂时不想交流",
      },
      actions: [{ type: "silence", revisitAfterMinutes: 1 }],
    };
    await createRuntime(
      new FakeProvider([result(silenceDecision)]),
    ).requestDecision({
      ownerUserId: "user_prime_test",
      conversationId: agent.conversationId,
    });
    const silentState = states.findByAgent("user_prime_test", agent.id);
    assert.ok(silentState?.silenceStartedAtMs && silentState.silenceUntilMs);

    primeMessages.save({
      ownerUserId: "user_prime_test",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: { type: "text", text: "我等你想说的时候再说。" },
      occurredAtMs: (silentState?.silenceStartedAtMs ?? now) + 1000,
      timezone: "Asia/Shanghai",
    });
    const suppressedProvider = new FakeProvider([]);
    await createRuntime(suppressedProvider).requestDecision({
      ownerUserId: "user_prime_test",
      conversationId: agent.conversationId,
    });
    assert.equal(
      suppressedProvider.inputs.length,
      0,
      "messages during silence must not produce an LLM packet",
    );

    states.save("user_prime_test", agent.id, {
      ...silentState!,
      silenceUntilMs: Date.now() - 1,
      updatedAt: Date.now(),
    });
    const due = states.claimDueSilences(Date.now());
    assert.equal(due.length, 1);
    assert.equal(due[0]?.hadQueuedMessages, true);
    assert.equal(
      states.claimDueSilences(Date.now()).length,
      0,
      "an expired silence window must be claimed only once",
    );
    const wakeDecision: PrimeFigureDecision = {
      rationale: "独处后情绪缓和，我愿意回应沉默期间积累的消息。",
      figureMood: "冷静下来",
      variables: { trust: 40 },
      memoryWrites: [],
      stateUpdates: {
        itinerary: "明早继续原定安排。",
        relationshipStatus: "恢复交流",
      },
      actions: [
        {
          type: "send_message",
          message: { type: "text", text: "现在可以说了。" },
        },
      ],
    };
    const wakeProvider = new FakeProvider([result(wakeDecision)]);
    await createRuntime(wakeProvider).requestDecision({
      ownerUserId: "user_prime_test",
      conversationId: agent.conversationId,
      trigger: "silence_ended",
    });
    assert.equal(wakeProvider.inputs.length, 1);
    assert.match(
      getUserContentParts(wakeProvider.inputs[0]!)
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
      /沉默期已经结束/,
    );
    assert.equal(
      states.findByAgent("user_prime_test", agent.id)?.silenceUntilMs,
      undefined,
    );
  } finally {
    closeDatabase();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.AUTH_DATABASE_FILE;
  }
});

test("Prime Figure sends raw unannotated media once and persists model annotations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "echoo-prime-media-"));
  process.env.AUTH_DATABASE_FILE = join(directory, "test.sqlite");
  process.env.RESOURCE_STORAGE_DIR = join(directory, "resources");

  try {
    const db = getDatabase();
    const now = Date.now();
    db.prepare(
      "INSERT INTO auth_users (id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("media_user", "media@example.test", "Media", "test", now, now);
    const agent = new PrimeFigureHandler().create(
      "media_user",
      createMediaPrimeRequest(),
    );
    assert.equal(agent.type, "prime-figure");

    const imagePath = join(directory, "image.jpg");
    const videoPath = join(directory, "video.mp4");
    const audioPath = join(directory, "audio.wav");
    writeFileSync(imagePath, Buffer.from("image-bytes"));
    writeFileSync(videoPath, Buffer.from("video-bytes"));
    writeFileSync(audioPath, Buffer.from("audio-bytes"));
    const insertResource = db.prepare(
      `INSERT INTO resources (id, owner_user_id, kind, mime_type, original_file_name, storage_path, public_path, created_at)
       VALUES (?, ?, 'message_media', ?, ?, ?, ?, ?)`,
    );
    insertResource.run(
      "res_image",
      "media_user",
      "image/jpeg",
      "image.jpg",
      imagePath,
      "/api/resources/res_image/file",
      now,
    );
    insertResource.run(
      "res_video",
      "media_user",
      "video/mp4",
      "video.mp4",
      videoPath,
      "/api/resources/res_video/file",
      now,
    );
    insertResource.run(
      "res_audio",
      "media_user",
      "audio/wav",
      "audio.wav",
      audioPath,
      "/api/resources/res_audio/file",
      now,
    );

    const messages = new PrimeMessageRepository();
    messages.save({
      ownerUserId: "media_user",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: {
        type: "image",
        resourceId: "res_image",
        referenceResourceUrls: [],
      },
      occurredAtMs: now,
      timezone: "Asia/Shanghai",
    });
    messages.save({
      ownerUserId: "media_user",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: { type: "video", resourceId: "res_video" },
      occurredAtMs: now + 1,
      timezone: "Asia/Shanghai",
    });
    messages.save({
      ownerUserId: "media_user",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: { type: "voice", resourceId: "res_audio" },
      occurredAtMs: now + 2,
      timezone: "Asia/Shanghai",
    });
    messages.save({
      ownerUserId: "media_user",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "prime_figure",
      content: {
        type: "sticker",
        stickerId: "sticker_wave",
        description: "挥手的贴纸",
      },
      occurredAtMs: now + 3,
      timezone: "Asia/Shanghai",
    });

    const decision: PrimeFigureDecision = {
      rationale: "我看到了对方发来的媒体。",
      figureMood: "好奇",
      variables: {},
      actions: [
        {
          type: "send_message",
          message: { type: "text", text: "都看到了。" },
        },
      ],
    };
    const provider = new FakeProvider([
      {
        providerId: "openrouter",
        model: "test/prime-figure",
        text: JSON.stringify({
          ...decision,
          mediaAnnotations: [
            { id: "media_1", type: "image", description: "窗边的女孩" },
            { id: "media_2", type: "video", description: "女孩向镜头挥手" },
            { id: "media_3", type: "voice", transcript: "你觉得怎么样" },
          ],
        }),
      },
    ]);
    await createRuntime(provider).requestDecision({
      ownerUserId: "media_user",
      conversationId: agent.conversationId,
    });

    const parts = getUserContentParts(provider.inputs[0]!);
    assert.deepEqual(
      parts.map((part) => part.type),
      [
        "text",
        "image_url",
        "text",
        "video_url",
        "text",
        "input_audio",
        "text",
        "text",
      ],
    );
    assert.match(JSON.stringify(parts), /data:image\/jpeg;base64/);
    assert.match(JSON.stringify(parts), /data:video\/mp4;base64/);
    assert.match(JSON.stringify(parts), /media_1/);
    assert.doesNotMatch(JSON.stringify(parts), /res_image|pmsg_/);
    const context = JSON.parse(getTextPart(parts.at(-1))) as {
      hints: string[];
      recent?: unknown;
      availableReferenceImages?: Array<{ id: string; description: string }>;
    };
    assert.equal(context.recent, undefined);
    assert.deepEqual(context.availableReferenceImages, []);
    assert.match(context.hints.join("\n"), /mediaAnnotations/);

    const responseSchema =
      (
        provider.inputs[0]?.responseFormat as {
          json_schema?: { schema?: Record<string, unknown> };
        }
      ).json_schema?.schema ?? {};
    const annotationSchema = schemaProperty(responseSchema, "mediaAnnotations");
    assert.equal(annotationSchema.minItems, 3);
    assert.equal(annotationSchema.maxItems, 3);

    const history = messages.listRecent("media_user", agent.id, 20);
    const imageMessage = history.find(
      (message) => message.content.type === "image",
    );
    const videoMessage = history.find(
      (message) => message.content.type === "video",
    );
    const voiceMessage = history.find(
      (message) => message.content.type === "voice",
    );
    assert.equal(
      imageMessage?.content.type === "image"
        ? imageMessage.content.description
        : undefined,
      "窗边的女孩",
    );
    assert.equal(
      videoMessage?.content.type === "video"
        ? videoMessage.content.description
        : undefined,
      "女孩向镜头挥手",
    );
    assert.equal(
      voiceMessage?.content.type === "voice"
        ? voiceMessage.content.transcript
        : undefined,
      "你觉得怎么样",
    );

    const secondProvider = new FakeProvider([result(decision)]);
    await createRuntime(secondProvider).requestDecision({
      ownerUserId: "media_user",
      conversationId: agent.conversationId,
    });
    const secondParts = getUserContentParts(secondProvider.inputs[0]!);
    assert.ok(secondParts.every((part) => part.type === "text"));
    assert.doesNotMatch(JSON.stringify(secondParts), /base64|mediaAnnotations/);
    const secondContext = JSON.parse(getTextPart(secondParts.at(-1))) as {
      availableReferenceImages: Array<{ id: string; description: string }>;
    };
    assert.deepEqual(secondContext.availableReferenceImages, [
      { id: "media_1", description: "窗边的女孩" },
    ]);
    const persistentMedia = getDatabase()
      .prepare(
        "SELECT media_id, media_type FROM prime_conversation_media WHERE conversation_id = ? ORDER BY media_index",
      )
      .all(agent.conversationId) as Array<{
      media_id: string;
      media_type: string;
    }>;
    assert.deepEqual(
      persistentMedia.map((row) => ({ ...row })),
      [
        { media_id: "media_1", media_type: "image" },
        { media_id: "media_2", media_type: "video" },
        { media_id: "media_3", media_type: "voice" },
      ],
    );
    const secondSchema =
      (
        secondProvider.inputs[0]?.responseFormat as {
          json_schema?: { schema?: Record<string, unknown> };
        }
      ).json_schema?.schema ?? {};
    assert.deepEqual(schemaProperty(secondSchema, "mediaAnnotations"), {});

    const retryMessage = messages.save({
      ownerUserId: "media_user",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: {
        type: "image",
        resourceId: "res_image",
        referenceResourceUrls: [],
      },
      occurredAtMs: now + 10,
      timezone: "Asia/Shanghai",
    });
    const duplicateProvider = new FakeProvider([
      {
        providerId: "openrouter",
        model: "test/prime-figure",
        text: JSON.stringify({
          ...decision,
          actions: [
            {
              type: "send_message",
              message: { type: "text", text: "这张也收到了。" },
            },
          ],
          mediaAnnotations: [
            { id: "media_1", type: "image", description: "描述一" },
            { id: "media_1", type: "image", description: "描述二" },
            { id: "unknown", type: "image", description: "未知媒体" },
          ],
        }),
      },
    ]);
    await createRuntime(duplicateProvider).requestDecision({
      ownerUserId: "media_user",
      conversationId: agent.conversationId,
    });
    const afterDuplicate = messages
      .listRecent("media_user", agent.id, 30)
      .find((message) => message.id === retryMessage.id);
    assert.equal(
      afterDuplicate?.content.type === "image"
        ? afterDuplicate.content.description
        : undefined,
      undefined,
      "duplicate annotations must not be persisted",
    );
    assert.equal(
      new MessageRepository()
        .listByConversation("media_user", agent.conversationId)
        .at(-1)?.content.text,
      "这张也收到了。",
      "invalid media annotations must not block the core decision",
    );

    const retryProvider = new FakeProvider([
      {
        providerId: "openrouter",
        model: "test/prime-figure",
        text: JSON.stringify({
          ...decision,
          mediaAnnotations: [
            { id: "media_1", type: "image", description: "重试后的有效描述" },
          ],
        }),
      },
    ]);
    await createRuntime(retryProvider).requestDecision({
      ownerUserId: "media_user",
      conversationId: agent.conversationId,
    });
    assert.ok(
      getUserContentParts(retryProvider.inputs[0]!).some(
        (part) => part.type === "image_url",
      ),
      "unannotated media must be retried with its raw content",
    );
    const afterRetry = messages
      .listRecent("media_user", agent.id, 30)
      .find((message) => message.id === retryMessage.id);
    assert.equal(
      afterRetry?.content.type === "image"
        ? afterRetry.content.description
        : undefined,
      "重试后的有效描述",
    );

    const outboundDecision: PrimeFigureDecision = {
      rationale: "我想用不同形式回应。",
      figureMood: "轻松",
      variables: {},
      actions: [
        {
          type: "send_message",
          message: { type: "text", text: "先听我说。" },
        },
        {
          type: "send_message",
          message: {
            type: "image",
            description: "一只趴在窗边晒太阳的橘猫",
            generationPrompt:
              "【正向提示词】一只橘猫趴在木质窗台晒太阳，午后暖光，手机随手拍。\n【负向提示词】不要专业摄影。\n【机位与身体逻辑检查】- 手机持有者在拍猫。\n【推荐比例】3:4",
            referenceMediaIds: [],
          },
        },
        {
          type: "send_message",
          message: { type: "voice", transcript: "今天的阳光真的很好。" },
        },
      ],
    };
    const outboundProvider = new FakeProvider([result(outboundDecision)]);
    await createRuntime(outboundProvider).requestDecision({
      ownerUserId: "media_user",
      conversationId: agent.conversationId,
    });

    const outboundPrimeMessages = messages
      .listRecent("media_user", agent.id, 30)
      .slice(-3);
    assert.deepEqual(
      outboundPrimeMessages.map((message) => message.content.type),
      ["text", "image", "voice"],
    );
    const outboundImage = outboundPrimeMessages[1]?.content;
    assert.match(
      outboundImage?.type === "image"
        ? (outboundImage.generationPrompt ?? "")
        : "",
      /橘猫趴在木质窗台/,
    );
    assert.deepEqual(
      outboundImage?.type === "image"
        ? outboundImage.referenceResourceUrls
        : undefined,
      [],
    );
    const outboundVoice = outboundPrimeMessages[2]?.content;
    assert.equal(
      outboundVoice?.type === "voice" ? outboundVoice.transcript : undefined,
      "今天的阳光真的很好。",
    );

    const deliveredMessages = new MessageRepository()
      .listByConversation("media_user", agent.conversationId)
      .filter((message) => message.role === "assistant")
      .slice(-3);
    assert.deepEqual(
      deliveredMessages.map((message) => message.contentType),
      ["text", "image", "voice"],
    );
    assert.equal(
      deliveredMessages[1]?.content.text,
      "一只趴在窗边晒太阳的橘猫",
    );
    assert.equal(
      deliveredMessages[1]?.metadata?.mediaIntent &&
        typeof deliveredMessages[1].metadata.mediaIntent === "object"
        ? (deliveredMessages[1].metadata.mediaIntent as { status?: string })
            .status
        : undefined,
      "generation_failed",
    );
    assert.equal(
      deliveredMessages[2]?.metadata?.mediaIntent &&
        typeof deliveredMessages[2].metadata.mediaIntent === "object"
        ? (deliveredMessages[2].metadata.mediaIntent as { status?: string })
            .status
        : undefined,
      "tts_failed",
    );
    const outboundResponseSchema = JSON.stringify(
      outboundProvider.inputs[0]?.responseFormat,
    );
    assert.match(outboundResponseSchema, /generationPrompt/);
    assert.match(outboundResponseSchema, /transcript/);
    assert.doesNotMatch(outboundResponseSchema, /等待后续生成资源的视频消息/);

    let generationReferences: Array<{ mimeType: string; data: Buffer }> = [];
    const generatedDecision: PrimeFigureDecision = {
      rationale: "我想发一张以刚才图片为人物参考的生活照。",
      figureMood: "放松",
      variables: {},
      actions: [
        {
          type: "send_message",
          message: {
            type: "image",
            description: "角色在窗边随手拍下的生活自拍",
            generationPrompt:
              "【正向提示词】前置手机自拍。\n【负向提示词】不要第三人称。\n【机位与身体逻辑检查】- 角色本人手持手机。\n【推荐比例】3:4",
            referenceMediaIds: ["media_1"],
          },
        },
      ],
    };
    const fakeImageGeneration = {
      async generate(input: {
        prompt: string;
        references: Array<{ mimeType: string; data: Buffer }>;
      }) {
        generationReferences = input.references;
        return {
          mimeType: "image/png" as const,
          data: Buffer.from("generated-png"),
          model: "test/image-model",
        };
      },
    };
    const generatedStream = await new PrimeDecisionStreamSession(
      { ownerUserId: "media_user", conversationId: agent.conversationId },
      new AppPushService(),
      new FishAudioTtsService(),
      new ResourceRepository(),
      fakeImageGeneration as unknown as OpenRouterImageGenerationService,
      new PrimeConversationMediaRepository(),
    ).finalize(generatedDecision);
    assert.deepEqual(generationReferences, [
      { mimeType: "image/jpeg", data: Buffer.from("image-bytes") },
    ]);
    const currentState = new PrimeFigureStateRepository().findByAgent(
      "media_user",
      agent.id,
    );
    assert.ok(currentState);
    new PrimeActionExecutor().executeDecision({
      ownerUserId: "media_user",
      conversationId: agent.conversationId,
      agent,
      state: currentState,
      decision: generatedDecision,
      providerId: "openrouter",
      model: "test/prime-figure",
      streamedMessageIds: generatedStream.messageIds,
      imageMedia: generatedStream.imageMedia,
      imageGenerationErrors: generatedStream.imageGenerationErrors,
    });
    const generatedMessage = new MessageRepository()
      .listByConversation("media_user", agent.conversationId)
      .at(-1);
    assert.equal(generatedMessage?.contentType, "image");
    assert.match(
      generatedMessage?.content.mediaUrl ?? "",
      /\/api\/resources\/res_/,
    );
    const generatedPrimeMessage = messages
      .listRecent("media_user", agent.id, 30)
      .at(-1)?.content;
    assert.equal(generatedPrimeMessage?.type, "image");
    assert.ok(
      generatedPrimeMessage?.type === "image" &&
        generatedPrimeMessage.resourceId?.startsWith("res_"),
    );
    assert.deepEqual(
      generatedPrimeMessage?.type === "image"
        ? generatedPrimeMessage.referenceMediaIds
        : undefined,
      ["media_1"],
    );

    const coverPath = join(directory, "cover.png");
    writeFileSync(coverPath, Buffer.from("cover-image"));
    insertResource.run(
      "res_cover",
      "media_user",
      "image/png",
      "cover.png",
      coverPath,
      "/api/resources/res_cover/file",
      now,
    );
    db.prepare("UPDATE agents SET cover_resource_path = ? WHERE id = ?").run(
      "/api/resources/res_cover/file",
      agent.id,
    );
    const coverProvider = new FakeProvider([result(decision)]);
    await createRuntime(coverProvider).requestDecision({
      ownerUserId: "media_user",
      conversationId: agent.conversationId,
    });
    const coverContext = JSON.parse(
      getTextPart(getUserContentParts(coverProvider.inputs[0]!).at(-1)),
    ) as {
      availableReferenceImages: Array<{ id: string; description: string }>;
    };
    const coverReference = coverContext.availableReferenceImages.find(
      (reference) => reference.description === "figure角色立绘",
    );
    assert.ok(coverReference);
    assert.match(coverReference.id, /^media_[1-9]\d*$/);
    assert.match(
      JSON.stringify(coverProvider.inputs[0]?.responseFormat),
      new RegExp(coverReference.id),
    );

    const invalidPath = join(directory, "invalid.txt");
    writeFileSync(invalidPath, "not an image");
    insertResource.run(
      "res_invalid",
      "media_user",
      "text/plain",
      "invalid.txt",
      invalidPath,
      "/api/resources/res_invalid/file",
      now,
    );
    messages.save({
      ownerUserId: "media_user",
      agentId: agent.id,
      conversationId: agent.conversationId,
      sender: "end_user",
      content: {
        type: "image",
        resourceId: "res_invalid",
        referenceResourceUrls: [],
      },
      occurredAtMs: now + 20,
      timezone: "Asia/Shanghai",
    });
    const invalidResourceProvider = new FakeProvider([]);
    const invalidResourceDecision = await createRuntime(
      invalidResourceProvider,
    ).requestDecision({
      ownerUserId: "media_user",
      conversationId: agent.conversationId,
    });
    assert.equal(invalidResourceDecision, null);
    assert.equal(invalidResourceProvider.inputs.length, 0);
  } finally {
    closeDatabase();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.AUTH_DATABASE_FILE;
    delete process.env.RESOURCE_STORAGE_DIR;
  }
});

function createRuntime(provider: FakeProvider) {
  return new PrimeFigureRuntimeService(
    new AgentRepository(),
    new PrimeFigureStateRepository(),
    new PrimeMessageRepository(),
    new FakeRegistry(provider) as unknown as AiProviderRegistry,
    new PrimeActionExecutor(),
    new PrimeActionLogRepository(),
  );
}

function getUserContentParts(input: ChatCompletionInput) {
  const content = input.messages.find(
    (message) => message.role === "user",
  )?.content;
  assert.ok(Array.isArray(content), "prime figure user content must be parts");
  return content as ChatCompletionContentPart[];
}

function getTextPart(part: ChatCompletionContentPart | undefined) {
  assert.equal(part?.type, "text");
  return (part as Extract<ChatCompletionContentPart, { type: "text" }>).text;
}

function result(decision: PrimeFigureDecision): ChatCompletionResult {
  return {
    providerId: "openrouter",
    model: "test/prime-figure",
    text: JSON.stringify(decision),
  };
}

function createMediaPrimeRequest(): CreatePrimeFigureRequest {
  return {
    type: "prime-figure",
    name: "Media Figure",
    isPublic: false,
    persona: "A self-directed companion.",
    background: "Lives an ordinary life.",
    personality: "Observant.",
    responseStyle: "Short messages.",
    decisionStyle: "Respond naturally.",
    currentSituation: "At home.",
    schedule: { timezone: "Asia/Shanghai", segments: [] },
    itinerary: "",
    variableDefinitions: [],
    initialMood: "平静",
    initialRelationshipStatus: "熟悉",
  };
}

function assertSchemaFieldDescriptions(
  schema: Record<string, unknown>,
  path = "root",
) {
  const properties = schema.properties as
    Record<string, Record<string, unknown>> | undefined;
  if (properties) {
    for (const [name, property] of Object.entries(properties)) {
      assert.equal(
        typeof property.description,
        "string",
        `${path}.${name} must have a schema description`,
      );
      assertSchemaFieldDescriptions(property, `${path}.${name}`);
    }
  }
  const items = schema.items as Record<string, unknown> | undefined;
  if (items) assertSchemaFieldDescriptions(items, `${path}[]`);
  const variants = schema.anyOf as Array<Record<string, unknown>> | undefined;
  variants?.forEach((variant, index) =>
    assertSchemaFieldDescriptions(variant, `${path}.anyOf[${index}]`),
  );
}

function schemaProperty(schema: Record<string, unknown>, name: string) {
  const properties = schema.properties as
    Record<string, Record<string, unknown>> | undefined;
  return properties?.[name] ?? {};
}
