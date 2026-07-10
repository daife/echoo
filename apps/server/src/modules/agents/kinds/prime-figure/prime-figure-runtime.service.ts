import { primeFigureDecisionSchema } from "@echoo/shared";
import type { Agent, PrimeFigureAgent, PrimeFigureDecision, PrimeFigureState } from "@echoo/shared";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import type { ChatCompletionMessage, ChatToolCall, ChatToolDefinition } from "../../../ai/ai-provider.interface.js";
import { AgentRepository } from "../../agent.repository.js";
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";
import { PrimeActionExecutor } from "./prime-action-executor.js";
import { PrimeMessageRepository } from "./prime-message.repository.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";

const TOOL_PHASE_LIMIT = 3;
const PRIME_CONTEXT_MESSAGE_LIMIT = 120;

export class PrimeFigureRuntimeService {
  constructor(
    private readonly agents = new AgentRepository(),
    private readonly states = new PrimeFigureStateRepository(),
    private readonly messages = new PrimeMessageRepository(),
    private readonly providers = new AiProviderRegistry(),
    private readonly executor = new PrimeActionExecutor(),
    private readonly logs = new PrimeActionLogRepository()
  ) {}

  async createDecision(input: { ownerUserId: string; conversationId: string }): Promise<PrimeFigureDecision | null> {
    const agent = this.agents.findByConversation(input.ownerUserId, input.conversationId);
    if (!agent || agent.type !== "prime-figure") return null;

    const state = this.states.findByAgent(input.ownerUserId, agent.id) ?? createFallbackState();
    const timeline = this.messages.listRecent(input.ownerUserId, agent.id, PRIME_CONTEXT_MESSAGE_LIMIT);
    const provider = this.providers.getDefaultProvider();
    const model = this.providers.getDefaultModel();
    const chatMessages = buildPrimeChatMessages(agent, state, timeline);

    for (let index = 0; index < TOOL_PHASE_LIMIT; index += 1) {
      const toolPhase = await provider.createChatCompletion({
        model,
        sessionId: input.conversationId,
        messages: chatMessages,
        tools: PRIME_READONLY_TOOLS,
        toolChoice: "auto",
        temperature: Number(process.env.DEFAULT_PRIME_TEMPERATURE ?? 0.4),
        maxTokens: process.env.DEFAULT_PRIME_MAX_TOKENS ? Number(process.env.DEFAULT_PRIME_MAX_TOKENS) : undefined,
        reasoningMode: "disabled"
      });

      if (!toolPhase.toolCalls?.length) break;
      chatMessages.push({ role: "assistant", content: toolPhase.text, toolCalls: toolPhase.toolCalls });
      for (const toolCall of toolPhase.toolCalls) {
        chatMessages.push({
          role: "tool",
          toolCallId: toolCall.id,
          name: toolCall.function.name,
          content: executeReadonlyTool(toolCall, { agent, state, timeline })
        });
      }
    }

    const finalResponse = await provider.createChatCompletion({
      model,
      sessionId: input.conversationId,
      messages: chatMessages,
      responseFormat: PRIME_DECISION_RESPONSE_FORMAT,
      toolChoice: "none",
      temperature: Number(process.env.DEFAULT_PRIME_TEMPERATURE ?? 0.4),
      maxTokens: process.env.DEFAULT_PRIME_MAX_TOKENS ? Number(process.env.DEFAULT_PRIME_MAX_TOKENS) : undefined,
      reasoningMode: "disabled"
    });

    try {
      const decision = primeFigureDecisionSchema.parse(JSON.parse(finalResponse.text)) as PrimeFigureDecision;
      this.executor.executeDecision({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        agent,
        state,
        decision
      });
      return decision;
    } catch (error) {
      this.logs.save({
        ownerUserId: input.ownerUserId,
        agentId: agent.id,
        conversationId: input.conversationId,
        action: { type: "parse_prime_decision", responseText: finalResponse.text },
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Prime decision parsing failed."
      });
      return null;
    }
  }
}

function buildPrimeChatMessages(agent: PrimeFigureAgent, state: PrimeFigureState, timeline: ReturnType<PrimeMessageRepository["listRecent"]>): ChatCompletionMessage[] {
  return [
    {
      role: "system",
      content: [
        `You are the structured runtime analyst for Prime Figure "${agent.name}".`,
        "You do not chat with the end user directly.",
        "Decide what the Prime Figure should do, update, remember, schedule, or send.",
        "Return only schema-valid JSON in the final phase.",
        "Do not reveal hidden chain-of-thought. Use concise decisionSummary and actionRationale fields instead.",
        "",
        "Prime Figure profile:",
        JSON.stringify(agent.detail),
        "",
        "Current state:",
        JSON.stringify(state)
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        nowMs: Date.now(),
        recentTimeline: timeline
      })
    }
  ];
}

