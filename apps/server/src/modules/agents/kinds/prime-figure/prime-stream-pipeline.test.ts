import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeFigureDecision } from "@echoo/shared";
import { PrimeDecisionStreamParser } from "./prime-decision-stream-parser.js";
import { PrimeDecisionStreamSession } from "./prime-decision-stream-session.js";
import { PrimeFigureRuntimeService } from "./prime-figure-runtime.service.js";

test("prime stream starts image generation as soon as prompt and references are complete", async () => {
  let generatedPrompt = "";
  const session = createSession({
    imageGeneration: {
      async generate(input: { prompt: string }) {
        generatedPrompt = input.prompt;
        return { mimeType: "image/png", data: Buffer.from("image"), model: "test-image" };
      },
    },
  });
  const parser = new PrimeDecisionStreamParser((event) => session.handleField(event));

  parser.push(
    '{"actions":[{"message":{"type":"image","description":"海边","generationPrompt":"cinematic beach","referenceMediaIds":[]}',
  );
  await tick();

  assert.equal(generatedPrompt, "cinematic beach");
});

test("prime voice transcript is written to streaming TTS before the decision completes", () => {
  const writes: string[] = [];
  const session = createSession({
    tts: {
      createStream() {
        return {
          write(text: string) {
            writes.push(text);
          },
          async finish() {
            return { audio: Buffer.from("voice"), mimeType: "audio/mpeg", format: "mp3" };
          },
          abort() {},
        };
      },
    },
  });
  const parser = new PrimeDecisionStreamParser((event) => session.handleField(event));

  parser.push('{"actions":[{"message":{"type":"voice","transcript":"你好');

  assert.equal(writes.join(""), "你好");
});

test("prime messages are persisted when revealed and later actions wait for the prior completion", async () => {
  const saved: Array<{ id: string; createdAt: number }> = [];
  const previousMinimum = process.env.PRIME_MESSAGE_GAP_MIN_MS;
  const previousMaximum = process.env.PRIME_MESSAGE_GAP_MAX_MS;
  process.env.PRIME_MESSAGE_GAP_MIN_MS = "1";
  process.env.PRIME_MESSAGE_GAP_MAX_MS = "1";
  try {
    const session = createSession({
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
    const parser = new PrimeDecisionStreamParser((event) => session.handleField(event));
    parser.push(JSON.stringify(decision));
    await session.finalize(decision);

    assert.equal(saved.length, 2);
    assert.ok(saved[1]!.createdAt >= saved[0]!.createdAt + 1);
  } finally {
    restoreEnvironment("PRIME_MESSAGE_GAP_MIN_MS", previousMinimum);
    restoreEnvironment("PRIME_MESSAGE_GAP_MAX_MS", previousMaximum);
  }
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
      async findLatestEndUserCreatedAt() { return Date.now() - 5_000; },
      async listRecent() { return []; },
      async listEndUserAfterSequence() { return []; },
    } as never,
    {
      getDefaultProvider() {
        providerAccessed = true;
        throw new Error("LLM must not be called");
      },
    } as never,
    {} as never,
    { async save() {} } as never,
    {} as never,
    {} as never,
    {
      async getPrimeHandledEndUserSequence() { return 39; },
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
  tts?: object;
  imageGeneration?: object;
  messages?: object;
}) {
  return new PrimeDecisionStreamSession(
    { ownerUserId: "user_1", conversationId: "conversation_1" },
    { pushToUser() {} } as never,
    (overrides?.tts ?? { createStream() { throw new Error("unused"); } }) as never,
    {
      async readForOwner() { return null; },
      async saveGeneratedMedia(_owner: string, kind: string) {
        return { id: `resource_${kind}`, publicPath: `/resources/${kind}` };
      },
    } as never,
    (overrides?.imageGeneration ?? { async generate() { throw new Error("unused"); } }) as never,
    {
      async resolveImageReferences() { return []; },
      async ensure() { return { mediaId: "media_1" }; },
    } as never,
    {
      async save(message: unknown) { return message; },
      async updateCachedLive() {},
      ...(overrides?.messages ?? {}),
    } as never,
  );
}

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
