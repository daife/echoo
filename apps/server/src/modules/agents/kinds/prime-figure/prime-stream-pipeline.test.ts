import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeFigureDecision } from "@echoo/shared";
import { PrimeDecisionStreamParser } from "./prime-decision-stream-parser.js";
import { PrimeDecisionStreamSession } from "./prime-decision-stream-session.js";
import { PrimeFigureRuntimeService } from "./prime-figure-runtime.service.js";
import { primeModelSessionId } from "./prime-model-session.js";

test("prime stream starts image generation as soon as prompt and references are complete", async () => {
  let generatedPrompt = "";
  let generatedSessionId = "";
  const session = createSession({
    imageGeneration: {
      async generate(input: { prompt: string; sessionId?: string }) {
        generatedPrompt = input.prompt;
        generatedSessionId = input.sessionId ?? "";
        return {
          mimeType: "image/png",
          data: Buffer.from("image"),
          model: "test-image",
        };
      },
    },
  });
  const parser = new PrimeDecisionStreamParser((event) =>
    session.handleField(event),
  );

  parser.push(
    '{"actions":[{"message":{"type":"image","description":"海边","generationPrompt":"cinematic beach","referenceMediaIds":[]}',
  );
  await tick();

  assert.equal(generatedPrompt, "cinematic beach");
  assert.equal(
    generatedSessionId,
    primeModelSessionId("conversation_1", "image-generation"),
  );
});

test("prime voice sends one complete transcript while keeping audio chunks streamed", async () => {
  const transcripts: string[] = [];
  const pushed: Array<Record<string, unknown>> = [];
  const session = createSession({
    appPush: {
      pushToUser(_ownerUserId: string, event: Record<string, unknown>) {
        pushed.push(event);
      },
    },
    tts: {
      async synthesize(transcript: string, onAudio: (chunk: Buffer) => void) {
        transcripts.push(transcript);
        onAudio(Buffer.from("voice-1"));
        onAudio(Buffer.from("voice-2"));
        return {
          audio: Buffer.from("voice-1voice-2"),
          mimeType: "audio/mpeg",
          format: "mp3",
        };
      },
    },
  });
  const parser = new PrimeDecisionStreamParser((event) =>
    session.handleField(event),
  );

  parser.push('{"actions":[{"message":{"type":"voice","transcript":"你好');

  assert.deepEqual(transcripts, []);

  const decision = {
    rationale: "test",
    figureMood: "calm",
    variables: {},
    actions: [
      {
        type: "send_message",
        message: { type: "voice", transcript: "你好，世界" },
      },
    ],
  } as PrimeFigureDecision;
  await session.finalize(decision);

  assert.deepEqual(transcripts, ["你好，世界"]);
  assert.deepEqual(
    pushed
      .filter((event) => String(event.type).startsWith("message.audio."))
      .map((event) => [event.type, event.sequence]),
    [
      ["message.audio.started", undefined],
      ["message.audio.chunk", 0],
      ["message.audio.chunk", 1],
      ["message.audio.completed", undefined],
    ],
  );
});

test("prime voice streams transcript deltas to TTS before decision validation when enabled", async () => {
  const writes: string[] = [];
  let finishes = 0;
  const session = createSession({
    voiceRequestStreaming: true,
    tts: {
      createStream(onAudio: (chunk: Buffer) => void) {
        return {
          write(text: string) {
            writes.push(text);
          },
          async finish() {
            finishes += 1;
            onAudio(Buffer.from("streamed-voice"));
            return {
              audio: Buffer.from("streamed-voice"),
              mimeType: "audio/mpeg",
              format: "mp3",
            };
          },
          abort() {},
        };
      },
    },
  });
  const parser = new PrimeDecisionStreamParser((event) =>
    session.handleField(event),
  );

  parser.push('{"actions":[{"message":{"type":"voice","transcript":"你好');

  assert.equal(writes.join(""), "你好");
  assert.equal(finishes, 0);

  parser.push('。"}}]}');
  await session.finalize({
    rationale: "test",
    figureMood: "calm",
    variables: {},
    actions: [
      {
        type: "send_message",
        message: { type: "voice", transcript: "你好。" },
      },
    ],
  } as PrimeFigureDecision);

  assert.equal(writes.join(""), "你好。");
  assert.equal(finishes, 1);
});

