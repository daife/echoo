import type { UserProfile } from "@echoo/shared";
import type { ChatCompletionInput } from "../ai/ai-provider.interface.js";
import { AiProviderRegistry } from "../ai/ai-provider.registry.js";
import { UserRepository, toUserProfile } from "../auth/user.repository.js";
import { MessageRepository } from "../messaging/message.repository.js";
import { AgentRuntimeRegistry } from "./agent-runtime.registry.js";
import { AgentRepository } from "./agent.repository.js";

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
    private readonly users = new UserRepository(),
    private readonly runtimes = new AgentRuntimeRegistry()
  ) {}

  async createReply(input: { ownerUserId: string; conversationId: string }): Promise<AgentRuntimeResult | null> {
    const agent = this.agents.findByConversation(input.ownerUserId, input.conversationId);
    if (!agent) return null;
    const user = this.findUserProfile(input.ownerUserId);
    const runtime = this.runtimes.get(agent.type);
    if (!runtime) throw new Error(`Agent runtime not registered: ${agent.type}`);

    const provider = this.providers.getDefaultProvider();
    const model = this.providers.getDefaultModel();
    const result = await provider.createChatCompletion({
      model,
      sessionId: input.conversationId,
      messages: runtime.buildChatMessages(agent, user, this.messages.listRecentForContext(input.ownerUserId, input.conversationId, CONTEXT_MESSAGE_LIMIT)),
      temperature: Number(process.env.DEFAULT_TEXT_TEMPERATURE ?? 0.8),
      maxTokens: process.env.DEFAULT_TEXT_MAX_TOKENS ? Number(process.env.DEFAULT_TEXT_MAX_TOKENS) : undefined,
      reasoningMode: "disabled"
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
    const runtime = this.runtimes.get(agent.type);
    if (!runtime) throw new Error(`Agent runtime not registered: ${agent.type}`);

    const provider = this.providers.getDefaultProvider();
    const model = this.providers.getDefaultModel();
    const completion: ChatCompletionInput = {
      model,
      sessionId: input.conversationId,
      messages: runtime.buildChatMessages(agent, user, this.messages.listRecentForContext(input.ownerUserId, input.conversationId, CONTEXT_MESSAGE_LIMIT)),
      temperature: Number(process.env.DEFAULT_TEXT_TEMPERATURE ?? 0.8),
      maxTokens: process.env.DEFAULT_TEXT_MAX_TOKENS ? Number(process.env.DEFAULT_TEXT_MAX_TOKENS) : undefined,
      reasoningMode: "disabled"
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

  private findUserProfile(ownerUserId: string) {
    const user = this.users.findById(ownerUserId);
    return user ? toUserProfile(user) : null;
  }
}
