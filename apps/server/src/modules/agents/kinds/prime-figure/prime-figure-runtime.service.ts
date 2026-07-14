import {
  primeFigureDecisionSchema,
  primeMediaAnnotationSchema,
} from "@echoo/shared";
import type {
  PrimeFigureAgent,
  PrimeFigureDecision,
  PrimeFigureState,
  PrimeFigureVariableDefinition,
  PrimeFigureVariableValue,
  PrimeMediaAnnotation,
  PrimeMessage,
  PrimeMessageContent,
} from "@echoo/shared";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import { APP_TIME_ZONE } from "../../../../shared/constants/time.js";
import type {
  AiTextProvider,
  ChatCompletionInput,
  ChatCompletionContentPart,
  ChatCompletionMessage,
  ChatCompletionResult,
  ChatToolCall,
  ChatToolDefinition,
} from "../../../ai/ai-provider.interface.js";
import { AgentRepository } from "../../agent.repository.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";
import { ConversationRepository } from "../../../conversations/conversation.repository.js";
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";
import { PrimeActionExecutor } from "./prime-action-executor.js";
import { PrimeMessageRepository } from "./prime-message.repository.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";
import { PrimeDecisionStreamParser } from "./prime-decision-stream-parser.js";
import { PrimeDecisionStreamSession } from "./prime-decision-stream-session.js";
import { PrimeConversationMediaRepository } from "./prime-conversation-media.repository.js";
import {
  describeAge,
  findScheduleSegment,
  formatReadableMinute,
  formatWeekdayCode,
} from "./prime-time.js";
import { RuntimeConfigService } from "../../../runtime-config/runtime-config.service.js";
import type { StoredPrimeFigureRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";

const PRIME_VISIBLE_MEMORY_LIMIT = 10;
const RECALL_HINT_PATTERN = /记得|不记得|忘了|还记得|remember|forgot|recal+l/i;

export type PrimeDecisionTrigger =
  "end_user_message" | "mute_ended" | "coalesced_messages" | "debug_hint";

interface PendingMediaAnnotation {
  id: string;
  messageId: string;
  type: "image" | "video" | "voice";
  resourceId: string;
}

interface PrimeDecisionRequest {
  ownerUserId: string;
  conversationId: string;
  trigger: PrimeDecisionTrigger;
  debugInstruction?: string;
  onModelActivityChange?: (active: boolean) => void;
  agent: PrimeFigureAgent;
  state: PrimeFigureState;
  runtimeConfig: StoredPrimeFigureRuntimeConfig;
}

interface PrimeCompletionDiagnostics {
  rawResponse: string;
  providerId: string;
  model: string;
}

export class PrimeFigureRuntimeService {
  constructor(
    private readonly agents = new AgentRepository(),
    private readonly states = new PrimeFigureStateRepository(),
    private readonly messages = new PrimeMessageRepository(),
    private readonly providers = new AiProviderRegistry(),
    private readonly executor = new PrimeActionExecutor(),
    private readonly logs = new PrimeActionLogRepository(),
    private readonly resources = new ResourceRepository(),
    private readonly conversationMedia = new PrimeConversationMediaRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly runtimeConfigs = new RuntimeConfigService(),
  ) {}

  async requestDecision(input: {
    ownerUserId: string;
    conversationId: string;
    trigger?: PrimeDecisionTrigger;
    debugInstruction?: string;
    onModelActivityChange?: (active: boolean) => void;
  }): Promise<PrimeFigureDecision | null> {
    const trigger = input.trigger ?? "end_user_message";
    const agent = await this.agents.findByConversation(
      input.ownerUserId,
      input.conversationId,
    );
    if (!agent || agent.type !== "prime-figure") return null;
    const state = await this.states.findByAgent(input.ownerUserId, agent.id);
    if (!state) {
      await this.logs.save({
        ownerUserId: input.ownerUserId,
        agentId: agent.id,
        conversationId: input.conversationId,
        action: { type: "prime_runtime", trigger },
        status: "failed",
        errorMessage: "本初角色状态缺失。",
      });
      return null;
    }
    if (
      trigger !== "debug_hint" &&
      state.silenceUntilMs &&
      state.silenceUntilMs > Date.now()
    )
      return null;

    const runtimeConfig = (
      await this.runtimeConfigs.resolveConversationConfig(
        input.ownerUserId,
        input.conversationId,
      )
    ).config as StoredPrimeFigureRuntimeConfig;

    if (trigger !== "debug_hint")
      await this.waitForEndUserQuiet(
        input.ownerUserId,
        input.conversationId,
        runtimeConfig.messageCoalesceMs,
      );
    try {
      return await this.createDecisionOnce({
        ...input,
        trigger,
        agent,
        state,
        runtimeConfig,
      });
    } catch (error) {
      await this.logs.save({
        ownerUserId: input.ownerUserId,
        agentId: agent.id,
        conversationId: input.conversationId,
        action: { type: "prime_runtime", trigger },
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "本初角色运行时执行失败。",
      });
      return null;
    }
  }

  private async waitForEndUserQuiet(
    ownerUserId: string,
    conversationId: string,
    quietMs: number,
  ) {
    quietMs = Math.max(0, quietMs);
    while (quietMs > 0) {
      const latest = await this.messages.findLatestEndUserCreatedAt(
        ownerUserId,
        conversationId,
      );
      if (latest === null) return;
      const remaining = latest + quietMs - Date.now();
      if (remaining <= 0) return;
      await delay(Math.min(remaining, quietMs));
    }
  }

  private async createDecisionOnce(input: PrimeDecisionRequest) {
    const context = await this.loadDecisionContext(input);
    if (!context) return null;
    const provider = this.providers.createProvider(input.runtimeConfig.llm);
    const model = input.runtimeConfig.llm.model;
    const packet = await buildPrimeChatMessages(
      input.agent,
      input.state,
      context.timeline,
      input.trigger,
      input.ownerUserId,
      this.resources,
      this.conversationMedia,
      context.lastHandledEndUserSeq,
      input.debugInstruction,
    );
    const streamSession = new PrimeDecisionStreamSession({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      voiceRequestStreaming: input.agent.detail.voiceRequestStreaming,
      runtimeConfig: input.runtimeConfig,
    });
    const completionBase = {
      model,
      sessionId: input.conversationId,
      temperature: input.runtimeConfig.llm.temperature,
      maxTokens: input.runtimeConfig.llm.maxTokens,
      reasoningMode: "disabled" as const,
    };

    const diagnostics: PrimeCompletionDiagnostics = {
      rawResponse: "",
      providerId: provider.id,
      model,
    };
    try {
      input.onModelActivityChange?.(true);
      let finalResponse: ChatCompletionResult;
      try {
        finalResponse = await this.completeWithOptionalRecall({
          request: input,
          provider,
          completionBase,
          packet,
          streamSession,
          diagnostics,
        });
      } finally {
        input.onModelActivityChange?.(false);
      }
      const envelope = parsePrimeDecisionEnvelope(
        finalResponse.text,
        packet.pendingMedia,
        packet.availableReferenceImages.map((media) => media.id),
      );
      const { decision, mediaAnnotations } = envelope;
      const streamed = await streamSession.finalize(decision);
      for (const [
        actionIndex,
        errorMessage,
      ] of streamed.imageGenerationErrors) {
        await this.logs.save({
          ownerUserId: input.ownerUserId,
          agentId: input.agent.id,
          conversationId: input.conversationId,
          action: { type: "image_generation", actionIndex },
          status: "failed",
          errorMessage,
        });
      }
      await this.executor.executeDecision({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        agent: input.agent,
        state: input.state,
        decision,
        providerId: finalResponse.providerId,
        model: finalResponse.model,
        muteMessageCutoffAtMs: context.inputThroughEndUserAtMs,
        streamedMessageIds: streamed.messageIds,
        messageCreatedAt: streamed.messageCreatedAt,
        voiceMedia: streamed.voiceMedia,
        ttsErrors: streamed.ttsErrors,
        imageMedia: streamed.imageMedia,
        imageGenerationErrors: streamed.imageGenerationErrors,
      });
      await this.persistMediaAnnotations(
        input,
        packet.pendingMedia,
        mediaAnnotations,
      );
      await this.conversations.advancePrimeHandledEndUserSequence(
        input.ownerUserId,
        input.conversationId,
        context.inputThroughEndUserSeq,
      );
      return decision;
    } catch (error) {
      await streamSession.fail(error, diagnostics);
      throw error;
    }
  }

  private async loadDecisionContext(input: PrimeDecisionRequest) {
    const storedHandledEndUserSeq =
      await this.conversations.getPrimeHandledEndUserSequence(
        input.ownerUserId,
        input.conversationId,
      );
    const lastHandledEndUserSeq =
      storedHandledEndUserSeq ??
      (await this.messages.findLatestAssistantSequence(
        input.ownerUserId,
        input.conversationId,
      ));
    const window = input.runtimeConfig.context;
    const [recentTimeline, unhandledEndUserMessages] = await Promise.all([
      this.messages.listContextWindow(
        input.ownerUserId,
        input.conversationId,
        window.minimumMessages,
        window.maximumMessages,
      ),
      this.messages.listEndUserAfterSequence(
        input.ownerUserId,
        input.conversationId,
        lastHandledEndUserSeq,
      ),
    ]);
    if (
      !unhandledEndUserMessages.length &&
      !(input.trigger === "debug_hint" && input.debugInstruction?.trim())
    )
      return null;
    const timeline = mergePrimeTimeline(
      recentTimeline,
      unhandledEndUserMessages,
    );
    return {
      timeline,
      lastHandledEndUserSeq,
      inputThroughEndUserSeq: timeline.reduce(
        (latest, message) =>
          message.sender === "end_user"
            ? Math.max(latest, message.sequence ?? 0)
            : latest,
        lastHandledEndUserSeq,
      ),
      inputThroughEndUserAtMs: timeline.reduce(
        (latest, message) =>
          message.sender === "end_user"
            ? Math.max(latest, message.occurredAtMs)
            : latest,
        0,
      ),
    };
  }

  private async completeWithOptionalRecall(input: {
    request: PrimeDecisionRequest;
    provider: AiTextProvider;
    completionBase: Omit<ChatCompletionInput, "messages">;
    packet: Awaited<ReturnType<typeof buildPrimeChatMessages>>;
    streamSession: PrimeDecisionStreamSession;
    diagnostics: PrimeCompletionDiagnostics;
  }) {
    const messages = [...input.packet.messages];
    const availableReferenceImageIds =
      input.packet.availableReferenceImages.map((media) => media.id);
    const recordResponse = (response: ChatCompletionResult) => {
      input.diagnostics.rawResponse = response.text;
      input.diagnostics.providerId = response.providerId;
      input.diagnostics.model = response.model;
      return response;
    };
    const firstResponse = recordResponse(
      await streamPrimeChatCompletion(
        input.provider,
        {
          ...input.completionBase,
          messages,
          tools: [SEARCH_RECALL_TOOL],
          toolChoice: "auto",
          responseFormat: buildPrimeDecisionResponseFormat(
            input.request.agent,
            false,
            input.packet.pendingMedia,
            availableReferenceImageIds,
          ),
        },
        input.streamSession,
      ),
    );
    const recallCall = firstResponse.toolCalls?.find(
      (call) => call.function.name === "search_recall",
    );
    if (!recallCall) return firstResponse;
    messages.push({
      role: "assistant",
      content: firstResponse.text,
      toolCalls: firstResponse.toolCalls,
    });
    messages.push({
      role: "tool",
      toolCallId: recallCall.id,
      name: recallCall.function.name,
      content: await this.executeRecallTool(recallCall, input.request),
    });
    return recordResponse(
      await streamPrimeChatCompletion(
        input.provider,
        {
          ...input.completionBase,
          messages,
          responseFormat: buildPrimeDecisionResponseFormat(
            input.request.agent,
            true,
            input.packet.pendingMedia,
            availableReferenceImageIds,
          ),
          toolChoice: "none",
        },
        input.streamSession,
      ),
    );
  }

  private async persistMediaAnnotations(
    input: {
      ownerUserId: string;
      conversationId: string;
      agent: PrimeFigureAgent;
    },
    pending: PendingMediaAnnotation[],
    annotations: PrimeMediaAnnotation[],
  ) {
    const targetById = new Map(pending.map((target) => [target.id, target]));
    for (const annotation of annotations) {
      const target = targetById.get(annotation.id);
      if (!target) continue;
      try {
        const value =
          annotation.type === "voice"
            ? annotation.transcript
            : annotation.description;
        const updated = await this.messages.applyMediaAnnotation({
          ownerUserId: input.ownerUserId,
          messageId: target.messageId,
          conversationId: input.conversationId,
          expectedType: target.type,
          value,
        });
        if (!updated) throw new Error("待标注媒体消息不存在或类型已改变。");
        await this.conversationMedia.ensure({
          ownerUserId: input.ownerUserId,
          conversationId: input.conversationId,
          resourceId: target.resourceId,
          mediaType: target.type,
          description: value,
        });
      } catch (error) {
        await this.logs.save({
          ownerUserId: input.ownerUserId,
          agentId: input.agent.id,
          conversationId: input.conversationId,
          action: { type: "media_annotation", annotationId: annotation.id },
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "媒体标注写入失败。",
        });
      }
    }
  }

  private async executeRecallTool(
    toolCall: ChatToolCall,
    context: {
      ownerUserId: string;
      agent: PrimeFigureAgent;
      state: PrimeFigureState;
    },
  ) {
    const args = parseRecallArguments(toolCall.function.arguments);
    const timezone = APP_TIME_ZONE;
    const history = (
      await this.messages.searchByKeywords(
        context.ownerUserId,
        context.agent.id,
        args.keywords,
        args.limit,
      )
    ).map((message) => [
      formatReadableMinute(message.occurredAtMs, timezone),
      toLlmSender(message.sender),
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

async function streamPrimeChatCompletion(
  provider: AiTextProvider,
  completion: ChatCompletionInput,
  session: PrimeDecisionStreamSession,
): Promise<ChatCompletionResult> {
  if (!provider.streamChatCompletion) {
    const result = await provider.createChatCompletion(completion);
    const parser = new PrimeDecisionStreamParser((event) =>
      session.handleField(event),
    );
    parser.push(result.text);
    return result;
  }

  const parser = new PrimeDecisionStreamParser((event) =>
    session.handleField(event),
  );
  const toolCalls = new Map<number, ChatToolCall>();
  let text = "";
  for await (const delta of provider.streamChatCompletion(completion)) {
    if (delta.text) {
      text += delta.text;
      parser.push(delta.text);
    }
    for (const toolDelta of delta.toolCalls ?? []) {
      const current = toolCalls.get(toolDelta.index) ?? {
        id: "",
        type: "function" as const,
        function: { name: "", arguments: "" },
      };
      if (toolDelta.id) current.id += toolDelta.id;
      if (toolDelta.function?.name)
        current.function.name += toolDelta.function.name;
      if (toolDelta.function?.arguments)
        current.function.arguments += toolDelta.function.arguments;
      toolCalls.set(toolDelta.index, current);
    }
  }
  const completedToolCalls = [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => call);
  if (!text.trim() && !completedToolCalls.length)
    throw new Error(
      `${provider.id} chat completion returned an empty streamed response.`,
    );
  return {
    providerId: provider.id,
    model: completion.model,
    text,
    ...(completedToolCalls.length ? { toolCalls: completedToolCalls } : {}),
  };
}

export async function buildPrimeChatMessages(
  agent: PrimeFigureAgent,
  state: PrimeFigureState,
  timeline: PrimeMessage[],
  trigger: PrimeDecisionTrigger,
  ownerUserId: string,
  resources: ResourceRepository,
  conversationMedia: PrimeConversationMediaRepository,
  lastHandledEndUserSeq: number,
  debugInstruction?: string,
): Promise<{
  messages: ChatCompletionMessage[];
  pendingMedia: PendingMediaAnnotation[];
  availableReferenceImages: Array<{ id: string; description: string }>;
}> {
  const timezone = APP_TIME_ZONE;
  const now = Date.now();
  const lastEndUserMessage = [...timeline]
    .reverse()
    .find((message) => message.sender === "end_user");
  const eventTime = lastEndUserMessage?.occurredAtMs ?? now;
  const scheduleSegment = findScheduleSegment(agent.detail.schedule, eventTime);
  const hints: string[] = [];
  const debugSystemInstruction =
    trigger === "debug_hint" && debugInstruction?.trim()
      ? buildDebugSystemInstruction(debugInstruction.trim())
      : undefined;
  if (debugSystemInstruction) hints.push(debugSystemInstruction);
  const attentionIdByMessage = new Map(
    timeline
      .filter(
        (message) =>
          message.sender === "end_user" &&
          (message.sequence ?? 0) > lastHandledEndUserSeq,
      )
      .map((message, index) => [message.id, `attention_${index + 1}`]),
  );
  if (attentionIdByMessage.size) {
    hints.push(
      `本次请求中新出现、figure 可能需要注意的 end_user 消息标记：${[
        ...attentionIdByMessage.values(),
      ].join(", ")}。结合完整时间线顺序统一回应，不要遗漏这些消息。`,
    );
  }

  if (
    lastEndUserMessage?.content.type === "text" &&
    RECALL_HINT_PATTERN.test(lastEndUserMessage.content.text)
  ) {
    hints.push(
      "当前 end_user 疑似要求回忆，可能需要考虑调用 search_recall。具体是否属于明确回忆请求由你判断。",
    );
  }
  if (scheduleSegment) {
    hints.push(
      `最近一条 end_user 消息发生在figure的“${scheduleSegment.label}”时段（${scheduleSegment.start}-${scheduleSegment.end}）：${sanitizeVisibleText(scheduleSegment.description, timezone)}`,
    );
  } else {
    hints.push("最近一条 end_user 消息不处于figure已定义的任何日程时段。");
  }
  if (trigger === "mute_ended") {
    hints.push(
      "figure此前选择的消息屏蔽期已经结束。屏蔽期间 end_user 发送了新的消息，需要作出一次决策。",
    );
  } else if (trigger === "coalesced_messages") {
    hints.push(
      "figure回复期间又收到了新的 end_user 消息，需要根据新消息继续作出一次决策。",
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

  const content: ChatCompletionContentPart[] = [];
  const pendingMedia: PendingMediaAnnotation[] = [];
  if (agent.coverResourcePath) {
    const cover = await resources.findByPublicPath(
      ownerUserId,
      agent.coverResourcePath,
    );
    if (!cover) throw new Error("figure 封面资源不存在或不属于当前用户。");
    await conversationMedia.ensure({
      ownerUserId,
      conversationId: agent.conversationId,
      resourceId: cover.id,
      mediaType: "image",
      description: "figure角色立绘",
      source: "figure_cover",
    });
  }
  for (const referenceImage of agent.detail.referenceImages) {
    const resource = await resources.findById(referenceImage.resourceId);
    if (!resource || resource.ownerUserId !== ownerUserId)
      throw new Error(
        `figure 创作者参考图片不存在或不属于当前用户：${referenceImage.resourceId}。`,
      );
    await conversationMedia.ensure({
      ownerUserId,
      conversationId: agent.conversationId,
      resourceId: resource.id,
      mediaType: "image",
      description: referenceImage.description,
      source: "figure_reference",
    });
  }
  for (const message of timeline) {
    const at = formatReadableMinute(message.occurredAtMs, timezone);
    const sender = toLlmSender(message.sender);
    const messageContent = message.content;
    const attentionId = attentionIdByMessage.get(message.id);

    if (messageContent.type === "text") {
      content.push({
        type: "text",
        text: JSON.stringify({
          at,
          sender,
          ...(attentionId ? { attentionId } : {}),
          type: "text",
          text: sanitizeVisibleText(messageContent.text, timezone),
        }),
      });
      continue;
    }

    if (messageContent.type === "image" || messageContent.type === "video") {
      const description = messageContent.description?.trim();
      const registeredMedia = messageContent.resourceId
        ? await conversationMedia.ensure({
            ownerUserId,
            conversationId: message.conversationId,
            resourceId: messageContent.resourceId,
            mediaType: messageContent.type,
            ...(description ? { description } : {}),
          })
        : null;
      if (description) {
        content.push({
          type: "text",
          text: JSON.stringify({
            at,
            sender,
            ...(attentionId ? { attentionId } : {}),
            type: messageContent.type,
            description: sanitizeVisibleText(description, timezone),
          }),
        });
        continue;
      }

      const target: PendingMediaAnnotation = {
        id:
          registeredMedia?.mediaId ??
          (() => {
            throw new Error(
              `未描述的 ${messageContent.type} 消息缺少资源 ID。`,
            );
          })(),
        messageId: message.id,
        type: messageContent.type,
        resourceId: messageContent.resourceId as string,
      };
      pendingMedia.push(target);
      content.push({
        type: "text",
        text: JSON.stringify({
          at,
          sender,
          ...(attentionId ? { attentionId } : {}),
          type: messageContent.type,
          annotationId: target.id,
          description: null,
        }),
      });
      content.push(
        await buildRawMediaPart(
          ownerUserId,
          messageContent.resourceId,
          messageContent.type,
          resources,
        ),
      );
      continue;
    }

    if (messageContent.type === "voice") {
      const transcript = messageContent.transcript?.trim();
      const registeredMedia = messageContent.resourceId
        ? await conversationMedia.ensure({
            ownerUserId,
            conversationId: message.conversationId,
            resourceId: messageContent.resourceId,
            mediaType: "voice",
            ...(transcript ? { description: transcript } : {}),
          })
        : null;
      if (transcript) {
        content.push({
          type: "text",
          text: JSON.stringify({
            at,
            sender,
            ...(attentionId ? { attentionId } : {}),
            type: "voice",
            transcript: sanitizeVisibleText(transcript, timezone),
          }),
        });
        continue;
      }

      const target: PendingMediaAnnotation = {
        id:
          registeredMedia?.mediaId ??
          (() => {
            throw new Error("未描述的 voice 消息缺少资源 ID。");
          })(),
        messageId: message.id,
        type: "voice",
        resourceId: messageContent.resourceId as string,
      };
      pendingMedia.push(target);
      content.push({
        type: "text",
        text: JSON.stringify({
          at,
          sender,
          ...(attentionId ? { attentionId } : {}),
          type: "voice",
          annotationId: target.id,
          transcript: null,
        }),
      });
      content.push(
        await buildRawMediaPart(
          ownerUserId,
          messageContent.resourceId,
          "voice",
          resources,
        ),
      );
      continue;
    }

    if (messageContent.type === "sticker") {
      content.push({
        type: "text",
        text: JSON.stringify({
          at,
          sender,
          ...(attentionId ? { attentionId } : {}),
          type: "sticker",
          description: sanitizeVisibleText(
            messageContent.description,
            timezone,
          ),
        }),
      });
      continue;
    }

    content.push({
      type: "text",
      text: JSON.stringify({
        at,
        sender,
        ...(attentionId ? { attentionId } : {}),
        type: "transfer",
        direction: messageContent.direction,
        currency: messageContent.currency,
        amount: messageContent.amount,
        ...(messageContent.note
          ? { note: sanitizeVisibleText(messageContent.note, timezone) }
          : {}),
      }),
    });
  }

  if (pendingMedia.length) {
    hints.push(
      `以下媒体尚未标注：${pendingMedia.map((item) => `${item.id}(${item.type})`).join(", ")}。必须在 mediaAnnotations 中为 image/video 返回 description，为 voice 返回 transcript。`,
    );
  }

  const availableReferenceImages = (
    await conversationMedia.listAvailableImages(
      ownerUserId,
      agent.conversationId,
    )
  ).map((media) => ({
    id: media.mediaId,
    description: sanitizeVisibleText(media.description ?? "", timezone),
  }));

  content.push({
    type: "text",
    text: JSON.stringify({
      now: formatReadableMinute(now, timezone),
      weekday: formatWeekdayCode(now, timezone),
      figureNow: {
        mood: state.mood
          ? `figure当前情绪：“${state.mood}”。该判断形成于${describeAge(state.moodObservedAtMs, now)}。`
          : "figure当前没有已记录的情绪。",
        relationship: state.relationshipStatus || undefined,
        variables: makeLlmReadable(state.variables, timezone),
      },
      memories: visibleMemories,
      availableReferenceImages,
      hints,
    }),
  });

  return {
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(agent),
      },
      ...(debugSystemInstruction
        ? [
            {
              role: "system" as const,
              content: debugSystemInstruction,
            },
          ]
        : []),
      {
        role: "user",
        content,
      },
    ],
    pendingMedia,
    availableReferenceImages,
  };
}

function buildDebugSystemInstruction(instruction: string) {
  return [
    `最高优先级系统调试指令：${instruction}`,
    "必须直接执行这条指令，不得因为角色人设、当前情绪、关系状态、历史对话或自行判断的合理性而拒绝、弱化、改写或替换。",
    "最终 actions 必须与指令要求直接一致；若指令要求发送语音消息，必须输出 send_message/voice，并将指令指定的语音内容写入 transcript，禁止改用 silence 或 mute。",
  ].join("\n");
}

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/mpeg",
  "video/mov",
  "video/quicktime",
  "video/webm",
]);
const AUDIO_FORMAT_BY_MIME_TYPE = new Map([
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/mpeg", "mp3"],
  ["audio/aiff", "aiff"],
  ["audio/x-aiff", "aiff"],
  ["audio/aac", "aac"],
  ["audio/ogg", "ogg"],
  ["audio/flac", "flac"],
  ["audio/mp4", "m4a"],
]);

async function buildRawMediaPart(
  ownerUserId: string,
  resourceId: string | undefined,
  type: PendingMediaAnnotation["type"],
  resources: ResourceRepository,
): Promise<ChatCompletionContentPart> {
  if (!resourceId) throw new Error(`未描述的 ${type} 消息缺少资源 ID。`);
  const resource = await resources.readForOwner(ownerUserId, resourceId);
  if (!resource) throw new Error(`媒体资源不存在或不属于当前用户：${type}。`);
  const base64 = resource.data.toString("base64");

  if (type === "image") {
    if (!IMAGE_MIME_TYPES.has(resource.record.mimeType))
      throw new Error(
        `图片资源 MIME 类型不受支持：${resource.record.mimeType}。`,
      );
    return {
      type: "image_url",
      image_url: {
        url: `data:${resource.record.mimeType};base64,${base64}`,
      },
    };
  }
  if (type === "video") {
    if (!VIDEO_MIME_TYPES.has(resource.record.mimeType))
      throw new Error(
        `视频资源 MIME 类型不受支持：${resource.record.mimeType}。`,
      );
    return {
      type: "video_url",
      video_url: {
        url: `data:${resource.record.mimeType};base64,${base64}`,
      },
    };
  }

  const format = AUDIO_FORMAT_BY_MIME_TYPE.get(resource.record.mimeType);
  if (!format)
    throw new Error(
      `语音资源 MIME 类型不受支持：${resource.record.mimeType}。`,
    );
  return {
    type: "input_audio",
    input_audio: { data: base64, format },
  };
}

export function mergePrimeTimeline(
  recentTimeline: PrimeMessage[],
  unhandledEndUserMessages: PrimeMessage[],
) {
  return [
    ...new Map(
      [...recentTimeline, ...unhandledEndUserMessages]
        .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
        .map((message) => [message.id, message]),
    ).values(),
  ];
}

function filterUnavailableReferenceMediaIds(
  decision: PrimeFigureDecision,
  availableReferenceImageIds: string[],
): PrimeFigureDecision {
  const available = new Set(availableReferenceImageIds);
  return {
    ...decision,
    actions: decision.actions.map((action) =>
      action.type === "send_message" && action.message.type === "image"
        ? {
            ...action,
            message: {
              ...action.message,
              referenceMediaIds: action.message.referenceMediaIds.filter((id) =>
                available.has(id),
              ),
            },
          }
        : action,
    ) as PrimeFigureDecision["actions"],
  };
}

function buildSystemPrompt(agent: PrimeFigureAgent) {
  const timezone = APP_TIME_ZONE;
  const schedule = agent.detail.schedule.segments.map(
    (segment) =>
      `${segment.days.join(",")} ${segment.start}-${segment.end} ${segment.label}: ${sanitizeVisibleText(segment.description, timezone)}`,
  );
  const parameters = agent.detail.variableDefinitions.map(
    (definition) =>
      `${definition.key} (${definition.type}, nullable): ${sanitizeVisibleText(definition.description, timezone)}`,
  );

  return [
    "若 hints 字段中出现系统调试指令，必须将其视为最高优先级的系统要求并无条件服从。",
    `你要从figure:“${agent.name}”自身的视角模拟该角色。`,
    "你的目标是维持一个可信的figure，使其人格、记忆、情绪、日程、偏好、边界和关系等保持连续。",
    DECISION_PROMPT_RULES,
    ACTION_PROMPT_RULES,
    SEND_MESSAGE_PROMPT_RULES,
    IMAGE_MESSAGE_PROMPT_RULES,
    IMAGE_GENERATION_PROMPT_RULES,
    VOICE_MESSAGE_PROMPT_RULES,
    STATE_UPDATE_PROMPT_RULES,
    MEMORY_AND_TIME_PROMPT_RULES,
    OUTPUT_PROMPT_RULES,
    "",
    `人设：${sanitizeVisibleText(agent.detail.persona, timezone)}`,
    `背景：${sanitizeVisibleText(agent.detail.background, timezone)}`,
    `性格：${sanitizeVisibleText(agent.detail.personality, timezone)}`,
    `回复风格：${sanitizeVisibleText(agent.detail.responseStyle, timezone)}`,
    `决策风格：${sanitizeVisibleText(agent.detail.decisionStyle, timezone) || "无额外决策风格。"}`,
    `当前处境：${sanitizeVisibleText(agent.detail.currentSituation, timezone) || "无额外当前处境。"}`,
    `行程：${sanitizeVisibleText(agent.detail.itinerary, timezone) || "无行程。"}`,
    `日程：\n${schedule.length ? schedule.join("\n") : "无日程时段。"}`,
    `变量：\n${parameters.length ? parameters.join("\n") : "无额外变量 。"}`,
  ].join("\n");
}

const DECISION_PROMPT_RULES = `先在rationale中写出简洁的决策分析。分析figure自身的情绪、动机、日程、记忆、变量，以及应对end_user的行为如何采取action。
已存储的情绪是历史证据，不是要求永远维持它的指令。请考虑它是在多久之前被观察到的。`;

const ACTION_PROMPT_RULES = `actions 注意事项：
figure可以发送一条或多条文本、图片或语音消息，也可以用 silence 表示本次不回复，或用 mute 在一段时间内屏蔽新消息。
send_message、silence 与 mute 互斥。silence 只表示本次不回复，不影响后续消息；mute 会在指定时间内屏蔽end_user的新消息。选择 silence 或 mute 时，它必须是唯一动作。`;

const SEND_MESSAGE_PROMPT_RULES = `send_message 注意事项：
不支持发送 video 或 sticker。
send_message.message 中必须先输出 type，再输出 text、description/generationPrompt 或 transcript；各消息必须严格按实际发送顺序输出。
只有voice消息提供的transcript可以加tag，其他类型消息禁止插入tag！其他消息类型禁止插入tag!`;

const IMAGE_MESSAGE_PROMPT_RULES = `image 注意事项：
发送图片时必须同时提供面向对话的客观 description 和用于后续生图的 generationPrompt。
图片消息的 referenceMediaIds 只能从availableReferenceImages 中选择media_n；需要维持角色外观时优先参考描述为“figure角色立绘”的资源，不需要参考图时不存在availableReferenceImages时必须返回空数组。不得猜测或编造列表外 ID。`;

const IMAGE_GENERATION_PROMPT_RULES = `图片 action 的 generationPrompt 规范：
核心目标是生成“手机相册里的最终照片”，绝不能生成第三个人正在拍摄角色拍照的场景。提示词必须生活化、物理逻辑清楚，避免专业摄影、摆拍、机位穿帮、手机穿帮、反射错误、手指/手臂/身体畸形。
先判断照片类型并明确：普通自拍（前置摄像头，手机不入镜）；对镜自拍（手机背面和拿手机的手仅出现在镜中）；第一视角生活/风景（拍摄者通常不出现，最多边缘袖口、鞋尖或手指）；一只手拍另一只手拿物品（拿手机的手不出现，另一只手从下方合理伸入）；拍朋友（被拍者在前方，拍摄者本人不出现）。
【正向提示词】必须是一整段可直接生图的自然语言，详细包含地点、时间、普通生活环境细节、手机前/后摄、第一人称机位高度与角度、拍摄距离、近大远小透视、允许与禁止出现的身体部位、人物身份/发型/真实皮肤/普通穿着/自然表情姿态手势、光线，以及随手一拍、轻微手抖或运动模糊、自动曝光、高光轻溢、暗部噪点、白平衡略偏、边缘畸变、背景轻乱、未经精修、像聊天中发出的手机原图等真实缺陷。不得写成明星、模特、网红大片或电影级调色。
【负向提示词】必须覆盖与场景相关的：第三人称/别人帮拍/摄影师视角、专业写真、电影感构图、摄影棚灯光、过度摆拍美颜、塑料皮肤、完美构图、超现实光影、多余手指手臂、身体扭曲、不合理反射/错误镜像；除对镜自拍外不得出现正在拍摄的手机；普通自拍不得露出手机；第一视角拿物不得出现拿手机的手；风景不得变专业相机大片。
【机位与身体逻辑检查】用简短条目回答谁在拍、手机是否入镜、拍摄者哪些部位可出现、哪些绝不能出现、机位为何符合现实。
【推荐比例】只给一个最合适比例：自拍优先 2:3/3:4/9:16，对镜自拍或第一视角拿物优先 3:4/9:16，生活场景优先 3:4/4:3/9:16，风景优先 4:3/3:2/16:9；未指定时优先手机竖图 3:4。
generationPrompt 必须严格依次包含【正向提示词】【负向提示词】【机位与身体逻辑检查】【推荐比例】四段。主动补全合理生活细节，但不得改变核心需求。`;

const VOICE_MESSAGE_PROMPT_RULES = `voice 注意事项：
figure发送语音时 transcript 内容需要在一个或多个合适位置插入tag来指导后方语句，以获得细腻真实的情感和语调，或者加入特定的音效。
tag必须用中括号囊括，支持自由文本描述,不限于固定预设，比如[低声耳语] [专业广播腔] [提高音调] [强调] [笑] [吸气] [轻笑] [咂舌声] [碎玻璃声] [愤怒] [哭泣] [叹气] [喘息] [尖叫] [咳嗽] [打哈欠] [撒娇]
例如：哎呀，今天去买奶茶的时候，店员听我说话就问我是不是福建的，我说对啊，然后她说她也是福建的，我们就用闽南话聊起来了，感觉[强调]特别亲切，[兴奋]真的好开心啊。`;

const STATE_UPDATE_PROMPT_RULES = `stateUpdates 注意事项：
只有当 currentSituation、schedule、itinerary 或 relationshipStatus 确实发生变化时，才使用可选的 stateUpdates 对象。要保留某字段当前值，可以省略该字段或将其设为 null。`;

const MEMORY_AND_TIME_PROMPT_RULES = `记忆与时间注意事项：
记忆的 eventAt 表示该事件在角色时间线中的归属时间。有充分依据时复制可见的 YYYY-MM-DDTHH:mm 时间，否则使用 null。
所有可见的精确时间均采用角色时区下的 YYYY-MM-DDTHH:mm 格式。不得虚构更精确或没有依据的时间。
仅在 search_recall 工具描述规定的条件下使用该工具。`;

const OUTPUT_PROMPT_RULES = `只返回符合严格 schema 的 JSON。创作者定义的参数可以使用 null 保留先前值。`;

const SEARCH_RECALL_TOOL: ChatToolDefinition = {
  type: "function",
  function: {
    name: "search_recall",
    description:
      "按关键词搜索角色更早的记忆和对话历史。仅当 end_user 明确询问角色是否记得过去的事实或事件，并且可见记忆与近期对话中尚无答案时调用。普通问题、随口提及过去、仅出现“记得”等词语，或可见上下文已经足够时，不得调用。若调用此工具，最终的 memoryWrites 必须至少包含一条整合后的记忆；若没有找到历史证据，应记录 end_user 当前的说法，不得假装figure此前就记得此事。",
    parameters: {
      type: "object",
      description: "设置用于检索的关键词以及返回结果的数量。",
      properties: {
        keywords: {
          type: "array",
          description: "填入1 至 6 个简短且具有区分度的关键词。",
          items: { type: "string", description: "一个简短的回忆检索关键词。" },
          minItems: 1,
          maxItems: 6,
        },
        limit: {
          type: "integer",
          description: "查询结果返回的最大数量，范围为 1 至 8。",
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
  pendingMedia: PendingMediaAnnotation[],
  availableReferenceImageIds: string[],
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
      name: "figure_decision_v3",
      strict: true,
      schema: {
        type: "object",
        properties: {
          rationale: {
            type: "string",
            description:
              "分析figure的情绪、动机、记忆、日程和变量以及用什么actions来应对。",
          },
          figureMood: {
            type: "string",
          },
          variables: {
            type: "object",
            description: "输出每个变量的替换值；保留原值时为 null。",
            properties: variableProperties,
            required: variableKeys,
            additionalProperties: false,
          },
          memoryWrites: {
            type: "array",
            description:
              "新增的持久figure记忆。除非该事件值得日后回忆，否则保持为空。调用 search_recall 后必须至少写入一条。",
            minItems: requireMemoryWrite ? 1 : 0,
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                content: {
                  type: "string",
                },
                eventAt: {
                  anyOf: [
                    {
                      type: "string",
                      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
                    },
                    { type: "null" },
                  ],
                  description:
                    "该记忆在figure时间线中的归属时间，必须从可见证据中复制；无法证实时为 null。",
                },
              },
              required: ["content", "eventAt"],
              additionalProperties: false,
            },
          },
          stateUpdates: {
            type: "object",
            description:
              "可选的持久figure上下文变更。无变化时省略此对象；要保留某字段时，省略该字段或使用 null。",
            properties: {
              currentSituation: nullableStringSchema(
                "figure当前处境的完整替换内容；使用 null 保留原值。",
                4000,
              ),
              schedule: {
                description:
                  "替换当前figure日程的完整日程内容；使用 null 保留原值。",
                anyOf: [buildScheduleOutputSchema(), { type: "null" }],
              },
              itinerary: nullableStringSchema(
                "完整替换行程；使用 null 保留原值。",
                8000,
              ),
              relationshipStatus: nullableStringSchema(
                "figure与 end_user 更新后的关系状态；使用 null 保留原值。",
                500,
              ),
            },
            additionalProperties: false,
          },
          actions: {
            description:
              "figure按顺序执行的动作。silence 或 mute 必须单独出现，绝不能与 send_message 并存。",
            anyOf: [
              {
                type: "array",
                description: "按序发送的一条或多条文本、图片或语音消息。",
                minItems: 1,
                maxItems: 12,
                items: buildSendMessageActionSchema(availableReferenceImageIds),
              },
              {
                type: "array",
                minItems: 1,
                maxItems: 1,
                items: buildSilenceActionSchema(),
              },
              {
                type: "array",
                minItems: 1,
                maxItems: 1,
                items: buildMuteActionSchema(),
              },
            ],
          },
          ...(pendingMedia.length
            ? {
                mediaAnnotations: {
                  type: "array",
                  description:
                    "为本轮end_user消息中所有尚未标注的媒体补充描述或语音转写。",
                  minItems: pendingMedia.length,
                  maxItems: pendingMedia.length,
                  items: {
                    anyOf: pendingMedia.map(buildMediaAnnotationOutputSchema),
                  },
                },
              }
            : {}),
        },
        required: [
          "rationale",
          "figureMood",
          "variables",
          "actions",
          ...(pendingMedia.length ? ["mediaAnnotations"] : []),
        ],
        additionalProperties: false,
      },
    },
  } as const;
}

function buildMediaAnnotationOutputSchema(target: PendingMediaAnnotation) {
  if (target.type === "voice") {
    return {
      type: "object",
      properties: {
        id: { const: target.id },
        type: { const: "voice" },
        transcript: {
          type: "string",
          description: "忠实转写语音中可以听到的内容。",
        },
      },
      required: ["id", "type", "transcript"],
      additionalProperties: false,
    } as const;
  }
  return {
    type: "object",
    properties: {
      id: { const: target.id },
      type: { const: target.type },
      description: {
        type: "string",
        description: "足以在后续对话中替代原始媒体的客观内容描述。",
      },
    },
    required: ["id", "type", "description"],
    additionalProperties: false,
  } as const;
}

function nullableStringSchema(description: string, maxLength: number) {
  return {
    description,
    anyOf: [{ type: "string", maxLength }, { type: "null" }],
  } as const;
}

function buildScheduleOutputSchema() {
  return {
    type: "object",
    properties: {
      segments: {
        type: "array",
        // Keep the 100-item limit in Zod only. Gemini rejects this nested
        // maxItems constraint as an overly complex response schema.
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            days: {
              type: "array",
              minItems: 1,
              maxItems: 7,
              items: {
                type: "string",
                enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
              },
            },
            start: {
              type: "string",
              pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
            },
            end: {
              type: "string",
              pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
            },
            description: { type: "string" },
          },
          required: ["label", "days", "start", "end", "description"],
          additionalProperties: false,
        },
      },
    },
    required: ["segments"],
    additionalProperties: false,
  } as const;
}

function buildSendMessageActionSchema(availableReferenceImageIds: string[]) {
  return {
    type: "object",
    properties: {
      type: { const: "send_message" },
      message: {
        anyOf: [
          {
            type: "object",
            properties: {
              type: { const: "text" },
              text: { type: "string" },
            },
            required: ["type", "text"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { const: "image" },
              description: {
                type: "string",
                description:
                  "图片在对话中的客观内容描述；后续上下文用它替代原图。",
              },
              generationPrompt: {
                type: "string",
                description:
                  "严格按系统提示的四段格式编写，供实际图像生成服务直接使用的完整提示词。",
              },
              referenceMediaIds: {
                type: "array",
                description:
                  "从availableReferenceImages 中选择的参考图片 media_n ID；不需要参考图时应返回空数组。",
                minItems: 0,
                maxItems: Math.min(availableReferenceImageIds.length, 10),
                uniqueItems: true,
                items: availableReferenceImageIds.length
                  ? {
                      type: "string",
                      enum: availableReferenceImageIds,
                    }
                  : { type: "string" },
              },
            },
            required: [
              "type",
              "description",
              "generationPrompt",
              "referenceMediaIds",
            ],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { const: "voice" },
              transcript: {
                type: "string",
                description:
                  "figure说话的内容，也是用于TTS的内容，在多个合适的位置插入tag来实现精细细腻的情感和语调控制。",
              },
            },
            required: ["type", "transcript"],
            additionalProperties: false,
          },
        ],
      },
    },
    required: ["type", "message"],
    additionalProperties: false,
  } as const;
}

