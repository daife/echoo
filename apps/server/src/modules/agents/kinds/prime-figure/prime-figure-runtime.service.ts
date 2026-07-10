import { primeFigureDecisionSchema } from "@echoo/shared";
import type {
  PrimeFigureAgent,
  PrimeFigureDecision,
  PrimeFigureState,
  PrimeFigureVariableDefinition,
  PrimeFigureVariableValue,
  PrimeMessage,
  PrimeMessageContent,
} from "@echoo/shared";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import type {
  ChatCompletionMessage,
  ChatToolCall,
  ChatToolDefinition,
} from "../../../ai/ai-provider.interface.js";
import { AgentRepository } from "../../agent.repository.js";
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";
import { PrimeActionExecutor } from "./prime-action-executor.js";
import { PrimeMessageRepository } from "./prime-message.repository.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";
import {
  describeAge,
  findScheduleSegment,
  formatReadableMinute,
} from "./prime-time.js";

const PRIME_CONTEXT_MESSAGE_LIMIT = 18;
const PRIME_VISIBLE_MEMORY_LIMIT = 10;
const RECALL_HINT_PATTERN = /记得|不记得|忘了|还记得|remember|forgot|recal+l/i;

export type PrimeDecisionTrigger =
  "end_user_message" | "silence_ended" | "coalesced_messages";

export class PrimeFigureRuntimeService {
  private static readonly activeRuns = new Map<
    string,
    Promise<PrimeFigureDecision | null>
  >();
  private static readonly pendingTriggers = new Map<
    string,
    PrimeDecisionTrigger
  >();

  constructor(
    private readonly agents = new AgentRepository(),
    private readonly states = new PrimeFigureStateRepository(),
    private readonly messages = new PrimeMessageRepository(),
    private readonly providers = new AiProviderRegistry(),
    private readonly executor = new PrimeActionExecutor(),
    private readonly logs = new PrimeActionLogRepository(),
  ) {}

  requestDecision(input: {
    ownerUserId: string;
    conversationId: string;
    trigger?: PrimeDecisionTrigger;
  }): Promise<PrimeFigureDecision | null> {
    const key = `${input.ownerUserId}:${input.conversationId}`;
    const active = PrimeFigureRuntimeService.activeRuns.get(key);
    if (active) {
      PrimeFigureRuntimeService.pendingTriggers.set(key, "coalesced_messages");
      return active;
    }

    const task = this.drainDecisions(
      { ...input, trigger: input.trigger ?? "end_user_message" },
      key,
    ).finally(() => {
      PrimeFigureRuntimeService.activeRuns.delete(key);
      PrimeFigureRuntimeService.pendingTriggers.delete(key);
    });
    PrimeFigureRuntimeService.activeRuns.set(key, task);
    return task;
  }

  private async drainDecisions(
    input: {
      ownerUserId: string;
      conversationId: string;
      trigger: PrimeDecisionTrigger;
    },
    key: string,
  ): Promise<PrimeFigureDecision | null> {
    let trigger = input.trigger;
    let lastDecision: PrimeFigureDecision | null = null;

    while (true) {
      PrimeFigureRuntimeService.pendingTriggers.delete(key);
      const agent = this.agents.findByConversation(
        input.ownerUserId,
        input.conversationId,
      );
      if (!agent || agent.type !== "prime-figure") return null;
      const state = this.states.findByAgent(input.ownerUserId, agent.id);
      if (!state) {
        this.logs.save({
          ownerUserId: input.ownerUserId,
          agentId: agent.id,
          conversationId: input.conversationId,
          action: { type: "prime_runtime", trigger },
          status: "failed",
          errorMessage: "Prime Figure state is missing.",
        });
        return null;
      }
      if (state.silenceUntilMs && state.silenceUntilMs > Date.now())
        return lastDecision;

      try {
        lastDecision = await this.createDecisionOnce({
          ...input,
          trigger,
          agent,
          state,
        });
      } catch (error) {
        this.logs.save({
          ownerUserId: input.ownerUserId,
          agentId: agent.id,
          conversationId: input.conversationId,
          action: { type: "prime_runtime", trigger },
          status: "failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Prime Figure runtime failed.",
        });
        return null;
      }

      const pending = PrimeFigureRuntimeService.pendingTriggers.get(key);
      if (!pending) return lastDecision;
      trigger = pending;
    }
  }

