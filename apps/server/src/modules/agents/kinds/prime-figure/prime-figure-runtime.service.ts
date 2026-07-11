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
import { PrimeActionLogRepository } from "./prime-action-log.repository.js";
import { PrimeActionExecutor } from "./prime-action-executor.js";
import { PrimeMessageRepository } from "./prime-message.repository.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";
import { PrimeDecisionStreamParser } from "./prime-decision-stream-parser.js";
import { PrimeDecisionStreamSession } from "./prime-decision-stream-session.js";
import {
  describeAge,
  findScheduleSegment,
  formatReadableMinute,
  formatWeekdayCode,
} from "./prime-time.js";

const PRIME_CONTEXT_MESSAGE_LIMIT = 18;
const PRIME_VISIBLE_MEMORY_LIMIT = 10;
const RECALL_HINT_PATTERN = /记得|不记得|忘了|还记得|remember|forgot|recal+l/i;

export type PrimeDecisionTrigger =
  "end_user_message" | "silence_ended" | "coalesced_messages";

interface PendingMediaAnnotation {
  id: string;
  messageId: string;
  type: "image" | "video" | "voice";
}

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
    private readonly resources = new ResourceRepository(),
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
          errorMessage: "本初角色状态缺失。",
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
            error instanceof Error ? error.message : "本初角色运行时执行失败。",
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
    const packet = buildPrimeChatMessages(
      input.agent,
      input.state,
      timeline,
      input.trigger,
      input.ownerUserId,
      this.resources,
    );
    const chatMessages = packet.messages;

    const streamSession = new PrimeDecisionStreamSession({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
    });
    const completionBase = {
      model,
      sessionId: input.conversationId,
      temperature: Number(process.env.DEFAULT_PRIME_TEMPERATURE ?? 0.4),
      maxTokens: process.env.DEFAULT_PRIME_MAX_TOKENS
        ? Number(process.env.DEFAULT_PRIME_MAX_TOKENS)
        : undefined,
      reasoningMode: "disabled" as const,
    };

    try {
      const firstResponse = await streamPrimeChatCompletion(
        provider,
        {
          ...completionBase,
          messages: chatMessages,
          tools: [SEARCH_RECALL_TOOL],
          toolChoice: "auto",
          responseFormat: buildPrimeDecisionResponseFormat(
            input.agent,
            false,
            packet.pendingMedia,
          ),
        },
        streamSession,
      );

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
        finalResponse = await streamPrimeChatCompletion(
          provider,
          {
            ...completionBase,
            messages: chatMessages,
            responseFormat: buildPrimeDecisionResponseFormat(
              input.agent,
              true,
              packet.pendingMedia,
            ),
            toolChoice: "none",
          },
          streamSession,
        );
      }

      const rawOutput = JSON.parse(finalResponse.text) as Record<
        string,
        unknown
      >;
      const decision = primeFigureDecisionSchema.parse(
        rawOutput,
      ) as PrimeFigureDecision;
      const mediaAnnotations = normalizeMediaAnnotations(
        rawOutput.mediaAnnotations,
        packet.pendingMedia,
      );
      const streamed = await streamSession.finalize(decision);
      this.executor.executeDecision({
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        agent: input.agent,
        state: input.state,
        decision,
        providerId: finalResponse.providerId,
        model: finalResponse.model,
        streamedMessageIds: streamed.messageIds,
        voiceMedia: streamed.voiceMedia,
        ttsErrors: streamed.ttsErrors,
      });
      this.persistMediaAnnotations(
        input,
        packet.pendingMedia,
        mediaAnnotations,
      );
      return decision;
    } catch (error) {
      streamSession.fail(error);
      throw error;
    }
  }

  private persistMediaAnnotations(
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
        const updated = this.messages.applyMediaAnnotation({
          ownerUserId: input.ownerUserId,
          messageId: target.messageId,
          expectedType: target.type,
          value,
        });
        if (!updated) throw new Error("待标注媒体消息不存在或类型已改变。");
      } catch (error) {
        this.logs.save({
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

function buildPrimeChatMessages(
  agent: PrimeFigureAgent,
  state: PrimeFigureState,
  timeline: PrimeMessage[],
  trigger: PrimeDecisionTrigger,
  ownerUserId: string,
  resources: ResourceRepository,
): {
  messages: ChatCompletionMessage[];
  pendingMedia: PendingMediaAnnotation[];
} {
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
      "当前 end_user 疑似要求回忆，可能需要考虑调用 search_recall。具体是否属于明确回忆请求由你判断。",
    );
  }
  if (scheduleSegment) {
    hints.push(
      `最近一条 end_user 消息发生在角色的“${scheduleSegment.label}”时段（${scheduleSegment.start}-${scheduleSegment.end}）：${sanitizeVisibleText(scheduleSegment.description, timezone)}`,
    );
  } else {
    hints.push("最近一条 end_user 消息不处于角色已定义的任何日程时段。");
  }
  if (trigger === "silence_ended") {
    hints.push(
      "角色此前选择的沉默期已经结束。沉默期间积累的 end_user 消息已合并到本次数据包，请只作出一次新的决定。",
    );
  } else if (trigger === "coalesced_messages") {
    hints.push(
      "角色作出上一轮决定时又收到了新消息。本次数据包已经合并这些消息。",
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
  for (const message of timeline) {
    const at = formatReadableMinute(message.occurredAtMs, timezone);
    const sender = toLlmSender(message.sender);
    const messageContent = message.content;

    if (messageContent.type === "text") {
      content.push({
        type: "text",
        text: JSON.stringify({
          at,
          sender,
          type: "text",
          text: sanitizeVisibleText(messageContent.text, timezone),
        }),
      });
      continue;
    }

    if (messageContent.type === "image" || messageContent.type === "video") {
      const description = messageContent.description?.trim();
      if (description) {
        content.push({
          type: "text",
          text: JSON.stringify({
            at,
            sender,
            type: messageContent.type,
            description: sanitizeVisibleText(description, timezone),
          }),
        });
        continue;
      }

      const target: PendingMediaAnnotation = {
        id: `media_${pendingMedia.length + 1}`,
        messageId: message.id,
        type: messageContent.type,
      };
      pendingMedia.push(target);
      content.push({
        type: "text",
        text: JSON.stringify({
          at,
          sender,
          type: messageContent.type,
          annotationId: target.id,
          description: null,
        }),
      });
      content.push(
        buildRawMediaPart(
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
      if (transcript) {
        content.push({
          type: "text",
          text: JSON.stringify({
            at,
            sender,
            type: "voice",
            transcript: sanitizeVisibleText(transcript, timezone),
          }),
        });
        continue;
      }

      const target: PendingMediaAnnotation = {
        id: `media_${pendingMedia.length + 1}`,
        messageId: message.id,
        type: "voice",
      };
      pendingMedia.push(target);
      content.push({
        type: "text",
        text: JSON.stringify({
          at,
          sender,
          type: "voice",
          annotationId: target.id,
          transcript: null,
        }),
      });
      content.push(
        buildRawMediaPart(
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

  content.push({
    type: "text",
    text: JSON.stringify({
      now: formatReadableMinute(now, timezone),
      weekday: formatWeekdayCode(now, timezone),
      figureNow: {
        mood: state.mood
          ? `角色当前情绪：“${state.mood}”。该判断形成于${describeAge(state.moodObservedAtMs, now)}。`
          : "角色当前没有已记录的情绪。",
        relationship: state.relationshipStatus || undefined,
        variables: makeLlmReadable(state.variables, timezone),
      },
      memories: visibleMemories,
      hints,
    }),
  });

  return {
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(agent),
      },
      {
        role: "user",
        content,
      },
    ],
    pendingMedia,
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

function buildRawMediaPart(
  ownerUserId: string,
  resourceId: string | undefined,
  type: PendingMediaAnnotation["type"],
  resources: ResourceRepository,
): ChatCompletionContentPart {
  if (!resourceId) throw new Error(`未描述的 ${type} 消息缺少资源 ID。`);
  const resource = resources.readForOwner(ownerUserId, resourceId);
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

function buildSystemPrompt(agent: PrimeFigureAgent) {
  const timezone = agent.detail.schedule.timezone;
  const schedule = agent.detail.schedule.segments.map(
    (segment) =>
      `${segment.days.join(",")} ${segment.start}-${segment.end} ${segment.label}: ${sanitizeVisibleText(segment.description, timezone)}`,
  );
  const parameters = agent.detail.variableDefinitions.map(
    (definition) =>
      `${definition.key} (${definition.type}, nullable): ${sanitizeVisibleText(definition.description, timezone)}`,
  );

  return [
    `你要从角色“${agent.name}”自身的视角模拟该角色。`,
    "你的目标是维持一个可信的角色，使其人格、记忆、情绪、日程、偏好、边界和关系保持连续。",
    "你的目标不是满足、安慰、挽留或取悦 end_user。请决定这个角色真正会想什么、做什么。",
    "先写出简洁的、以角色为中心的决策依据。分析角色自身的情绪、动机、日程、记忆、抗拒、欲望和边界。",
    "不要对 end_user 的意图分类。不要输出 userIntent、relationshipSignal、riskLevel、隐藏思维链或逐动作理由。",
    "角色可以发送一条或多条文本、图片或语音消息，也可以保持沉默。每次决定建议生成 1 至 3 个 send_message 动作；当角色确实情绪激动时，可以发送更多消息。",
    "发送图片时必须同时提供面向对话的客观 description 和用于后续生图的 generationPrompt。发送语音时 transcript 是角色实际说出的内容，并将用于后续 TTS。暂时不得发送 video 或 sticker。",
    "语音 transcript 可以在自然位置使用 Fish Audio 表演标签：[angry] [sad] [embarrassed] [emphasis] [whispering] [soft] [breathy] [excited] [laughing] [chuckling] [moaning] [clear throat] [sobbing] [crying loudly] [sighing] [panting] [groaning] [crowd laughing] [background laughter] [audience laughing] [pause] [long pause]。标签只用于确有对应语气或声音的地方，不要机械添加。",
    "为了让消息能够实时显示和合成，send_message.message 中必须先输出 type，再输出 text、description/generationPrompt 或 transcript；各消息必须严格按实际发送顺序输出。",
    "send_message 与 silence 互斥。若选择 silence，它必须是唯一动作；否则所有动作都必须是 send_message，并按发送顺序排列。",
    "只有当 currentSituation、schedule、itinerary 或 relationshipStatus 确实发生变化时，才使用可选的 stateUpdates 对象。要保留某字段当前值，可以省略该字段或将其设为 null。",
    "已存储的情绪是历史证据，不是要求永远维持它的指令。请考虑它是在多久之前被观察到的。",
    "记忆的 eventAt 表示该事件在角色时间线中的归属时间。有充分依据时复制可见的 YYYY-MM-DDTHH:mm 时间，否则使用 null。",
    "所有可见的精确时间均采用角色时区下的 YYYY-MM-DDTHH:mm 格式。不得虚构更精确或没有依据的时间。",
    "仅在 search_recall 工具描述规定的条件下使用该工具。",
    "只返回符合严格 schema 的 JSON。创作者定义的参数可以使用 null 保留先前值。",
    "",
    `人设：${sanitizeVisibleText(agent.detail.persona, timezone)}`,
    `背景：${sanitizeVisibleText(agent.detail.background, timezone)}`,
    `性格：${sanitizeVisibleText(agent.detail.personality, timezone)}`,
    `回复风格：${sanitizeVisibleText(agent.detail.responseStyle, timezone)}`,
    `决策风格：${sanitizeVisibleText(agent.detail.decisionStyle, timezone) || "无额外决策风格。"}`,
    `当前处境：${sanitizeVisibleText(agent.detail.currentSituation, timezone) || "无额外当前处境。"}`,
    `行程：${sanitizeVisibleText(agent.detail.itinerary, timezone) || "无行程。"}`,
    `日程：\n${schedule.length ? schedule.join("\n") : "无日程时段。"}`,
    `创作者输出参数：\n${parameters.length ? parameters.join("\n") : "无自定义参数。"}`,
  ].join("\n");
}

const SEARCH_RECALL_TOOL: ChatToolDefinition = {
  type: "function",
  function: {
    name: "search_recall",
    description:
      "按关键词搜索角色更早的记忆和对话历史。仅当 end_user 明确询问角色是否记得过去的事实或事件，并且可见记忆与近期对话中尚无答案时调用。普通问题、随口提及过去、仅出现“记得”等词语，或可见上下文已经足够时，不得调用。若调用此工具，最终的 memoryWrites 必须至少包含一条整合后的记忆；若没有找到历史证据，应记录 end_user 当前的说法，不得假装角色此前就记得此事。",
    parameters: {
      type: "object",
      description: "用于检索角色更早记忆的关键词查询。",
      properties: {
        keywords: {
          type: "array",
          description:
            "从明确的回忆请求中复制或提炼出的 1 至 6 个简短且具有区分度的关键词。",
          items: { type: "string", description: "一个简短的回忆检索关键词。" },
          minItems: 1,
          maxItems: 6,
        },
        limit: {
          type: "integer",
          description:
            "历史记录结果和记忆结果各自允许返回的最大数量，范围为 1 至 8。",
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
        description: "针对当前运行时事件数据包的一次以角色为中心的决定。",
        properties: {
          rationale: {
            type: "string",
            description:
              "在选择动作前写出的简洁决策依据。分析角色自身的情绪、动机、日程、记忆、欲望、抗拒和边界，而不是 end_user 的意图。",
          },
          figureMood: {
            type: "string",
            description:
              "角色作出本次决定时的当前情绪。运行时会自动附加观察时间。",
          },
          variables: {
            type: "object",
            description:
              "创作者定义的每个输出参数的当前值。需要保留原值时使用 null。",
            properties: variableProperties,
            required: variableKeys,
            additionalProperties: false,
          },
          memoryWrites: {
            type: "array",
            description:
              "新增的持久角色记忆。除非该事件值得日后回忆，否则保持为空。调用 search_recall 后必须至少写入一条。",
            minItems: requireMemoryWrite ? 1 : 0,
            maxItems: 8,
            items: {
              type: "object",
              description: "一条简洁记忆及其在角色时间线中的锚点。",
              properties: {
                content: {
                  type: "string",
                  description:
                    "自包含的记忆内容，不得包含数据库 ID 或来源消息元数据。",
                },
                eventAt: {
                  anyOf: [
                    {
                      type: "string",
                      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
                      description:
                        "角色时区下的可读事件时间，必须从可见证据中复制。",
                    },
                    {
                      type: "null",
                      description:
                        "没有可证实的可见事件时间时使用；运行时会将其锚定到响应时间。",
                    },
                  ],
                  description:
                    "该记忆在角色时间线中的归属时间；未知时为 null。",
                },
              },
              required: ["content", "eventAt"],
              additionalProperties: false,
            },
          },
          stateUpdates: {
            type: "object",
            description:
              "可选的持久角色上下文变更。无变化时省略此对象；要保留某字段时，省略该字段或使用 null。",
            properties: {
              currentSituation: nullableStringSchema(
                "角色当前处境的完整替换内容；使用 null 保留原值。",
                4000,
              ),
              schedule: {
                description: "角色时区下的完整替换日程；使用 null 保留原值。",
                anyOf: [buildScheduleOutputSchema(), { type: "null" }],
              },
              itinerary: nullableStringSchema(
                "完整替换行程；使用 null 保留原值。",
                8000,
              ),
              relationshipStatus: nullableStringSchema(
                "角色与 end_user 更新后的关系状态；使用 null 保留原值。",
                500,
              ),
            },
            additionalProperties: false,
          },
          actions: {
            description:
              "按顺序执行的对外动作。优先发送 1 至 3 条消息；情绪激动时可合理增加。silence 必须单独出现，绝不能与 send_message 并存。",
            anyOf: [
              {
                type: "array",
                description:
                  "严格按此顺序发送的一条或多条文本、图片或语音消息。",
                minItems: 1,
                maxItems: 12,
                items: buildSendMessageActionSchema(),
              },
              {
                type: "array",
                description: "仅包含一个 silence 动作，不得包含消息动作。",
                minItems: 1,
                maxItems: 1,
                items: buildSilenceActionSchema(),
              },
            ],
          },
          ...(pendingMedia.length
            ? {
                mediaAnnotations: {
                  type: "array",
                  description:
                    "为本轮数据包中所有尚未标注的媒体补充描述或语音转写。",
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
      description: `语音 ${target.id} 的转写。`,
      properties: {
        id: { const: target.id, description: "数据包中的临时媒体 ID。" },
        type: { const: "voice", description: "媒体类型。" },
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
    description: `${target.type === "image" ? "图片" : "视频"} ${target.id} 的客观描述。`,
    properties: {
      id: { const: target.id, description: "数据包中的临时媒体 ID。" },
      type: { const: target.type, description: "媒体类型。" },
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
    anyOf: [
      { type: "string", maxLength, description: "替换文本。" },
      { type: "null", description: "保留现有值。" },
    ],
  } as const;
}

function buildScheduleOutputSchema() {
  return {
    type: "object",
    description: "角色的完整每周日程。",
    properties: {
      timezone: {
        type: "string",
        description: "有效的 IANA 时区，例如 Asia/Shanghai。",
      },
      segments: {
        type: "array",
        description: "每周日程时段。",
        // Keep the 100-item limit in Zod only. Gemini rejects this nested
        // maxItems constraint as an overly complex response schema.
        items: {
          type: "object",
          description: "一个每周重复的日程时段。",
          properties: {
            label: { type: "string", description: "简短的时段名称。" },
            days: {
              type: "array",
              description: "生效的星期。",
              minItems: 1,
              maxItems: 7,
              items: {
                type: "string",
                enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                description: "小写星期代码。",
              },
            },
            start: {
              type: "string",
              pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
              description: "采用 HH:mm 格式的开始时间。",
            },
            end: {
              type: "string",
              pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
              description: "采用 HH:mm 格式的结束时间。",
            },
            description: {
              type: "string",
              description: "角色在该时段通常会做什么。",
            },
          },
          required: ["label", "days", "start", "end", "description"],
          additionalProperties: false,
        },
      },
    },
    required: ["timezone", "segments"],
    additionalProperties: false,
  } as const;
}

function buildSendMessageActionSchema() {
  return {
    type: "object",
    description: "立即以角色身份发送一条文本、图片或语音消息。",
    properties: {
      type: {
        const: "send_message",
        description: "选择立即发送角色消息。",
      },
      message: {
        description: "角色发送给 end_user 的确切消息内容。",
        anyOf: [
          {
            type: "object",
            description: "普通文本消息。",
            properties: {
              type: { const: "text", description: "文本内容类型。" },
              text: {
                type: "string",
                description: "角色发送给 end_user 的确切文本。",
              },
            },
            required: ["type", "text"],
            additionalProperties: false,
          },
          {
            type: "object",
            description: "等待后续生成资源的图片消息。",
            properties: {
              type: { const: "image", description: "图片内容类型。" },
              description: {
                type: "string",
                description:
                  "图片在对话中的客观内容描述；后续上下文用它替代原图。",
              },
              generationPrompt: {
                type: "string",
                description: "供后续图像生成服务使用的完整生图提示词。",
              },
            },
            required: ["type", "description", "generationPrompt"],
            additionalProperties: false,
          },
          {
            type: "object",
            description: "等待后续 TTS 生成资源的语音消息。",
            properties: {
              type: { const: "voice", description: "语音内容类型。" },
              transcript: {
                type: "string",
                description:
                  "角色实际说出的内容，也是实时 TTS 的输入文本。可按系统提示在自然位置插入受支持的情绪或特殊表演标签。",
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
    description: "保持沉默，并在重新检查期结束前抑制新的 LLM 数据包。",
    properties: {
      type: {
        const: "silence",
        description: "选择让角色暂时沉默。",
      },
      revisitAfterMinutes: {
        type: "integer",
        description:
          "队列中的 end_user 消息可以触发一次合并决策数据包之前需要等待的分钟数。",
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
    anyOf: [
      base,
      {
        type: "null",
        description: "保留先前值。",
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