test("prime voice aborts an active streaming TTS request when the decision fails", async () => {
  let aborted = false;
  const session = createSession({
    voiceRequestStreaming: true,
    tts: {
      createStream() {
        return {
          write() {},
          async finish() {
            return new Promise(() => undefined);
          },
          abort() {
            aborted = true;
          },
        };
      },
    },
  });
  const parser = new PrimeDecisionStreamParser((event) =>
    session.handleField(event),
  );
  parser.push('{"actions":[{"message":{"type":"voice","transcript":"半句');

  await session.fail(new Error("invalid final response"));

  assert.equal(aborted, true);
});

test("disabled voice streaming is ignored while a later text action keeps its index", async () => {
  const pushed: Array<Record<string, unknown>> = [];
  const saved: Array<Record<string, unknown>> = [];
  let ttsCalls = 0;
  const session = createSession({
    voiceRequestStreaming: true,
    voiceEnabled: false,
    appPush: {
      pushToUser(_ownerUserId: string, event: Record<string, unknown>) {
        pushed.push(event);
      },
    },
    tts: {
      createStream() {
        ttsCalls += 1;
        throw new Error("disabled voice must not start streaming TTS");
      },
      async synthesize() {
        ttsCalls += 1;
        throw new Error("disabled voice must not start TTS");
      },
    },
    messages: {
      async save(message: Record<string, unknown>) {
        saved.push(message);
        return message;
      },
    },
  });
  const parser = new PrimeDecisionStreamParser((event) =>
    session.handleField(event),
  );
  parser.push(
    '{"actions":[{"message":{"type":"voice","transcript":"忽略"}},{"message":{"type":"text","text":"保留"}}]}',
  );

  const result = await session.finalize(
    {
      rationale: "只保留文本",
      figureMood: "平静",
      variables: {},
      actions: [
        { type: "send_message", message: { type: "text", text: "保留" } },
      ],
    } as PrimeFigureDecision,
    [1],
  );

  assert.equal(ttsCalls, 0);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.contentType, "text");
  assert.deepEqual([...result.messageIds.keys()], [0]);
  assert.equal(
    pushed.some((event) => String(event.type).startsWith("message.audio.")),
    false,
  );
});

test("disabled image streaming creates no message, generation, or resource", async () => {
  let generated = 0;
  let resourcesSaved = 0;
  let messagesSaved = 0;
  const session = createSession({
    imageEnabled: false,
    imageGeneration: {
      async generate() {
        generated += 1;
        throw new Error("disabled image must not be generated");
      },
    },
    resources: {
      async readForOwner() {
        return null;
      },
      async saveGeneratedMedia() {
        resourcesSaved += 1;
        throw new Error("disabled image must not be saved");
      },
    },
    messages: {
      async save(message: unknown) {
        messagesSaved += 1;
        return message;
      },
    },
  });
  const parser = new PrimeDecisionStreamParser((event) =>
    session.handleField(event),
  );
  parser.push(
    '{"actions":[{"message":{"generationPrompt":"ignored","referenceMediaIds":[],"type":"image","description":"忽略"}}]}',
  );
  const result = await session.finalize(
    {
      rationale: "能力关闭",
      figureMood: "平静",
      variables: {},
      actions: [],
    },
    [],
  );

  assert.equal(generated, 0);
  assert.equal(resourcesSaved, 0);
  assert.equal(messagesSaved, 0);
  assert.equal(result.messageIds.size, 0);
  assert.equal(result.imageMedia.size, 0);
});