const PRIME_READONLY_TOOLS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "inspect_prime_state",
      description: "Read the current Prime Figure state snapshot. This tool has no side effects.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_recent_prime_messages",
      description: "Read recent Prime Figure timeline messages. This tool has no side effects.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  }
];

function executeReadonlyTool(
  toolCall: ChatToolCall,
  context: { agent: Agent; state: PrimeFigureState; timeline: ReturnType<PrimeMessageRepository["listRecent"]> }
) {
  if (toolCall.function.name === "inspect_prime_state") {
    return JSON.stringify({ state: context.state });
  }

  if (toolCall.function.name === "list_recent_prime_messages") {
    return JSON.stringify({ recentTimeline: context.timeline });
  }

  return JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
}

function createFallbackState(): PrimeFigureState {
  return {
    currentSchedule: {},
    itinerary: {},
    variables: {},
    memories: [],
    mood: "",
    relationshipStatus: "",
    updatedAt: Date.now()
  };
}

const primeMessageContentSchema = {
  anyOf: [
    {
      type: "object",
      properties: { type: { const: "text" }, text: { type: "string" } },
      required: ["type", "text"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { const: "image" },
        description: { type: "string" },
        generationPrompt: { type: "string" },
        referenceResourceUrls: { type: "array", items: { type: "string" } },
        resourceUrl: { type: "string" }
      },
      required: ["type", "description", "referenceResourceUrls"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: { type: { const: "video" }, description: { type: "string" }, resourceUrl: { type: "string" } },
      required: ["type", "description", "resourceUrl"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { const: "voice" },
        description: { type: "string" },
        transcript: { type: "string" },
        resourceUrl: { type: "string" }
      },
      required: ["type", "description", "transcript"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: { type: { const: "sticker" }, stickerId: { type: "string" }, description: { type: "string" }, resourceUrl: { type: "string" } },
      required: ["type", "stickerId", "description"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { const: "transfer" },
        note: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string" },
        direction: { enum: ["received", "paid"] }
      },
      required: ["type", "amount", "currency", "direction"],
      additionalProperties: false
    }
  ]
} as const;

const primeActionSchema = {
  anyOf: [
    {
      type: "object",
      properties: { type: { const: "send_message" }, message: primeMessageContentSchema, delayMinutes: { type: "number" }, actionRationale: { type: "string" } },
      required: ["type", "message", "actionRationale"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: { type: { const: "schedule_message" }, message: primeMessageContentSchema, sendAtMs: { type: "number" }, actionRationale: { type: "string" } },
      required: ["type", "message", "sendAtMs", "actionRationale"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: { type: { const: "update_schedule" }, patch: { type: "object" }, actionRationale: { type: "string" } },
      required: ["type", "patch", "actionRationale"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: { type: { const: "update_itinerary" }, patch: { type: "object" }, actionRationale: { type: "string" } },
      required: ["type", "patch", "actionRationale"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { const: "mutate_variable" },
        key: { type: "string" },
        operation: { enum: ["set", "increment", "decrement"] },
        value: {},
        actionRationale: { type: "string" }
      },
      required: ["type", "key", "operation", "value", "actionRationale"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { const: "upsert_memory" },
        content: { type: "string" },
        importance: { type: "number" },
        sourceMessageIds: { type: "array", items: { type: "string" } },
        actionRationale: { type: "string" }
      },
      required: ["type", "content", "importance", "sourceMessageIds", "actionRationale"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: { type: { const: "silence" }, revisitAfterMinutes: { type: "number" }, actionRationale: { type: "string" } },
      required: ["type", "actionRationale"],
      additionalProperties: false
    }
  ]
} as const;

const PRIME_DECISION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "prime_figure_decision",
    strict: true,
    schema: {
      type: "object",
      properties: {
        decisionSummary: { type: "string" },
        stateAssessment: {
          type: "object",
          properties: {
            userIntent: { type: "string" },
            figureMood: { type: "string" },
            relationshipSignal: { type: "string" },
            riskLevel: { enum: ["low", "medium", "high"] }
          },
          required: ["userIntent", "figureMood", "riskLevel"],
          additionalProperties: false
        },
        actions: { type: "array", items: primeActionSchema },
        memoryWrites: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              importance: { type: "number" },
              sourceMessageIds: { type: "array", items: { type: "string" } }
            },
            required: ["content", "importance", "sourceMessageIds"],
            additionalProperties: false
          }
        },
        nextWakeupAtMs: { type: "number" }
      },
      required: ["decisionSummary", "stateAssessment", "actions", "memoryWrites"],
      additionalProperties: false
    }
  }
} as const;