  private async createDecisionOnce(input: {
    ownerUserId: string;
    conversationId: string;
    trigger: PrimeDecisionTrigger;
    agent: PrimeFigureAgent;
    state: PrimeFigureState;
  }) {
    const timeline = this.messages.listRecent(
      input.ownerUserId,
      input.agent.id,
      PRIME_CONTEXT_MESSAGE_LIMIT,
    );
    const provider = this.providers.getDefaultProvider();
    const model = this.providers.getDefaultModel();
    const chatMessages = buildPrimeChatMessages(
      input.agent,
      input.state,
      timeline,
      input.trigger,
    );

    const firstResponse = await provider.createChatCompletion({
      model,
      sessionId: input.conversationId,
      messages: chatMessages,
      tools: [SEARCH_RECALL_TOOL],
      toolChoice: "auto",
      responseFormat: buildPrimeDecisionResponseFormat(input.agent, false),
      temperature: Number(process.env.DEFAULT_PRIME_TEMPERATURE ?? 0.4),
      maxTokens: process.env.DEFAULT_PRIME_MAX_TOKENS
        ? Number(process.env.DEFAULT_PRIME_MAX_TOKENS)
        : undefined,
      reasoningMode: "disabled",
    });

    let finalResponse = firstResponse;
    const recallCall = firstResponse.toolCalls?.find(
      (call) => call.function.name === "search_recall",
    );
    if (recallCall) {
      chatMessages.push({
        role: "assistant",
        content: firstResponse.text,
        toolCalls: firstResponse.toolCalls,
      });
      chatMessages.push({
        role: "tool",
        toolCallId: recallCall.id,
        name: recallCall.function.name,
        content: this.executeRecallTool(recallCall, input),
      });
      finalResponse = await provider.createChatCompletion({
        model,
        sessionId: input.conversationId,
        messages: chatMessages,
        responseFormat: buildPrimeDecisionResponseFormat(input.agent, true),
        toolChoice: "none",
        temperature: Number(process.env.DEFAULT_PRIME_TEMPERATURE ?? 0.4),
        maxTokens: process.env.DEFAULT_PRIME_MAX_TOKENS
          ? Number(process.env.DEFAULT_PRIME_MAX_TOKENS)
          : undefined,
        reasoningMode: "disabled",
      });
    }

    const decision = primeFigureDecisionSchema.parse(
      JSON.parse(finalResponse.text),
    ) as PrimeFigureDecision;
    this.executor.executeDecision({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      agent: input.agent,
      state: input.state,
      decision,
      providerId: finalResponse.providerId,
      model: finalResponse.model,
    });
    return decision;
  }

  private executeRecallTool(
    toolCall: ChatToolCall,
    context: {
      ownerUserId: string;
      agent: PrimeFigureAgent;
      state: PrimeFigureState;
    },
  ) {
    const args = parseRecallArguments(toolCall.function.arguments);
    const timezone = context.agent.detail.schedule.timezone;
    const history = this.messages
      .searchByKeywords(
        context.ownerUserId,
        context.agent.id,
        args.keywords,
        args.limit,
      )
      .map((message) => [
        formatReadableMinute(message.occurredAtMs, timezone),
        message.sender,
        sanitizeVisibleText(describePrimeContent(message.content), timezone),
      ]);
    const lowered = args.keywords.map((keyword) => keyword.toLocaleLowerCase());
    const memories = context.state.memories
      .filter((memory) =>
        lowered.some((keyword) =>
          memory.content.toLocaleLowerCase().includes(keyword),
        ),
      )
      .slice(-args.limit)
      .map((memory) => [
        formatReadableMinute(memory.eventAtMs, timezone),
        sanitizeVisibleText(memory.content, timezone),
      ]);

    return JSON.stringify({ history, memories });
  }
}

