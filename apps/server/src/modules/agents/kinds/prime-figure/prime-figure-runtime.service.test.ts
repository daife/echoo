import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  ChatCompletionInput,
  ChatCompletionResult,
  AiTextProvider,
} from "../../../ai/ai-provider.interface.js";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import { AgentRepository } from "../../agent.repository.js";
import { MessageRepository } from "../../../messaging/message.repository.js";
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";
import { PrimeActionExecutor } from "./prime-action-executor.js";
import { PrimeFigureHandler } from "./prime-figure.handler.js";
import { PrimeMessageRepository } from "./prime-message.repository.js";
import { PrimeFigureRuntimeService } from "./prime-figure-runtime.service.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";
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
    const responseSchema = (
      firstProvider.inputs[0]?.responseFormat as {
        json_schema?: { schema?: Record<string, unknown> };
      }
    ).json_schema?.schema ?? {};
    assertSchemaFieldDescriptions(responseSchema);
    const stateUpdatesSchema = schemaProperty(responseSchema, "stateUpdates");
    const scheduleSchema = schemaProperty(stateUpdatesSchema, "schedule");
    const scheduleObjectSchema = (
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
      new MessageRepository().listByConversation(
        "user_prime_test",
        agent.conversationId,
      ).filter((message) => message.role === "assistant").length,
      2,
      "one decision may persist multiple ordered send_message actions",
    );
    const packet = JSON.parse(
      firstProvider.inputs[0]?.messages.find((message) => message.role === "user")
        ?.content ?? "{}",
    ) as { now?: string; weekday?: string };
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
      rationaleRows.every(
        (row) => row.rationale === firstDecision.rationale,
      ),
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
    const recallToolResult =
      recallProvider.inputs[1]?.messages.find(
        (message) => message.role === "tool",
      )?.content ?? "";
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
      wakeProvider.inputs[0]?.messages.find(
        (message) => message.role === "user",
      )?.content ?? "",
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

function result(decision: PrimeFigureDecision): ChatCompletionResult {
  return {
    providerId: "openrouter",
    model: "test/prime-figure",
    text: JSON.stringify(decision),
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
    | Record<string, Record<string, unknown>>
    | undefined;
  return properties?.[name] ?? {};
}
