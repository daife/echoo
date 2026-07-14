import {
  buildFigureMemorySummaryPrompt,
  buildFigureSystemPrompt,
} from "@echoo/shared";
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
import { MessageRepository } from "../../../messaging/message.repository.js";
import { AgentRepository } from "../../agent.repository.js";
import { randomUUID } from "node:crypto";
import { RuntimeConfigService } from "../../../runtime-config/runtime-config.service.js";
import type { StoredSliceFigureRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";

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
    private readonly runtimeConfigs = new RuntimeConfigService(),
  ) {}

  async createPendingMemorySummaries(input: {
    ownerUserId: string;
    conversationId: string;
  }): Promise<Message[]> {
    const agent = await this.agents.findByConversation(
      input.ownerUserId,
      input.conversationId,
    );
    if (!agent || agent.type !== "slice-figure") return [];
    const userRecord = await this.users.findById(input.ownerUserId);
    const user = userRecord ? toUserProfile(userRecord) : null;
    const runtimeConfig = (
      await this.runtimeConfigs.resolveConversationConfig(
        input.ownerUserId,
        input.conversationId,
      )
    ).config as StoredSliceFigureRuntimeConfig;
    const provider = this.providers.createProvider(runtimeConfig.llm);
    const model = runtimeConfig.llm.model;
    const rounds = runtimeConfig.context.memorySummaryRounds;
    const completed: Message[] = [];

    for (;;) {
      const previous = await this.messages.findLatestMemorySummary(
        input.ownerUserId,
        input.conversationId,
      );
      const previousBoundary = memorySummaryBoundary(previous);
      const startSequence = previousBoundary ?? 0;
      const boundary = await this.messages.findSliceMemorySummaryBoundary(
        input.ownerUserId,
        input.conversationId,
        startSequence,
        rounds,
      );
      if (!boundary?.sequence) break;

      const source = await this.messages.listSliceMemorySummarySource(
        input.ownerUserId,
        input.conversationId,
        startSequence,
        boundary.sequence,
      );
      const now = Date.now();
      const pending =
        (await this.messages.findPendingMemorySummary(
          input.ownerUserId,
          input.conversationId,
          boundary.sequence,
        )) ??
        (await this.messages.save({
          ownerUserId: input.ownerUserId,
          id: `msg_${randomUUID()}`,
          conversationId: input.conversationId,
          role: "system",
          contentType: "system",
          content: { text: "" },
          status: "pending",
          metadata: {
            kind: "memory_summary",
            version: 1,
            coveredFromSequence: startSequence + 1,
            coveredThroughSequence: boundary.sequence,
            coveredRoundCount: rounds,
            ...(previous ? { previousSummaryId: previous.id } : {}),
          },
          createdAt: now,
          updatedAt: now,
        }));

      const prompt = buildFigureMemorySummaryPrompt(agent.detail, { user });
      const entries = [
        ...(previous?.content.text?.trim()
          ? [`【上一份记忆总结】\n${previous.content.text.trim()}`]
          : []),
        ...source.map(formatMemorySourceMessage),
      ];
      const result = await summarizeEntries({
        provider,
        model,
        prompt,
        entries,
        maxTokens: runtimeConfig.llm.maxTokens,
      });
      const message = await this.messages.completeMemorySummary({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        messageId: pending.id,
        text: result.text,
        providerId: result.providerId,
        model: result.model,
        updatedAt: Date.now(),
      });
      if (!message) break;
      completed.push(message);
    }
    return completed;
  }

  async createStreamingReply(
    input: { ownerUserId: string; conversationId: string },
    onDelta: (delta: { text: string }) => void,
  ): Promise<SliceFigureRuntimeResult | null> {
    const runtimeConfig = (
      await this.runtimeConfigs.resolveConversationConfig(
        input.ownerUserId,
        input.conversationId,
      )
    ).config as StoredSliceFigureRuntimeConfig;
    const context = await this.loadContext(input, runtimeConfig);
    if (!context) return null;

    const provider = this.providers.createProvider(runtimeConfig.llm);
    const model = runtimeConfig.llm.model;
    const completion: ChatCompletionInput = {
      model,
      sessionId: input.conversationId,
      messages: buildChatMessages(
        context.agent,
        context.user,
        context.history,
        context.isInitialWindow,
      ),
      temperature: runtimeConfig.llm.temperature,
      maxTokens: runtimeConfig.llm.maxTokens,
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

  private async loadContext(
    input: {
      ownerUserId: string;
      conversationId: string;
    },
    runtimeConfig: StoredSliceFigureRuntimeConfig,
  ) {
    const agent = await this.agents.findByConversation(
      input.ownerUserId,
      input.conversationId,
    );
    if (!agent) return null;
    if (agent.type !== "slice-figure")
      throw new Error(`切片角色运行时收到了错误的角色类型：${agent.type}。`);

    const user = await this.users.findById(input.ownerUserId);
    const contextWindowConfig = runtimeConfig.context;
    const contextWindow = await this.messages.listSliceFigureContextWindow(
      input.ownerUserId,
      input.conversationId,
      contextWindowConfig.minimumRounds,
      contextWindowConfig.maximumRounds,
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
  const memorySummary = history.find(
    (message) =>
      message.role === "system" &&
      message.contentType === "system" &&
      message.metadata?.kind === "memory_summary" &&
      Boolean(message.content.text?.trim()),
  );
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

  if (memorySummary)
    selected.push({
      role: "system",
      content: `此前对话的滚动记忆总结：\n${memorySummary.content.text?.trim() ?? ""}`,
    });

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

function memorySummaryBoundary(message: Message | null) {
  const value = message?.metadata?.coveredThroughSequence;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatMemorySourceMessage(message: Message) {
  const opening = message.metadata?.kind === "opening_line";
  const sender =
    message.role === "user" ? "用户" : opening ? "角色开场白" : "角色";
  return `【${sender}】${message.content.text?.trim() ?? ""}`;
}

async function summarizeEntries(input: {
  provider: ReturnType<AiProviderRegistry["createProvider"]>;
  model: string;
  prompt: string;
  entries: string[];
  maxTokens: number;
}) {
  const chunks = chunkEntries(input.entries, 60_000);
  const partials = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const result = await input.provider.createChatCompletion({
      model: input.model,
      messages: [
        { role: "system", content: input.prompt },
        {
          role: "user",
          content:
            chunks.length === 1
              ? chunks[index]!
              : `这是当前总结周期的第 ${index + 1}/${chunks.length} 个片段。请先总结这一片段：\n\n${chunks[index]}`,
        },
      ],
      temperature: 0.2,
      maxTokens: input.maxTokens,
      reasoningMode: "disabled",
    });
    partials.push(result);
  }
  if (partials.length === 1) return partials[0]!;
  return summarizeEntries({
    ...input,
    entries: partials.map(
      (partial, index) => `【片段总结 ${index + 1}】\n${partial.text}`,
    ),
  });
}

function chunkEntries(entries: string[], maximumCharacters: number) {
  const chunks: string[] = [];
  let current = "";
  for (const entry of entries) {
    const next = current ? `${current}\n\n${entry}` : entry;
    if (current && next.length > maximumCharacters) {
      chunks.push(current);
      current = entry;
    } else current = next;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : ["没有可总结的对话内容。"];
}