test("prime voice exposes HTTP TTS failures through audio events and metadata", async () => {
  const pushed: Array<Record<string, unknown>> = [];
  const session = createSession({
    appPush: {
      pushToUser(_ownerUserId: string, event: Record<string, unknown>) {
        pushed.push(event);
      },
    },
    tts: {
      async synthesize() {
        throw new Error("Fish Audio unavailable");
      },
    },
  });
  const decision = {
    rationale: "test",
    figureMood: "calm",
    variables: {},
    actions: [
      {
        type: "send_message",
        message: { type: "voice", transcript: "完整文本" },
      },
    ],
  } as PrimeFigureDecision;

  const result = await session.finalize(decision);

  assert.equal(result.ttsErrors.get(0), "Fish Audio unavailable");
  assert.equal(result.voiceMedia.size, 0);
  assert.equal(
    pushed.some(
      (event) =>
        event.type === "message.audio.failed" &&
        event.error === "Fish Audio unavailable",
    ),
    true,
  );
});

test("prime stream failure stores raw response on only the first failed message", async () => {
  const saved: Array<Record<string, unknown>> = [];
  const session = createSession({
    messages: {
      async save(input: Record<string, unknown>) {
        saved.push(input);
        return input;
      },
    },
  });
  const parser = new PrimeDecisionStreamParser((event) =>
    session.handleField(event),
  );
  parser.push(
    '{"actions":[{"message":{"type":"text","text":"一"}},{"message":{"type":"text","text":"二"}}]}',
  );
  await session.fail(new Error("invalid decision"), {
    rawResponse: '{"actions":[]}',
    providerId: "test-provider",
    model: "test-model",
  });

  const failed = saved.filter((item) => item.status === "failed");
  assert.equal(failed.length, 2);
  const firstMetadata = failed[0]?.metadata as Record<string, unknown>;
  const secondMetadata = failed[1]?.metadata as Record<string, unknown>;
  assert.equal(firstMetadata.rawResponse, '{"actions":[]}');
  assert.equal(firstMetadata.providerId, "test-provider");
  assert.equal(secondMetadata.rawResponse, undefined);
  assert.equal(
    secondMetadata.rawResponseMessageId,
    (failed[0] as { id?: string }).id,
  );
});

test("prime messages are persisted when revealed and later actions wait for the prior completion", async () => {
  const saved: Array<{ id: string; createdAt: number }> = [];
  const session = createSession({
    typingCharsPerMinute: 600,
    messages: {
      async save(message: { id: string; createdAt: number }) {
        saved.push({ id: message.id, createdAt: message.createdAt });
        return message;
      },
    },
  });
  const decision = {
    rationale: "test",
    figureMood: "calm",
    variables: {},
    actions: [
      { type: "send_message", message: { type: "text", text: "第一条" } },
      { type: "send_message", message: { type: "text", text: "第二条" } },
    ],
  } as PrimeFigureDecision;
  session.handleField({
    actionIndex: 0,
    field: "type",
    delta: "text",
    complete: false,
  });
  session.handleField({
    actionIndex: 0,
    field: "type",
    delta: "",
    complete: true,
  });
  session.handleField({
    actionIndex: 0,
    field: "text",
    delta: "第一条",
    complete: false,
  });
  session.handleField({
    actionIndex: 0,
    field: "text",
    delta: "",
    complete: true,
  });
  await tick();
  session.handleField({
    actionIndex: 1,
    field: "type",
    delta: "text",
    complete: false,
  });
  session.handleField({
    actionIndex: 1,
    field: "type",
    delta: "",
    complete: true,
  });
  session.handleField({
    actionIndex: 1,
    field: "text",
    delta: "第二条",
    complete: false,
  });
  await wait(350);
  session.handleField({
    actionIndex: 1,
    field: "text",
    delta: "",
    complete: true,
  });
  await session.finalize(decision);

  assert.equal(saved.length, 2);
  const elapsed = saved[1]!.createdAt - saved[0]!.createdAt;
  assert.ok(elapsed >= 300);
  assert.ok(elapsed < 550);
});