function buildPrimeChatMessages(
  agent: PrimeFigureAgent,
  state: PrimeFigureState,
  timeline: PrimeMessage[],
  trigger: PrimeDecisionTrigger,
): ChatCompletionMessage[] {
  const timezone = agent.detail.schedule.timezone;
  const now = Date.now();
  const lastEndUserMessage = [...timeline]
    .reverse()
    .find((message) => message.sender === "end_user");
  const eventTime = lastEndUserMessage?.occurredAtMs ?? now;
  const scheduleSegment = findScheduleSegment(agent.detail.schedule, eventTime);
  const hints: string[] = [];

  if (
    lastEndUserMessage?.content.type === "text" &&
    RECALL_HINT_PATTERN.test(lastEndUserMessage.content.text)
  ) {
    hints.push(
      "当前enduser疑似要求回忆，可能需要考虑调用search_recall。具体是否属于明确回忆请求由你判断。",
    );
  }
  if (scheduleSegment) {
    hints.push(
      `最近一条enduser消息发生在Figure的“${scheduleSegment.label}”时段（${scheduleSegment.start}-${scheduleSegment.end}）：${sanitizeVisibleText(scheduleSegment.description, timezone)}`,
    );
  } else {
    hints.push("最近一条enduser消息不处于Figure已定义的任何日程时段。");
  }
  if (trigger === "silence_ended") {
    hints.push(
      "Figure此前选择的沉默期已经结束。沉默期间积累的enduser消息已合并到本次数据包，请只作出一次新的决定。",
    );
  } else if (trigger === "coalesced_messages") {
    hints.push(
      "Figure作出上一轮决定时又收到了新消息。本次数据包已经合并这些消息。",
    );
  }

  const visibleMemories = [...state.memories]
    .sort((left, right) => right.recordedAtMs - left.recordedAtMs)
    .slice(0, PRIME_VISIBLE_MEMORY_LIMIT)
    .reverse()
    .map((memory) => [
      formatReadableMinute(memory.eventAtMs, timezone),
      sanitizeVisibleText(memory.content, timezone),
    ]);

  return [
    {
      role: "system",
      content: buildSystemPrompt(agent),
    },
    {
      role: "user",
      content: JSON.stringify({
        now: formatReadableMinute(now, timezone),
        timezone,
        figureNow: {
          mood: state.mood
            ? `Figure当前情绪：“${state.mood}”。该判断形成于${describeAge(state.moodObservedAtMs, now)}。`
            : "Figure当前没有已记录的情绪。",
          relationship: state.relationshipStatus || undefined,
          variables: makeLlmReadable(state.variables, timezone),
        },
        recent: timeline.map((message) => [
          formatReadableMinute(message.occurredAtMs, timezone),
          message.sender,
          sanitizeVisibleText(describePrimeContent(message.content), timezone),
        ]),
        memories: visibleMemories,
        hints,
      }),
    },
  ];
}

function buildSystemPrompt(agent: PrimeFigureAgent) {
  const timezone = agent.detail.schedule.timezone;
  const schedule = agent.detail.schedule.segments.map(
    (segment) =>
      `${segment.days.join(",")} ${segment.start}-${segment.end} ${segment.label}: ${sanitizeVisibleText(segment.description, timezone)}`,
  );
  const parameters = agent.detail.variableDefinitions.map(
    (definition) =>
      `${definition.key} (${definition.type}, ${definition.required ? "required" : "nullable"}): ${sanitizeVisibleText(definition.description, timezone)}`,
  );

  return [
    `You simulate Prime Figure “${agent.name}” from the Figure's own point of view.`,
    "Your purpose is to preserve a believable Figure with continuous personality, memory, mood, schedule, preferences, boundaries, and relationships.",
    "Your purpose is not to satisfy, comfort, retain, or please the enduser. Decide what this Figure would genuinely think and do.",
    "First write a concise Figure-centered rationale. Analyze the Figure's own mood, motives, schedule, memories, reluctance, desires, and boundaries.",
    "Do not classify enduser intent. Do not output userIntent, relationshipSignal, riskLevel, hidden chain-of-thought, or per-action rationale.",
    "The Figure may reply or remain silent. The single action must be exactly one of send_message or silence, never both.",
    "A stored mood is historical evidence, not an instruction to keep it forever. Consider how long ago it was observed.",
    "Memory eventAt is when the remembered event belongs in the Figure's timeline. Copy a visible YYYY-MM-DDTHH:mm time when defensible; otherwise use null.",
    "All visible exact times use YYYY-MM-DDTHH:mm in the Figure's timezone. Never invent a more precise or unsupported time.",
    "Only use search_recall under the conditions in its tool description.",
    "Return only JSON matching the strict schema. Required creator parameters must contain a non-null value on every decision.",
    "",
    `Persona: ${sanitizeVisibleText(agent.detail.persona, timezone)}`,
    `Background: ${sanitizeVisibleText(agent.detail.background, timezone)}`,
    `Personality: ${sanitizeVisibleText(agent.detail.personality, timezone)}`,
    `Response style: ${sanitizeVisibleText(agent.detail.responseStyle, timezone)}`,
    `Decision style: ${sanitizeVisibleText(agent.detail.decisionStyle, timezone) || "No additional decision style."}`,
    `Current situation: ${sanitizeVisibleText(agent.detail.currentSituation, timezone) || "No additional current situation."}`,
    `Itinerary: ${sanitizeVisibleText(agent.detail.itinerary, timezone) || "No itinerary."}`,
    `Schedule:\n${schedule.length ? schedule.join("\n") : "No schedule segments."}`,
    `Creator output parameters:\n${parameters.length ? parameters.join("\n") : "No custom parameters."}`,
  ].join("\n");
}

