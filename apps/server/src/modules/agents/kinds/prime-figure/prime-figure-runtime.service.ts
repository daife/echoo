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
import { PrimeContentOptimizer } from "./prime-content-optimizer.js";
import {
  PrimeMediaAnnotationService,
  type PrimePendingMedia,
} from "./prime-media-annotation.service.js";
import { primeModelSessionId } from "./prime-model-session.js";
import {
  buildDebugHint,
  buildPrimeSystemPrompt,
} from "./prime-prompt-composer.js";
import {
  describeAge,
  findScheduleSegment,
  formatReadableMinute,
  formatWeekdayCode,
} from "./prime-time.js";
import { RuntimeConfigService } from "../../../runtime-config/runtime-config.service.js";
import type { StoredPrimeFigureRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";
import { PrimeRuntimeFailureNotifier } from "./prime-runtime-failure-notifier.js";
import {
  filterPrimeActionsByCapabilities,
  isPrimeOutputEnabled,
} from "./prime-output-capabilities.js";

const PRIME_VISIBLE_MEMORY_LIMIT = 20;
const RECALL_HINT_PATTERN = /记得|不记得|忘了|还记得|remember|forgot|recal+l/i;
const primeFigureDecisionWithoutVariablesSchema =
  primeFigureDecisionSchema.omit({ variables: true });

export type PrimeDecisionTrigger =
  | "end_user_message"
  | "mute_ended"
  | "scheduled_wakeup"
  | "passive_wakeup"
  | "coalesced_messages"
  | "debug_hint";

type PendingMediaAnnotation = PrimePendingMedia;

interface PrimeDecisionRequest {
  ownerUserId: string;
  conversationId: string;
  trigger: PrimeDecisionTrigger;
  debugInstruction?: string;
  wakeupToken?: string;
  passiveStage?: 1 | 2 | 3;
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
    private readonly mediaAnnotations = new PrimeMediaAnnotationService(),
    private readonly contentOptimizer = new PrimeContentOptimizer(),
    private readonly failureNotifier = new PrimeRuntimeFailureNotifier(),
  ) {}

  async requestDecision(input: {
    ownerUserId: string;
    conversationId: string;
    trigger?: PrimeDecisionTrigger;
    debugInstruction?: string;
    wakeupToken?: string;
    passiveStage?: 1 | 2 | 3;
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
      await this.recordTerminalFailure({
        ownerUserId: input.ownerUserId,
        agentId: agent.id,
        conversationId: input.conversationId,
        trigger,
        errorMessage: "本初角色状态缺失。",
      });
      return null;
    }
    const runtimeConfig = (
      await this.runtimeConfigs.resolveConversationConfig(
        input.ownerUserId,
        input.conversationId,
      )
    ).config as StoredPrimeFigureRuntimeConfig;

    if (trigger === "scheduled_wakeup") {
      if (
        !runtimeConfig.wakeups.proactive.enabled ||
        !input.wakeupToken ||
        state.proactiveWakeup?.token !== input.wakeupToken
      ) {
        if (state.proactiveWakeup?.token === input.wakeupToken)
          await this.states.clearWakeup({
            ownerUserId: input.ownerUserId,
            agentId: agent.id,
            kind: "proactive",
            token: input.wakeupToken,
          });
        return null;
      }
    }
    if (trigger === "passive_wakeup") {
      if (
        !runtimeConfig.wakeups.passive.enabled ||
        !input.wakeupToken ||
        state.passiveWakeup?.token !== input.wakeupToken ||
        state.passiveWakeup.stage !== input.passiveStage
      ) {
        if (state.passiveWakeup?.token === input.wakeupToken)
          await this.states.clearWakeup({
            ownerUserId: input.ownerUserId,
            agentId: agent.id,
            kind: "passive",
            token: input.wakeupToken,
          });
        return null;
      }
    }
    if (
      trigger !== "debug_hint" &&
      trigger !== "scheduled_wakeup" &&
      trigger !== "passive_wakeup" &&
      state.silenceUntilMs &&
      state.silenceUntilMs > Date.now()
    )
      return null;

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
      await this.recordTerminalFailure({
        ownerUserId: input.ownerUserId,
        agentId: agent.id,
        conversationId: input.conversationId,
        trigger,
        errorMessage:
          error instanceof Error ? error.message : "本初角色运行时执行失败。",
      });
      return null;
    }
  }

  private async recordTerminalFailure(input: {
    ownerUserId: string;
    agentId: string;
    conversationId: string;
    trigger: PrimeDecisionTrigger;
    errorMessage: string;
  }) {
    const now = Date.now();
    await this.logs.save({
      ownerUserId: input.ownerUserId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      action: { type: "prime_runtime", trigger: input.trigger },
      status: "failed",
      errorMessage: input.errorMessage,
      now,
    });
    await this.failureNotifier.notify({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      trigger: input.trigger,
      errorMessage: input.errorMessage,
      now,
    });
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
    const provider = this.providers.createProvider(
      input.runtimeConfig.decisionModel,
    );
    const model = input.runtimeConfig.decisionModel.model;
    let packet = await buildPrimeChatMessages(
      input.agent,
      input.state,
      context.timeline,
      input.trigger,
      input.ownerUserId,
      this.resources,
      this.conversationMedia,
      context.lastHandledEndUserSeq,
      input.debugInstruction,
      input.runtimeConfig,
      context.hasOmittedConversation,
      context.pendingEndUserTransfers,
    );
    if (packet.auxiliaryMedia.length) {
      const annotations = await this.mediaAnnotations.annotate(
        input.ownerUserId,
        input.conversationId,
        packet.auxiliaryMedia,
        input.runtimeConfig,
      );
      await this.persistMediaAnnotations(
        input,
        packet.auxiliaryMedia,
        annotations,
        true,
      );
      packet = await buildPrimeChatMessages(
        input.agent,
        input.state,
        context.timeline,
        input.trigger,
        input.ownerUserId,
        this.resources,
        this.conversationMedia,
        context.lastHandledEndUserSeq,
        input.debugInstruction,
        input.runtimeConfig,
        context.hasOmittedConversation,
        context.pendingEndUserTransfers,
      );
    }
    const streamSession = new PrimeDecisionStreamSession({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      voiceRequestStreaming: input.agent.detail.voiceRequestStreaming,
      runtimeConfig: input.runtimeConfig,
    });
    const completionBase = {
      model,
      sessionId: primeModelSessionId(input.conversationId, "decision"),
      temperature: input.runtimeConfig.decisionModel.temperature,
      maxTokens: input.runtimeConfig.decisionModel.maxTokens,
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
        input.agent,
        packet.pendingMedia,
        packet.availableReferenceImages.map((media) => media.id),
        input.runtimeConfig,
        packet.availableStickers.map((sticker) => sticker.id),
        packet.pendingEndUserTransfers.map((transfer) => transfer.id),
      );
      const { decision, mediaAnnotations, sourceActionIndices } = envelope;
      const optimizationFailures: Array<{
        kind: "image" | "voice";
        actionIndex: number;
        error: string;
      }> = [];
      input.onModelActivityChange?.(true);
      let finalDecision: PrimeFigureDecision;
      try {
        finalDecision = await this.contentOptimizer.optimizeDecision(
          decision,
          input.runtimeConfig,
          input.conversationId,
          {
            onVoiceStart: (index) =>
              streamSession.beginVoiceOptimization(
                sourceActionIndices[index] ?? index,
              ),
            onVoiceDelta: (index, delta) =>
              streamSession.pushOptimizedVoiceDelta(
                sourceActionIndices[index] ?? index,
                delta,
              ),
            onVoiceComplete: (index, transcript) =>
              streamSession.completeVoiceOptimization(
                sourceActionIndices[index] ?? index,
                transcript,
              ),
            onVoiceFallback: (index, transcript) =>
              streamSession.fallbackVoiceOptimization(
                sourceActionIndices[index] ?? index,
                transcript,
              ),
            onFailure: (failure) => optimizationFailures.push(failure),
          },
        );
      } finally {
        input.onModelActivityChange?.(false);
      }
      for (const failure of optimizationFailures)
        await this.logs.save({
          ownerUserId: input.ownerUserId,
          agentId: input.agent.id,
          conversationId: input.conversationId,
          action: {
            type: `${failure.kind}_optimization`,
            actionIndex: failure.actionIndex,
          },
          status: "failed",
          errorMessage: failure.error,
        });
      const streamed = await streamSession.finalize(
        finalDecision,
        sourceActionIndices,
      );
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
        decision: finalDecision,
        providerId: finalResponse.providerId,
        model: finalResponse.model,
        muteMessageCutoffAtMs: context.inputThroughEndUserAtMs,
        streamedMessageIds: streamed.messageIds,
        messageCreatedAt: streamed.messageCreatedAt,
        voiceMedia: streamed.voiceMedia,
        ttsErrors: streamed.ttsErrors,
        imageMedia: streamed.imageMedia,
        imageGenerationErrors: streamed.imageGenerationErrors,
        trigger: input.trigger,
        runtimeConfig: input.runtimeConfig,
        wakeupToken: input.wakeupToken,
        passiveStage: input.passiveStage,
        inputThroughEndUserSeq: context.inputThroughEndUserSeq,
        interactionBaselineSequence: context.inputThroughSequence,
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
      return finalDecision;
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
    const [contextWindow, unhandledEndUserMessages, pendingEndUserTransfers] =
      await Promise.all([
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
        this.messages.listPendingEndUserTransfers(
          input.ownerUserId,
          input.conversationId,
        ),
      ]);
    if (
      !unhandledEndUserMessages.length &&
      !(
        (input.trigger === "debug_hint" && input.debugInstruction?.trim()) ||
        input.trigger === "scheduled_wakeup" ||
        input.trigger === "passive_wakeup"
      )
    )
      return null;
    const timeline = mergePrimeTimeline(
      contextWindow.messages,
      unhandledEndUserMessages,
    );
    return {
      timeline,
      hasOmittedConversation: hasOmittedPrimeConversation(
        contextWindow.totalEligibleMessages,
        timeline,
      ),
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
      inputThroughSequence: timeline.reduce(
        (latest, message) => Math.max(latest, message.sequence ?? 0),
        0,
      ),
      pendingEndUserTransfers,
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
    const availableStickerIds = (input.packet.availableStickers ?? []).map(
      (sticker) => sticker.id,
    );
    const pendingTransferIds = (input.packet.pendingEndUserTransfers ?? []).map(
      (transfer) => transfer.id,
    );
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
          ...(input.packet.recallAvailable
            ? { tools: [SEARCH_RECALL_TOOL], toolChoice: "auto" as const }
            : {}),
          responseFormat: buildPrimeDecisionResponseFormat(
            input.request.agent,
            input.request.runtimeConfig,
            false,
            input.packet.pendingMedia,
            availableReferenceImageIds,
            input.packet.recallAvailable,
            availableStickerIds,
            pendingTransferIds,
          ),
        },
        input.streamSession,
      ),
    );
    const recallCall = input.packet.recallAvailable
      ? firstResponse.toolCalls?.find(
          (call) => call.function.name === "search_recall",
        )
      : undefined;
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
            input.request.runtimeConfig,
            true,
            input.packet.pendingMedia,
            availableReferenceImageIds,
            true,
            availableStickerIds,
            pendingTransferIds,
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
    strict = false,
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
        if (strict) throw error;
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
  debugInstruction: string | undefined,
  runtimeConfig: StoredPrimeFigureRuntimeConfig,
  hasOmittedConversation = false,
  pendingEndUserTransfers: Array<
    PrimeMessage & {
      content: Extract<PrimeMessageContent, { type: "transfer" }>;
    }
  > = [],
): Promise<{
  messages: ChatCompletionMessage[];
  pendingMedia: PendingMediaAnnotation[];
  auxiliaryMedia: PendingMediaAnnotation[];
  availableReferenceImages: Array<{ id: string; description: string }>;
  availableStickers: Array<{
    id: string;
    description: string;
    resourceUrl: string;
  }>;
  pendingEndUserTransfers: Array<{
    id: string;
    at: string;
    amount: number;
    currency: string;
    note?: string;
  }>;
  recallAvailable: boolean;
}> {
  const timezone = APP_TIME_ZONE;
  const now = Date.now();
  const hasVariables = agent.detail.variableDefinitions.length > 0;
  const recallAvailable =
    hasOmittedConversation ||
    state.memories.length > PRIME_VISIBLE_MEMORY_LIMIT;
  const lastEndUserMessage = [...timeline]
    .reverse()
    .find((message) => message.sender === "end_user");
  const eventTime = lastEndUserMessage?.occurredAtMs ?? now;
  const scheduleSegment = findScheduleSegment(agent.detail.schedule, eventTime);
  const hints: string[] = [];
  const debugUserHint =
    trigger === "debug_hint" && debugInstruction?.trim()
      ? buildDebugHint(debugInstruction.trim())
      : undefined;
  if (debugUserHint) hints.push(debugUserHint);
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
  const pendingTransferSummaries = pendingEndUserTransfers.map((message) => ({
    id: message.id,
    at: formatReadableMinute(message.occurredAtMs, timezone),
    amount: message.content.amount,
    currency: message.content.currency,
    ...(message.content.note ? { note: message.content.note } : {}),
  }));
  if (pendingTransferSummaries.length) {
    const summary = pendingTransferSummaries
      .map(
        (transfer) =>
          `${transfer.id}（${transfer.at}，${transfer.currency} ${transfer.amount}${transfer.note ? `，备注：${sanitizeVisibleText(transfer.note, timezone)}` : ""}）`,
      )
      .join("；");
    hints.push(
      isPrimeOutputEnabled(runtimeConfig, "transfer")
        ? `存在尚未接收或拒收的end_user转账：${summary}。可使用transfer action的accept或reject处理。`
        : `存在尚未接收或拒收的end_user转账：${summary}。当前transfer action未开放，figure不能接收或拒收。`,
    );
  }

  if (
    recallAvailable &&
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
  } else if (trigger === "scheduled_wakeup") {
    const wakeup = state.proactiveWakeup;
    const waitedMinutes = wakeup
      ? Math.max(
          1,
          Math.round((wakeup.dueAtMs - wakeup.scheduledAtMs) / 60_000),
        )
      : undefined;
    hints.push(
      `这是 figure 此前主动安排的系统定时唤醒${waitedMinutes ? `，原计划等待约 ${waitedMinutes} 分钟后重新查看当前会话` : ""}。请结合当前状态自行判断是否采取行动。`,
    );
  } else if (trigger === "passive_wakeup") {
    const latestMessageAt = timeline.reduce(
      (latest, message) => Math.max(latest, message.occurredAtMs),
      0,
    );
    const inactivitySince =
      latestMessageAt || state.passiveWakeup?.anchorActivityAtMs || now;
    hints.push(
      `这是一次系统定时唤醒。figure 与 end_user 已有${formatElapsedDuration(inactivitySince, now)}未发生消息交流；请结合当前状态判断是否考虑采取行动。`,
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
  const auxiliaryMedia: PendingMediaAnnotation[] = [];
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
      let description = messageContent.description?.trim();
      const registeredMedia = messageContent.resourceId
        ? await conversationMedia.ensure({
            ownerUserId,
            conversationId: message.conversationId,
            resourceId: messageContent.resourceId,
            mediaType: messageContent.type,
            ...(description ? { description } : {}),
          })
        : null;
      description ||= registeredMedia?.description?.trim();
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
      const auxiliary = runtimeConfig.understanding.visual.mode === "auxiliary";
      (auxiliary ? auxiliaryMedia : pendingMedia).push(target);
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
      if (!auxiliary)
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
      let transcript = messageContent.transcript?.trim();
      const registeredMedia = messageContent.resourceId
        ? await conversationMedia.ensure({
            ownerUserId,
            conversationId: message.conversationId,
            resourceId: messageContent.resourceId,
            mediaType: "voice",
            ...(transcript ? { description: transcript } : {}),
          })
        : null;
      transcript ||= registeredMedia?.description?.trim();
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
      const auxiliary = runtimeConfig.understanding.audio.mode === "auxiliary";
      (auxiliary ? auxiliaryMedia : pendingMedia).push(target);
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
      if (!auxiliary)
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
          stickerId: messageContent.stickerId,
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
        transferId: messageContent.transferId,
        event: messageContent.event,
        direction: messageContent.direction,
        currency: messageContent.currency,
        amount: messageContent.amount,
        status: messageContent.status,
        ...(messageContent.relatedTransferId
          ? { relatedTransferId: messageContent.relatedTransferId }
          : {}),
        ...(messageContent.resolvedAtMs
          ? {
              resolvedAt: formatReadableMinute(
                messageContent.resolvedAtMs,
                timezone,
              ),
            }
          : {}),
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
  const availableStickers = (agent.detail.stickers ?? []).map((sticker) => ({
    id: sticker.resourceId,
    description: sanitizeVisibleText(sticker.description, timezone),
    resourceUrl: sticker.resourcePath,
  }));

  content.push({
    type: "text",
    text: JSON.stringify({
      now: formatReadableMinute(now, timezone),
      weekday: formatWeekdayCode(now, timezone),
      figureNow: {
        currentSituation: sanitizeVisibleText(
          agent.detail.currentSituation,
          timezone,
        ),
        itinerary: sanitizeVisibleText(agent.detail.itinerary, timezone),
        schedule: {
          segments: agent.detail.schedule.segments.map((segment) => ({
            label: sanitizeVisibleText(segment.label, timezone),
            days: segment.days,
            start: segment.start,
            end: segment.end,
            description: sanitizeVisibleText(segment.description, timezone),
          })),
        },
        mood: state.mood
          ? `figure当前情绪：“${state.mood}”。该判断形成于${describeAge(state.moodObservedAtMs, now)}。`
          : "figure当前没有已记录的情绪。",
        relationship: state.relationshipStatus || undefined,
        ...(hasVariables
          ? {
              variables: makeLlmReadable(
                Object.fromEntries(
                  agent.detail.variableDefinitions.flatMap((definition) =>
                    state.variables[definition.key] === undefined
                      ? []
                      : [[definition.key, state.variables[definition.key]]],
                  ),
                ),
                timezone,
              ),
            }
          : {}),
      },
      memories: visibleMemories,
      availableReferenceImages,
      ...(isPrimeOutputEnabled(runtimeConfig, "sticker")
        ? { availableStickers }
        : {}),
      hints,
    }),
  });

  return {
    messages: [
      {
        role: "system",
        content: buildPrimeSystemPrompt(agent, runtimeConfig, {
          recallAvailable,
        }),
      },
      {
        role: "user",
        content,
      },
    ],
    pendingMedia,
    auxiliaryMedia,
    availableReferenceImages,
    availableStickers,
    pendingEndUserTransfers: pendingTransferSummaries,
    recallAvailable,
  };
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

export function hasOmittedPrimeConversation(
  totalEligibleMessages: number,
  timeline: PrimeMessage[],
) {
  return timeline.length < totalEligibleMessages;
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

export function buildPrimeDecisionResponseFormat(
  agent: PrimeFigureAgent,
  runtimeConfig: StoredPrimeFigureRuntimeConfig,
  requireMemoryWrite: boolean,
  pendingMedia: PendingMediaAnnotation[],
  availableReferenceImageIds: string[],
  recallAvailable = false,
  availableStickerIds: string[] = [],
  pendingTransferIds: string[] = [],
) {
  const hasVariables = agent.detail.variableDefinitions.length > 0;
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
      strict: false,
      schema: {
        type: "object",
        properties: {
          rationale: {
            type: "string",
            description: `分析figure的情绪、动机、记忆、日程${hasVariables ? "、变量" : ""}，以及用什么actions来应对。`,
          },
          figureMood: {
            type: "string",
          },
          ...(hasVariables
            ? {
                variables: {
                  type: "object",
                  description: "输出每个变量的替换值；保留原值时为 null。",
                  properties: variableProperties,
                  required: variableKeys,
                  additionalProperties: false,
                },
              }
            : {}),
          memoryWrites: {
            type: "array",
            description: `新增的持久figure记忆。除非该事件值得日后回忆，否则保持为空。${recallAvailable ? "调用 search_recall 后必须至少写入一条。" : ""}`,
            minItems: requireMemoryWrite ? 1 : 0,
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
              ),
              schedule: {
                description:
                  "替换当前figure日程的完整日程内容；使用 null 保留原值。",
                anyOf: [buildScheduleOutputSchema(), { type: "null" }],
              },
              itinerary: nullableStringSchema(
                "完整替换行程；使用 null 保留原值。",
              ),
              relationshipStatus: nullableStringSchema(
                "figure与 end_user 更新后的关系状态；使用 null 保留原值。",
              ),
            },
            additionalProperties: false,
          },
          actions: {
            type: "array",
            description: "figure按顺序执行的动作。",
            items: {
              anyOf: [
                buildSendMessageActionSchema(
                  availableReferenceImageIds,
                  runtimeConfig,
                  availableStickerIds,
                ),
                ...(isPrimeOutputEnabled(runtimeConfig, "transfer")
                  ? [buildTransferActionSchema(pendingTransferIds)]
                  : []),
                buildSilenceActionSchema(),
                buildMuteActionSchema(),
                ...(runtimeConfig.wakeups.proactive.enabled
                  ? [buildScheduleWakeupActionSchema()]
                  : []),
              ],
            },
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
          ...(hasVariables ? ["variables"] : []),
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

function nullableStringSchema(description: string) {
  return {
    description,
    anyOf: [{ type: "string" }, { type: "null" }],
  } as const;
}

function buildScheduleOutputSchema() {
  return {
    type: "object",
    properties: {
      segments: {
        type: "array",
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

function buildSendMessageActionSchema(
  availableReferenceImageIds: string[],
  runtimeConfig: StoredPrimeFigureRuntimeConfig,
  availableStickerIds: string[] = [],
) {
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
          ...(isPrimeOutputEnabled(runtimeConfig, "image")
            ? [
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
              ]
            : []),
          ...(isPrimeOutputEnabled(runtimeConfig, "voice")
            ? [
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
              ]
            : []),
          ...(isPrimeOutputEnabled(runtimeConfig, "sticker") &&
          availableStickerIds.length
            ? [
                {
                  type: "object",
                  properties: {
                    type: { const: "sticker" },
                    stickerId: {
                      type: "string",
                      enum: availableStickerIds,
                      description: "从availableStickers选择的表情资源 ID。",
                    },
                  },
                  required: ["type", "stickerId"],
                  additionalProperties: false,
                },
              ]
            : []),
        ],
      },
    },
    required: ["type", "message"],
    additionalProperties: false,
  } as const;
}

function buildTransferActionSchema(pendingTransferIds: string[]) {
  return {
    anyOf: [
      {
        type: "object",
        properties: {
          type: { const: "transfer" },
          operation: { const: "send" },
          amount: {
            type: "number",
            exclusiveMinimum: 0,
            multipleOf: 0.01,
          },
          currency: { const: "CNY" },
          note: { type: "string", maxLength: 200 },
        },
        required: ["type", "operation", "amount", "currency", "note"],
        additionalProperties: false,
      },
      ...(pendingTransferIds.length
        ? [
            {
              type: "object",
              properties: {
                type: { const: "transfer" },
                operation: { enum: ["accept", "reject"] },
                transferId: { type: "string", enum: pendingTransferIds },
              },
              required: ["type", "operation", "transferId"],
              additionalProperties: false,
            },
          ]
        : []),
    ],
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
    description: "设置或解除对 end_user 新消息的屏蔽状态。",
    properties: {
      type: { const: "mute" },
      revisitAfterMinutes: {
        description:
          "使用正整数设置屏蔽消息的分钟数；使用 null 解除当前mute状态。",
        anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
      },
    },
    required: ["type", "revisitAfterMinutes"],
    additionalProperties: false,
  } as const;
}

function buildScheduleWakeupActionSchema() {
  return {
    type: "object",
    description: "安排或取消一次由 figure 主动设置的定时唤醒。",
    properties: {
      type: { const: "schedule_wakeup" },
      afterMinutes: {
        description:
          "使用正整数安排若干分钟后唤醒；使用 null 取消已有主动计时。",
        anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
      },
    },
    required: ["type", "afterMinutes"],
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

export function parsePrimeDecisionEnvelope(
  responseText: string,
  agent: PrimeFigureAgent,
  pendingMedia: PendingMediaAnnotation[],
  availableReferenceImageIds: string[],
  runtimeConfig: StoredPrimeFigureRuntimeConfig,
  availableStickerIds: string[] = [],
  pendingTransferIds: string[] = [],
) {
  const raw = JSON.parse(responseText) as Record<string, unknown>;
  const rawActionFilter = Array.isArray(raw.actions)
    ? filterPrimeActionsByCapabilities(raw.actions, runtimeConfig)
    : null;
  const rawDynamicFilter = rawActionFilter
    ? filterPrimeDynamicActions(
        rawActionFilter.actions,
        availableStickerIds,
        pendingTransferIds,
        rawActionFilter.sourceIndices,
      )
    : null;
  const normalizedRaw = rawDynamicFilter
    ? { ...raw, actions: rawDynamicFilter.actions }
    : raw;
  const parsed = (
    agent.detail.variableDefinitions.length
      ? primeFigureDecisionSchema.parse(normalizedRaw)
      : {
          ...primeFigureDecisionWithoutVariablesSchema.parse(normalizedRaw),
          variables: {},
        }
  ) as PrimeFigureDecision;
  const parsedActionFilter = filterPrimeActionsByCapabilities(
    parsed.actions,
    runtimeConfig,
    rawDynamicFilter?.sourceIndices,
  );
  const parsedDynamicFilter = filterPrimeDynamicActions(
    parsedActionFilter.actions,
    availableStickerIds,
    pendingTransferIds,
    parsedActionFilter.sourceIndices,
  );
  const decision = filterUnavailableReferenceMediaIds(
    {
      ...parsed,
      actions: parsedDynamicFilter.actions as PrimeFigureDecision["actions"],
    },
    availableReferenceImageIds,
  );
  return {
    decision,
    sourceActionIndices: parsedDynamicFilter.sourceIndices,
    mediaAnnotations: normalizeMediaAnnotations(
      raw.mediaAnnotations,
      pendingMedia,
    ),
  };
}

function filterPrimeDynamicActions<T>(
  actions: T[],
  availableStickerIds: string[],
  pendingTransferIds: string[],
  sourceIndices: number[] = actions.map((_, index) => index),
) {
  const stickerIds = new Set(availableStickerIds);
  const transferIds = new Set(pendingTransferIds);
  const retainedActions: T[] = [];
  const retainedSourceIndices: number[] = [];
  actions.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      retainedActions.push(value);
      retainedSourceIndices.push(sourceIndices[index] ?? index);
      return;
    }
    const action = value as Record<string, unknown>;
    const message =
      action.message &&
      typeof action.message === "object" &&
      !Array.isArray(action.message)
        ? (action.message as Record<string, unknown>)
        : null;
    if (
      message?.type === "sticker" &&
      (typeof message.stickerId !== "string" ||
        !stickerIds.has(message.stickerId))
    )
      return;
    if (
      action.type === "transfer" &&
      (action.operation === "accept" || action.operation === "reject") &&
      (typeof action.transferId !== "string" ||
        !transferIds.has(action.transferId))
    )
      return;
    retainedActions.push(value);
    retainedSourceIndices.push(sourceIndices[index] ?? index);
  });
  return { actions: retainedActions, sourceIndices: retainedSourceIndices };
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

function formatElapsedDuration(fromMs: number, nowMs: number) {
  const minutes = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (minutes < 2) return "不到 2 分钟";
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `约 ${hours} 小时`;
  return `约 ${Math.round(hours / 24)} 天`;
}

function describePrimeContent(content: PrimeMessageContent) {
  if (content.type === "text") return content.text;
  if (content.type === "image")
    return `[图片] ${content.description ?? "尚未描述"}`;
  if (content.type === "video")
    return `[视频] ${content.description ?? "尚未描述"}`;
  if (content.type === "voice")
    return `[语音] ${content.transcript ?? "尚未转写"}`;
  if (content.type === "sticker") return `[表情] ${content.description}`;
  return `[转账] ${content.direction === "received" ? "收到" : "支付"} ${content.currency} ${content.amount}（${content.status}）${content.note ? `，${content.note}` : ""}`;
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