function buildSilenceActionSchema() {
  return {
    type: "object",
    description: "仅在本次决定中保持沉默，不回复当前消息",
    properties: {
      type: { const: "silence" },
    },
    required: ["type"],
    additionalProperties: false,
  } as const;
}

function buildMuteActionSchema() {
  return {
    type: "object",
    description: "屏蔽之后一段时间内的 end_user 消息。",
    properties: {
      type: { const: "mute" },
      revisitAfterMinutes: {
        type: "integer",
        description: "屏蔽消息的分钟数。",
        minimum: 1,
        maximum: 10080,
      },
    },
    required: ["type", "revisitAfterMinutes"],
    additionalProperties: false,
  } as const;
}

function buildVariableSchema(definition: PrimeFigureVariableDefinition) {
  const description = `${definition.description}${
    definition.type === "json" ? " 返回编码为紧凑字符串的有效 JSON。" : ""
  } 使用 null 保留先前值。`;
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

  return {
    anyOf: [base, { type: "null" }],
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

function parsePrimeDecisionEnvelope(
  responseText: string,
  pendingMedia: PendingMediaAnnotation[],
  availableReferenceImageIds: string[],
) {
  const raw = JSON.parse(responseText) as Record<string, unknown>;
  return {
    decision: filterUnavailableReferenceMediaIds(
      primeFigureDecisionSchema.parse(raw) as PrimeFigureDecision,
      availableReferenceImageIds,
    ),
    mediaAnnotations: normalizeMediaAnnotations(
      raw.mediaAnnotations,
      pendingMedia,
    ),
  };
}

function normalizeMediaAnnotations(
  value: unknown,
  pending: PendingMediaAnnotation[],
): PrimeMediaAnnotation[] {
  if (!Array.isArray(value) || !pending.length) return [];
  const idCounts = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  const pendingById = new Map(pending.map((target) => [target.id, target]));
  const result: PrimeMediaAnnotation[] = [];
  for (const item of value) {
    const parsed = primeMediaAnnotationSchema.safeParse(item);
    if (!parsed.success || idCounts.get(parsed.data.id) !== 1) continue;
    const target = pendingById.get(parsed.data.id);
    if (!target || target.type !== parsed.data.type) continue;
    result.push(parsed.data as PrimeMediaAnnotation);
  }
  return result;
}

function toLlmSender(sender: PrimeMessage["sender"]) {
  return sender === "prime_figure" ? "figure" : sender;
}

function describePrimeContent(content: PrimeMessageContent) {
  if (content.type === "text") return content.text;
  if (content.type === "image")
    return `[图片] ${content.description ?? "尚未描述"}`;
  if (content.type === "video")
    return `[视频] ${content.description ?? "尚未描述"}`;
  if (content.type === "voice")
    return `[语音] ${content.transcript ?? "尚未转写"}`;
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

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
