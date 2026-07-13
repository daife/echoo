import { buildFigureSystemPrompt } from "@echoo/shared";
import type { Message, SliceFigureAgent, UserProfile } from "@echoo/shared";
import type {
  ChatCompletionInput,
  ChatCompletionMessage,
} from "../../../ai/ai-provider.interface.js";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import {
  UserRepository,
  toUserProfile,
} from "../../../auth/user.repository.js";
import { getFigureContextWindowConfig } from "../../../../infra/config/context-window-config.js";
import { MessageRepository } from "../../../messaging/message.repository.js";
import { AgentRepository } from "../../agent.repository.js";

export interface SliceFigureRuntimeResult {
  text: string;
  providerId: string;
  model: string;
}

export class SliceFigureRuntimeService {
  constructor(
    private readonly agents = new AgentRepository(),
    private readonly messages = new MessageRepository(),
    private readonly providers = new AiProviderRegistry(),
    private readonly users = new UserRepository(),
  ) {}

  async createReply(input: {
    ownerUserId: string;
    conversationId: string;
  }): Promise<SliceFigureRuntimeResult | null> {
    const context = await this.loadContext(input);
    if (!context) return null;

    const provider = this.providers.getDefaultProvider();
    const model = this.providers.getDefaultModel();
    const result = await provider.createChatCompletion({
      model,
      sessionId: input.conversationId,
      messages: buildChatMessages(
        context.agent,
        context.user,
        context.history,
        context.isInitialWindow,
      ),
      temperature: Number(process.env.DEFAULT_TEXT_TEMPERATURE ?? 0.8),
      maxTokens: process.env.DEFAULT_TEXT_MAX_TOKENS
        ? Number(process.env.DEFAULT_TEXT_MAX_TOKENS)
        : undefined,
      reasoningMode: "disabled",
    });

    return {
      text: result.text,
      providerId: result.providerId,
      model: result.model,
    };
  }

  async createStreamingReply(
    input: { ownerUserId: string; conversationId: string },
    onDelta: (delta: { text: string }) => void,
  ): Promise<SliceFigureRuntimeResult | null> {
    const context = await this.loadContext(input);
    if (!context) return null;

    const provider = this.providers.getDefaultProvider();
    const model = this.providers.getDefaultModel();
    const completion: ChatCompletionInput = {
      model,
      sessionId: input.conversationId,
      messages: buildChatMessages(
        context.agent,
        context.user,
        context.history,
        context.isInitialWindow,
      ),
      temperature: Number(process.env.DEFAULT_TEXT_TEMPERATURE ?? 0.8),
      maxTokens: process.env.DEFAULT_TEXT_MAX_TOKENS
        ? Number(process.env.DEFAULT_TEXT_MAX_TOKENS)
        : undefined,
      reasoningMode: "disabled",
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
    if (!text.trim())
      throw new Error(
        `${provider.id} chat completion returned an empty streamed response.`,
      );

    return { text, providerId: provider.id, model };
  }

  private async loadContext(input: {
    ownerUserId: string;
    conversationId: string;
  }) {
    const agent = await this.agents.findByConversation(
      input.ownerUserId,
      input.conversationId,
    );
    if (!agent) return null;
    if (agent.type !== "slice-figure")
      throw new Error(`切片角色运行时收到了错误的角色类型：${agent.type}。`);

    const user = await this.users.findById(input.ownerUserId);
    const contextWindowConfig =
      getFigureContextWindowConfig().sliceFigureRounds;
    const contextWindow = await this.messages.listSliceFigureContextWindow(
      input.ownerUserId,
      input.conversationId,
      contextWindowConfig.minimum,
      contextWindowConfig.maximum,
    );
    return {
      agent,
      user: user ? toUserProfile(user) : null,
      history: contextWindow.messages,
      isInitialWindow: contextWindow.isInitialWindow,
    };
  }
}

function buildChatMessages(
  agent: SliceFigureAgent,
  user: UserProfile | null,
  history: Message[],
  isInitialWindow: boolean,
): ChatCompletionMessage[] {
  return [
    {
      role: "system",
      content: buildFigureSystemPrompt(agent.detail, { user }),
    },
    ...selectSliceFigureContextMessages(agent, history, isInitialWindow),
  ];
}

export function selectSliceFigureContextMessages(
  agent: SliceFigureAgent,
  history: Message[],
  isInitialWindow: boolean,
): ChatCompletionMessage[] {
  const textHistory = history.filter((message) => {
    if (message.contentType !== "text" || message.status === "failed")
      return false;
    if (message.role !== "user" && message.role !== "assistant") return false;
    return Boolean(message.content.text?.trim());
  });
  const hasPersistedOpeningLine = textHistory.some(
    (message) =>
      message.role === "assistant" && message.metadata?.kind === "opening_line",
  );
  const selected: ChatCompletionMessage[] = [];

  if (
    isInitialWindow &&
    agent.detail.openingLine.trim() &&
    !hasPersistedOpeningLine
  )
    selected.push({
      role: "assistant",
      content: agent.detail.openingLine.trim(),
    });

  for (const message of textHistory) {
    selected.push({
      role: message.role,
      content: message.content.text?.trim() ?? "",
    });
  }
  return selected;
}