test("prime non-text messages do not add a typing interval", async () => {
  const saved: Array<{ contentType: string; createdAt: number }> = [];
  const session = createSession({
    typingCharsPerMinute: 1,
    imageGeneration: {
      async generate() {
        return {
          mimeType: "image/png",
          data: Buffer.from("image"),
          model: "test-image",
        };
      },
    },
    messages: {
      async save(message: { contentType: string; createdAt: number }) {
        saved.push({
          contentType: message.contentType,
          createdAt: message.createdAt,
        });
        return message;
      },
    },
  });
  const decision = {
    rationale: "test",
    figureMood: "calm",
    variables: {},
    actions: [
      { type: "send_message", message: { type: "text", text: "第一条" } },
      {
        type: "send_message",
        message: {
          type: "image",
          description: "海边",
          generationPrompt: "cinematic beach",
          referenceMediaIds: [],
        },
      },
    ],
  } as PrimeFigureDecision;
  const parser = new PrimeDecisionStreamParser((event) =>
    session.handleField(event),
  );
  parser.push(JSON.stringify(decision));
  await session.finalize(decision);

  assert.deepEqual(
    saved.map((message) => message.contentType),
    ["text", "image"],
  );
  assert.ok(saved[1]!.createdAt - saved[0]!.createdAt < 1_000);
});

test("prime voice messages use transcript length minus elapsed time", async () => {
  const saved: Array<{ contentType: string; createdAt: number }> = [];
  const session = createSession({
    typingCharsPerMinute: 600,
    tts: {
      async synthesize() {
        return { audio: Buffer.from("voice"), mimeType: "audio/mpeg" };
      },
    },
    messages: {
      async save(message: { contentType: string; createdAt: number }) {
        saved.push({
          contentType: message.contentType,
          createdAt: message.createdAt,
        });
        return message;
      },
    },
  });
  const decision = {
    rationale: "test",
    figureMood: "calm",
    variables: {},
    actions: [
      { type: "send_message", message: { type: "text", text: "第一条" } },
      {
        type: "send_message",
        message: { type: "voice", transcript: "第二条语音" },
      },
    ],
  } as PrimeFigureDecision;
  session.handleField({
    actionIndex: 0,
    field: "type",
    delta: "text",
    complete: false,
  });
  session.handleField({
    actionIndex: 0,
    field: "type",
    delta: "",
    complete: true,
  });
  session.handleField({
    actionIndex: 0,
    field: "text",
    delta: "第一条",
    complete: false,
  });
  session.handleField({
    actionIndex: 0,
    field: "text",
    delta: "",
    complete: true,
  });
  await tick();
  session.handleField({
    actionIndex: 1,
    field: "type",
    delta: "voice",
    complete: false,
  });
  session.handleField({
    actionIndex: 1,
    field: "type",
    delta: "",
    complete: true,
  });
  session.handleField({
    actionIndex: 1,
    field: "transcript",
    delta: "第二条语音",
    complete: false,
  });
  await wait(350);
  session.handleField({
    actionIndex: 1,
    field: "transcript",
    delta: "",
    complete: true,
  });
  await session.finalize(decision);

  assert.deepEqual(
    saved.map((message) => message.contentType),
    ["text", "voice"],
  );
  const elapsed = saved[1]!.createdAt - saved[0]!.createdAt;
  assert.ok(elapsed >= 450);
  assert.ok(elapsed < 700);
});

test("a stale dirty wakeup cannot call the LLM after all end-user messages were handled", async () => {
  let providerAccessed = false;
  const runtime = new PrimeFigureRuntimeService(
    {
      async findByConversation() {
        return { id: "agent_1", type: "prime-figure" };
      },
    } as never,
    {
      async findByAgent() {
        return { variables: {}, memories: [], updatedAt: 1 };
      },
    } as never,
    {
      async findLatestEndUserCreatedAt() {
        return Date.now() - 5_000;
      },
      async listContextWindow() {
        return [];
      },
      async listEndUserAfterSequence() {
        return [];
      },
    } as never,
    {
      createProvider() {
        providerAccessed = true;
        throw new Error("LLM must not be called");
      },
    } as never,
    {} as never,
    { async save() {} } as never,
    {} as never,
    {} as never,
    {
      async getPrimeHandledEndUserSequence() {
        return 39;
      },
    } as never,
    {
      async resolveConversationConfig() {
        return { config: runtimeConfigForTest() };
      },
    } as never,
  );

  const result = await runtime.requestDecision({
    ownerUserId: "user_1",
    conversationId: "conversation_1",
    trigger: "coalesced_messages",
  });

  assert.equal(result, null);
  assert.equal(providerAccessed, false);
});

