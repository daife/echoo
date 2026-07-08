import type { Agent, Message } from "@echoo/shared";
import type { ChatCompletionMessage } from "../ai/ai-provider.interface.js";
import { AiProviderRegistry } from "../ai/ai-provider.registry.js";
import { MessageRepository } from "../messaging/message.repository.js";
import { AgentRepository } from "./agent.repository.js";

const CONTEXT_ROUND_STEP = 100;

export interface AgentRuntimeResult {
  text: string;
  providerId: string;
  model: string;
  raw?: unknown;
}

export class AgentRuntimeService {
  constructor(
    private readonly agents = new AgentRepository(),
    private readonly messages = new MessageRepository(),
    private readonly providers = new AiProviderRegistry()
  ) {}

  async createReply(input: { ownerUserId: string; conversationId: string }): Promise<AgentRuntimeResult | null> {
    const agent = this.agents.findByConversation(input.ownerUserId, input.conversationId);
    if (!agent) return null;

    const provider = this.providers.getDefaultProvider();
    const model = this.providers.getDefaultModel();
    const result = await provider.createChatCompletion({
      model,
      sessionId: input.conversationId,
      messages: this.buildChatMessages(agent, this.messages.listByConversation(input.ownerUserId, input.conversationId)),
      temperature: Number(process.env.DEFAULT_TEXT_TEMPERATURE ?? 0.8),
      maxTokens: process.env.DEFAULT_TEXT_MAX_TOKENS ? Number(process.env.DEFAULT_TEXT_MAX_TOKENS) : undefined
    });

    return {
      text: result.text,
      providerId: result.providerId,
      model: result.model,
      raw: result.raw
    };
  }

  private buildChatMessages(agent: Agent, history: Message[]): ChatCompletionMessage[] {
    return [
      {
        role: "system",
        content: buildSystemPrompt(agent)
      },
      ...selectContextMessages(agent, history)
    ];
  }
}

function buildSystemPrompt(agent: Agent) {
  const attributes = agent.attributes.length
    ? agent.attributes.map((attribute) => `- ${attribute.key}: ${attribute.value}`).join("\n")
    : "- 未设定";

  return [
    `你是“${agent.name}”。`,
    "",
    "你的属性：",
    attributes,
    "",
    "你的人设：",
    agent.persona || "未设定。",
    "",
    "你的背景：",
    agent.background || "未设定。",
    "",
    "你的性格：",
    agent.personality || "未设定。",
    "",
    "严格遵守以下回复风格：",
    agent.responseStyle || "自然、简洁、有情绪感知力。",
    "",
    "请始终以这个身份与用户自然对话，不要跳出角色。"
  ].join("\n");
}

function selectContextMessages(agent: Agent, history: Message[]): ChatCompletionMessage[] {
  const textHistory = history.filter((message) => {
    if (message.contentType !== "text") return false;
    if (message.status === "failed") return false;
    if (message.role !== "user" && message.role !== "assistant") return false;
    return Boolean(message.content.text?.trim());
  });

  const userRoundCount = textHistory.filter((message) => message.role === "user").length;
  const startRound = Math.floor(Math.max(0, userRoundCount - CONTEXT_ROUND_STEP) / CONTEXT_ROUND_STEP) * CONTEXT_ROUND_STEP;
  const hasPersistedOpeningLine = textHistory.some(
    (message) => message.role === "assistant" && message.metadata?.kind === "opening_line"
  );
  const selected: ChatCompletionMessage[] = [];

  if (startRound === 0 && agent.openingLine.trim() && !hasPersistedOpeningLine) {
    selected.push({ role: "assistant", content: agent.openingLine.trim() });
  }

  let currentRound = 0;
  for (const message of textHistory) {
    if (message.role === "user") {
      currentRound += 1;
    }

    const shouldInclude = startRound === 0 || currentRound >= startRound;
    if (!shouldInclude) continue;

    selected.push({
      role: message.role,
      content: message.content.text?.trim() ?? ""
    });
  }

  return selected;
}
