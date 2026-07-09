import { buildFigureSystemPrompt } from "@echoo/shared";
import type { Agent, Message, UserProfile } from "@echoo/shared";
import type { ChatCompletionMessage } from "../ai/ai-provider.interface.js";
import { AiProviderRegistry } from "../ai/ai-provider.registry.js";
import { UserRepository, toUserProfile } from "../auth/user.repository.js";
import { MessageRepository } from "../messaging/message.repository.js";
import { AgentRepository } from "./agent.repository.js";

const CONTEXT_ROUND_STEP = 100;
const CONTEXT_MESSAGE_LIMIT = 500;

export interface AgentRuntimeResult {
  text: string;
  providerId: string;
  model: string;
}

export interface AgentRuntimeDelta {
  text: string;
}

export class AgentRuntimeService {
  constructor(
    private readonly agents = new AgentRepository(),
    private readonly messages = new MessageRepository(),
    private readonly providers = new AiProviderRegistry(),
    private readonly users = new UserRepository()
  ) {}

  async createReply(input: { ownerUserId: string; conversationId: string }): Promise<AgentRuntimeResult | null> {
    const agent = this.agents.findByConversation(input.ownerUserId, input.conversationId);
    if (!agent) return null;
    const user = this.findUserProfile(input.ownerUserId);

    const provider = this.providers.getDefaultProvider();
    const model = this.providers.getDefaultModel();
    const result = await provider.createChatCompletion({
      model,
      sessionId: input.conversationId,
      messages: this.buildChatMessages(agent, user, this.messages.listRecentForContext(input.ownerUserId, input.conversationId, CONTEXT_MESSAGE_LIMIT)),
      temperature: Number(process.env.DEFAULT_TEXT_TEMPERATURE ?? 0.8),
      maxTokens: process.env.DEFAULT_TEXT_MAX_TOKENS ? Number(process.env.DEFAULT_TEXT_MAX_TOKENS) : undefined
    });

    return {
      text: result.text,
      providerId: result.providerId,
      model: result.model
    };
  }

  async createStreamingReply(
    input: { ownerUserId: string; conversationId: string },
    onDelta: (delta: AgentRuntimeDelta) => void
  ): Promise<AgentRuntimeResult | null> {
    const agent = this.agents.findByConversation(input.ownerUserId, input.conversationId);
    if (!agent) return null;
    const user = this.findUserProfile(input.ownerUserId);

    const provider = this.providers.getDefaultProvider();
    const model = this.providers.getDefaultModel();
    const completion = {
      model,
      sessionId: input.conversationId,
      messages: this.buildChatMessages(agent, user, this.messages.listRecentForContext(input.ownerUserId, input.conversationId, CONTEXT_MESSAGE_LIMIT)),
      temperature: Number(process.env.DEFAULT_TEXT_TEMPERATURE ?? 0.8),
      maxTokens: process.env.DEFAULT_TEXT_MAX_TOKENS ? Number(process.env.DEFAULT_TEXT_MAX_TOKENS) : undefined
    };

    if (!provider.streamChatCompletion) {
      const result = await provider.createChatCompletion(completion);
      onDelta({ text: result.text });
      return result;
    }

    let text = "";

    for await (const delta of provider.streamChatCompletion(completion)) {
      if (!delta.text) continue;
      text += delta.text;
      onDelta({ text: delta.text });
    }

    if (!text.trim()) throw new Error(`${provider.id} chat completion returned an empty streamed response.`);

    return {
      text,
      providerId: provider.id,
      model
    };
  }

  private buildChatMessages(agent: Agent, user: UserProfile | null, history: Message[]): ChatCompletionMessage[] {
    return [
      {
        role: "system",
        content: buildFigureSystemPrompt(agent, { user })
      },
      ...selectContextMessages(agent, history)
    ];
  }

  private findUserProfile(ownerUserId: string) {
    const user = this.users.findById(ownerUserId);
    return user ? toUserProfile(user) : null;
  }
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