const SEARCH_RECALL_TOOL: ChatToolDefinition = {
  type: "function",
  function: {
    name: "search_recall",
    description:
      "Search older Figure memories and Prime Figure conversation history by keywords. Call this only when the enduser explicitly asks whether the Figure remembers a past fact or event AND the visible memories and recent conversation do not already contain the answer. Do not call for ordinary questions, casual mentions of the past, a mere occurrence of words such as '记得', or when visible context is sufficient. If you call it, the final memoryWrites must contain at least one consolidated memory; if no historical evidence is found, record the enduser's present claim without pretending the Figure previously remembered it.",
    parameters: {
      type: "object",
      description: "Keyword query for older Figure recall.",
      properties: {
        keywords: {
          type: "array",
          description:
            "One to six short, discriminative keywords copied or derived from the explicit recall request.",
          items: { type: "string", description: "A short recall keyword." },
          minItems: 1,
          maxItems: 6,
        },
        limit: {
          type: "integer",
          description:
            "Maximum number of history results and memory results to return, from 1 to 8.",
          minimum: 1,
          maximum: 8,
        },
      },
      required: ["keywords", "limit"],
      additionalProperties: false,
    },
  },
};

function buildPrimeDecisionResponseFormat(
  agent: PrimeFigureAgent,
  requireMemoryWrite: boolean,
) {
  const variableProperties = Object.fromEntries(
    agent.detail.variableDefinitions.map((definition) => [
      definition.key,
      buildVariableSchema(definition),
    ]),
  );
  const variableKeys = agent.detail.variableDefinitions.map(
    (definition) => definition.key,
  );

  return {
    type: "json_schema",
    json_schema: {
      name: "prime_figure_decision_v2",
      strict: true,
      schema: {
        type: "object",
        description:
          "One Figure-centered decision for the current runtime event packet.",
        properties: {
          rationale: {
            type: "string",
            description:
              "Concise reasoning written before action selection. Analyze the Figure's own mood, motives, schedule, memories, desires, reluctance, and boundaries, not the enduser's intent.",
          },
          figureMood: {
            type: "string",
            description:
              "The Figure's current mood at this decision. The Runtime attaches the observation time automatically.",
          },
          variables: {
            type: "object",
            description:
              "Current values for every creator-defined output parameter. Required parameters must be non-null; nullable parameters use null when they should retain their prior value.",
            properties: variableProperties,
            required: variableKeys,
            additionalProperties: false,
          },
          memoryWrites: {
            type: "array",
            description:
              "New durable Figure memories. Keep empty unless the event deserves future recall. A search_recall call requires at least one entry.",
            minItems: requireMemoryWrite ? 1 : 0,
            maxItems: 8,
            items: {
              type: "object",
              description: "A concise memory and its Figure-timeline anchor.",
              properties: {
                content: {
                  type: "string",
                  description:
                    "Self-contained memory content without database IDs or source-message metadata.",
                },
                eventAt: {
                  anyOf: [
                    {
                      type: "string",
                      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
                      description:
                        "Readable event time in the Figure timezone, copied from visible evidence.",
                    },
                    {
                      type: "null",
                      description:
                        "Use when no defensible event time is visible; Runtime anchors it to response time.",
                    },
                  ],
                  description:
                    "When this memory belongs in the Figure's timeline, or null when unknown.",
                },
              },
              required: ["content", "eventAt"],
              additionalProperties: false,
            },
          },
          action: {
            description:
              "The Figure's single outward action. Sending and silence are mutually exclusive.",
            anyOf: [
              {
                type: "object",
                description: "Send one text message now as the Figure.",
                properties: {
                  type: {
                    const: "send_message",
                    description: "Select immediate Figure message delivery.",
                  },
                  message: {
                    type: "object",
                    description:
                      "Text message authored in the Figure's authentic voice.",
                    properties: {
                      type: {
                        const: "text",
                        description: "Text content type.",
                      },
                      text: {
                        type: "string",
                        description:
                          "The exact text the Figure sends to the enduser.",
                      },
                    },
                    required: ["type", "text"],
                    additionalProperties: false,
                  },
                },
                required: ["type", "message"],
                additionalProperties: false,
              },
              {
                type: "object",
                description:
                  "Remain silent and suppress new LLM packets until the revisit period ends.",
                properties: {
                  type: {
                    const: "silence",
                    description: "Select temporary Figure silence.",
                  },
                  revisitAfterMinutes: {
                    type: "integer",
                    description:
                      "Minutes before queued enduser messages may trigger one coalesced decision packet.",
                    minimum: 1,
                    maximum: 10080,
                  },
                },
                required: ["type", "revisitAfterMinutes"],
                additionalProperties: false,
              },
            ],
          },
        },
        required: [
          "rationale",
          "figureMood",
          "variables",
          "memoryWrites",
          "action",
        ],
        additionalProperties: false,
      },
    },
  } as const;
}

