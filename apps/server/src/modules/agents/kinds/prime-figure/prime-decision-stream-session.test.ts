import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppWsServerEvent,
  Message,
  PrimeFigureDecision,
} from "@echoo/shared";
import { buildRuntimeConfigDefaults } from "../../../runtime-config/runtime-config.defaults.js";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { MessageRepository } from "../../../messaging/message.repository.js";
import { PrimeDecisionStreamSession } from "./prime-decision-stream-session.js";

function createSession(options: { typingCharsPerMinute?: number } = {}) {
  const events: AppWsServerEvent[] = [];
  const saved: Message[] = [];
  const runtimeConfig = buildRuntimeConfigDefaults().primeFigure;
  runtimeConfig.typingCharsPerMinute =
    options.typingCharsPerMinute ?? runtimeConfig.typingCharsPerMinute;
  const appPush = {
    pushToUser: (_ownerUserId: string, payload: AppWsServerEvent) => {
      events.push(payload);
    },
  } as unknown as AppPushService;
  const messages = {
    save: async (input: Message & { ownerUserId: string }) => {
      const { ownerUserId: _ownerUserId, ...message } = input;
      saved.push(message);
      return message;
    },
    updateCachedLive: async () => undefined,
  } as unknown as MessageRepository;
  const session = new PrimeDecisionStreamSession(
    {
      ownerUserId: "user_1",
      conversationId: "conversation_1",
      voiceRequestStreaming: false,
      runtimeConfig,
    },
    appPush,
    undefined,
    undefined,
    undefined,
    undefined,
    messages,
  );
  return { session, events, saved };
}

function field(
  session: PrimeDecisionStreamSession,
  actionIndex: number,
  name: "type" | "text" | "transcript",
  delta: string,
  complete = false,
) {
  session.handleField({ actionIndex, field: name, delta, complete });
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("publishes a Prime text message once after its field completes", async () => {
  const { session, events, saved } = createSession();

  field(session, 0, "type", "text");
  field(session, 0, "type", "", true);
  field(session, 0, "text", "你");
  field(session, 0, "text", "好");
  await settle();

  assert.equal(events.length, 0);
  assert.equal(saved.length, 0);

  field(session, 0, "text", "", true);
  await settle();

  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.content.text, "你好");
  assert.deepEqual(
    events.map((event) => event.type),
    ["message.created"],
  );
  const created = events[0];
  assert.equal(
    created?.type === "message.created" ? created.message.content.text : null,
    "你好",
  );

  const result = await session.finalize({
    rationale: "回复用户",
    figureMood: "平静",
    variables: {},
    actions: [
      { type: "send_message", message: { type: "text", text: "你好" } },
    ],
  } satisfies PrimeFigureDecision);
  assert.equal(result.messageIds.get(0), saved[0]?.id);
  assert.deepEqual(
    events.map((event) => event.type),
    ["message.created"],
  );
});

test("publishes the first Prime text immediately and paces the next one", async () => {
  const { session, events } = createSession({ typingCharsPerMinute: 6_000 });

  field(session, 0, "type", "text");
  field(session, 0, "type", "", true);
  field(session, 0, "text", "第一条");
  field(session, 0, "text", "", true);
  await settle();
  assert.equal(events.length, 1);

  field(session, 1, "type", "text");
  field(session, 1, "type", "", true);
  field(session, 1, "text", "第二条");
  field(session, 1, "text", "", true);
  await settle();
  assert.equal(events.length, 1);

  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) =>
      event.type === "message.created" ? event.message.content.text : null,
    ),
    ["第一条", "第二条"],
  );
});

test("keeps Prime voice transcript deltas visible", async () => {
  const { session, events } = createSession();

  field(session, 0, "type", "voice");
  field(session, 0, "type", "", true);
  await settle();
  field(session, 0, "transcript", "语音内容");
  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(
    events.map((event) => event.type),
    ["message.created", "message.delta"],
  );
});