function createSession(overrides?: {
  voiceRequestStreaming?: boolean;
  voiceEnabled?: boolean;
  imageEnabled?: boolean;
  typingCharsPerMinute?: number;
  appPush?: object;
  tts?: object;
  imageGeneration?: object;
  resources?: object;
  messages?: object;
}) {
  const runtimeConfig = runtimeConfigForTest(overrides?.typingCharsPerMinute);
  runtimeConfig.outputs.voice.enabled = overrides?.voiceEnabled ?? true;
  runtimeConfig.outputs.image.enabled = overrides?.imageEnabled ?? true;
  return new PrimeDecisionStreamSession(
    {
      ownerUserId: "user_1",
      conversationId: "conversation_1",
      voiceRequestStreaming: overrides?.voiceRequestStreaming ?? false,
      runtimeConfig,
    },
    (overrides?.appPush ?? { pushToUser() {} }) as never,
    (overrides?.tts ?? {
      synthesize() {
        throw new Error("unused");
      },
    }) as never,
    (overrides?.resources ?? {
      async readForOwner() {
        return null;
      },
      async saveGeneratedMedia(_owner: string, kind: string) {
        return { id: `resource_${kind}`, publicPath: `/resources/${kind}` };
      },
    }) as never,
    (overrides?.imageGeneration ?? {
      async generate() {
        throw new Error("unused");
      },
    }) as never,
    {
      async resolveImageReferences() {
        return [];
      },
      async ensure() {
        return { mediaId: "media_1" };
      },
    } as never,
    {
      async save(message: unknown) {
        return message;
      },
      async updateCachedLive() {},
      ...(overrides?.messages ?? {}),
    } as never,
  );
}

function runtimeConfigForTest(typingCharsPerMinute = 300) {
  const textModel = {
    provider: "openrouter",
    baseUrl: "https://openrouter.test/api/v1",
    apiKey: "key",
    model: "model",
    temperature: 0.4,
    maxTokens: 1600,
  };
  return {
    version: 3 as const,
    decisionModel: textModel,
    outputs: {
      image: {
        enabled: true,
        guidanceLevel: "medium" as const,
        generator: {
          provider: "openrouter",
          baseUrl: "https://openrouter.test/api/v1",
          apiKey: "key",
          model: "image-model",
        },
      },
      voice: {
        enabled: true,
        guidanceLevel: "medium" as const,
        tts: {
          provider: "fish-audio",
          apiKey: "fish-key",
          referenceId: "reference",
          model: "fish-model",
          httpUrl: "https://fish.test/v1/tts",
          wsUrl: "wss://fish.test/v1/tts/live",
          latency: "balanced",
          chunkLength: 100,
        },
      },
    },
    optimization: {
      image: { enabled: false, level: "advanced" as const, model: textModel },
      voice: { enabled: false, level: "advanced" as const, model: textModel },
    },
    understanding: {
      visual: { mode: "native" as const, model: textModel },
      audio: { mode: "native" as const, model: textModel },
    },
    context: { minimumMessages: 150, maximumMessages: 249 },
    typingCharsPerMinute,
    messageCoalesceMs: 2_000,
    wakeups: {
      proactive: {
        enabled: false,
        interactionInvalidationWindowMinutes: 10,
      },
      passive: {
        enabled: false,
        milestonesMinutes: [15, 180, 1_440] as [number, number, number],
      },
    },
  };
}

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