function buildVariableSchema(definition: PrimeFigureVariableDefinition) {
  const description = `${definition.description}${
    definition.type === "json"
      ? " Return valid JSON encoded as a compact string."
      : ""
  }${definition.required ? " This parameter is required and cannot be null." : " Use null to retain the previous value."}`;
  const base =
    definition.type === "number"
      ? {
          type: "number",
          description,
          ...(definition.min !== undefined ? { minimum: definition.min } : {}),
          ...(definition.max !== undefined ? { maximum: definition.max } : {}),
        }
      : definition.type === "boolean"
        ? { type: "boolean", description }
        : { type: "string", description };

  return definition.required
    ? base
    : {
        anyOf: [
          base,
          {
            type: "null",
            description:
              "Retain the previous value for this optional parameter.",
          },
        ],
        description,
      };
}

function parseRecallArguments(value: string) {
  try {
    const parsed = JSON.parse(value) as { keywords?: unknown; limit?: unknown };
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords
          .map(String)
          .map((keyword) => keyword.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    return {
      keywords: keywords.length ? keywords : ["回忆"],
      limit: Math.min(Math.max(Math.trunc(Number(parsed.limit) || 6), 1), 8),
    };
  } catch {
    return { keywords: ["回忆"], limit: 6 };
  }
}

function describePrimeContent(content: PrimeMessageContent) {
  if (content.type === "text") return content.text;
  if (content.type === "image") return `[图片] ${content.description}`;
  if (content.type === "video") return `[视频] ${content.description}`;
  if (content.type === "voice") return `[语音] ${content.transcript}`;
  if (content.type === "sticker") return `[贴纸] ${content.description}`;
  return `[转账] ${content.direction === "received" ? "收到" : "支付"} ${content.currency} ${content.amount}${content.note ? `，${content.note}` : ""}`;
}

function makeLlmReadable(
  value: PrimeFigureVariableValue | Record<string, PrimeFigureVariableValue>,
  timezone: string,
  key = "",
): PrimeFigureVariableValue | Record<string, PrimeFigureVariableValue> {
  if (
    typeof value === "number" &&
    value > 100_000_000_000 &&
    /(time|date|at|时间|日期)/i.test(key)
  ) {
    return formatReadableMinute(value, timezone);
  }
  if (Array.isArray(value))
    return value.map((item) =>
      makeLlmReadable(item as PrimeFigureVariableValue, timezone, key),
    );
  if (typeof value === "string") return sanitizeVisibleText(value, timezone);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        makeLlmReadable(
          childValue as PrimeFigureVariableValue,
          timezone,
          childKey,
        ),
      ]),
    );
  }
  return value;
}

function sanitizeVisibleText(value: string, timezone: string) {
  return value
    .replace(
      /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
      "$1",
    )
    .replace(/\b1\d{12}\b/g, (timestamp) =>
      formatReadableMinute(Number(timestamp), timezone),
    );
}
