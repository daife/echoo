import { randomUUID } from "node:crypto";
import type {
  Message,
  PrimeFigureDecision,
  PrimeFigureOutgoingMessage,
} from "@echoo/shared";
import { estimateMp3DurationSeconds } from "@echoo/shared";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";
import { requireVisualDimensions } from "../../../resources/media-reference.js";
import { OpenRouterImageGenerationService } from "../../../image-generation/openrouter-image-generation.service.js";
import {
  FishAudioTtsService,
  type FishAudioTtsResult,
  type FishAudioTtsStream,
} from "../../../tts/fish-audio-tts.service.js";
import type { PrimeDecisionStreamFieldDelta } from "./prime-decision-stream-parser.js";
import { PrimeConversationMediaRepository } from "./prime-conversation-media.repository.js";
import { primeModelSessionId } from "./prime-model-session.js";
import { MessageRepository } from "../../../messaging/message.repository.js";
import type { StoredPrimeFigureRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";
import { isPrimeOutputMessageTypeEnabled } from "./prime-output-capabilities.js";

interface ResolvedPrimeMedia {
  resourceId: string;
  mediaUrl: string;
}

export interface ResolvedPrimeVoiceMedia extends ResolvedPrimeMedia {
  durationSeconds: number;
}

export interface ResolvedPrimeImageMedia extends ResolvedPrimeMedia {
  mediaId: string;
  model: string;
  width: number;
  height: number;
}

interface PrimeStreamFailureDiagnostics {
  rawResponse: string;
  providerId: string;
  model: string;
}

const RAW_RESPONSE_METADATA_LIMIT = 65_536;

interface Deferred<T> {
  promise: Promise<T>;
  settled: boolean;
  resolve: (value: T) => void;
}

interface VoiceActionState {
  type: "voice";
  tts?: FishAudioTtsStream;
  voicePromise?: Promise<ResolvedPrimeVoiceMedia>;
  ttsError?: string;
  audioStarted: boolean;
  audioSequence: number;
  pendingAudio: Buffer[];
  optimizedTranscriptReady?: boolean;
}

interface ImageActionState {
  type: "image";
  referenceMediaIds: string[];
  referenceMediaIdBuffer: string;
  referenceMediaIdsComplete: boolean;
  generationPromptComplete: boolean;
  imagePromise?: Promise<ResolvedPrimeImageMedia>;
}

type ActionKindState =
  | { type: "unresolved" }
  | { type: "text" }
  | VoiceActionState
  | ImageActionState;

interface StreamedTextState {
  pending: string;
  flushScheduled: boolean;
  complete: Deferred<void>;
  liveCacheWrite: Promise<void>;
}

interface StreamedActionState {
  id: string;
  kind: ActionKindState;
  typeBuffer: string;
  fields: Partial<
    Record<"text" | "description" | "generationPrompt" | "transcript", string>
  >;
  ignored: boolean;
  created: boolean;
  revealed: boolean;
  createdAt?: number;
  revealPromise?: Promise<void>;
  delivery: Deferred<number>;
  text: StreamedTextState;
}

export class PrimeDecisionStreamSession {
  private readonly actions = new Map<number, StreamedActionState>();
  private deliveryTail: Promise<number> = Promise.resolve(Date.now());
  private readonly tts: FishAudioTtsService;
  private readonly imageGeneration: OpenRouterImageGenerationService;
  private finalizing = false;
  private scheduledMessageCount = 0;
  private readonly deferredDelivery: boolean;

  constructor(
    private readonly input: {
      ownerUserId: string;
      conversationId: string;
      voiceRequestStreaming: boolean;
      runtimeConfig: StoredPrimeFigureRuntimeConfig;
    },
    private readonly appPush = new AppPushService(),
    tts?: FishAudioTtsService,
    private readonly resources = new ResourceRepository(),
    imageGeneration?: OpenRouterImageGenerationService,
    private readonly conversationMedia = new PrimeConversationMediaRepository(),
    private readonly messages = new MessageRepository(),
  ) {
    this.deferredDelivery =
      input.runtimeConfig.outputs.sticker.enabled ||
      input.runtimeConfig.outputs.transfer.enabled;
    this.tts =
      tts ?? new FishAudioTtsService(input.runtimeConfig.outputs.voice.tts);
    this.imageGeneration =
      imageGeneration ??
      new OpenRouterImageGenerationService(
        input.runtimeConfig.outputs.image.generator,
      );
  }

  handleField(event: PrimeDecisionStreamFieldDelta) {
    const state = this.getAction(event.actionIndex);
    if (event.field === "type") {
      if (!event.complete) state.typeBuffer += event.delta;
      if (event.complete && isMessageType(state.typeBuffer)) {
        if (
          !isPrimeOutputMessageTypeEnabled(
            this.input.runtimeConfig,
            state.typeBuffer,
          )
        ) {
          state.ignored = true;
          return;
        }
        setActionKind(state, state.typeBuffer);
        if (!(
          state.typeBuffer === "voice" &&
          this.input.runtimeConfig.optimization.voice.enabled
        ))
          this.ensureCreated(state);
      }
      return;
    }

    if (state.ignored) return;

    if (event.field === "referenceMediaId") {
      if (state.kind.type !== "image") return;
      const image = state.kind;
      image.referenceMediaIdBuffer += event.delta;
      if (event.complete) {
        if (image.referenceMediaIdBuffer)
          image.referenceMediaIds.push(image.referenceMediaIdBuffer);
        image.referenceMediaIdBuffer = "";
      }
      return;
    }
    if (event.field === "referenceMediaIds") {
      if (state.kind.type !== "image") return;
      state.kind.referenceMediaIdsComplete = true;
      this.maybeStartImage(state);
      return;
    }

    state.fields[event.field] = append(state.fields[event.field], event.delta);
    if (
      event.field === "transcript" &&
      this.input.runtimeConfig.optimization.voice.enabled &&
      !this.finalizing
    )
      return;
    if (
      this.input.voiceRequestStreaming &&
      event.field === "transcript" &&
      event.delta
    )
      this.ensureStreamingTts(state);
    if (event.field === "generationPrompt" && event.complete) {
      if (state.kind.type === "image") {
        state.kind.generationPromptComplete = true;
        this.maybeStartImage(state);
      }
    }
    if (
      state.created &&
      event.delta &&
      event.field === visibleField(messageType(state))
    ) {
      this.queueTextDelta(state, event.delta);
    }
    if (
      event.complete &&
      ((messageType(state) === "text" && event.field === "text") ||
        (messageType(state) === "voice" && event.field === "transcript"))
    ) {
      this.resolveTextComplete(state);
      if (messageType(state) === "text")
        void this.completeTextDelivery(state).catch(() => undefined);
    }
    if (
      this.input.voiceRequestStreaming &&
      event.complete &&
      event.field === "transcript"
    )
      this.finishStreamingVoice(state);
  }

  async finalize(
    decision: PrimeFigureDecision,
    sourceActionIndices: number[] = decision.actions.map((_, index) => index),
  ) {
    this.finalizing = true;
    const voiceMedia = new Map<number, ResolvedPrimeVoiceMedia>();
    const imageMedia = new Map<number, ResolvedPrimeImageMedia>();
    const imageGenerationErrors = new Map<number, string>();

    for (const [index, action] of decision.actions.entries()) {
      if (action.type !== "send_message") continue;
      // Stickers are existing resources rather than generated/streamed media.
      // The action executor persists them after the decision is complete.
      if (action.message.type === "sticker") continue;
      const state = this.getAction(sourceActionIndices[index] ?? index);
      setActionKind(state, action.message.type);
      if (
        action.message.type === "voice" &&
        this.input.runtimeConfig.optimization.voice.enabled &&
        !ensureVoiceState(state).optimizedTranscriptReady
      )
        state.fields.transcript = "";
      this.ensureCreated(state);
      const finalText = getVisibleText(action.message);
      const streamedText = state.fields[visibleField(messageType(state))] ?? "";
      if (finalText.startsWith(streamedText)) {
        const missing = finalText.slice(streamedText.length);
        if (missing) {
          state.fields[visibleField(messageType(state))] = finalText;
          this.queueTextDelta(state, missing);
        }
      }
      if (action.message.type === "image") {
        const image = ensureImageState(state);
        state.fields.generationPrompt = action.message.generationPrompt;
        image.referenceMediaIds = [...action.message.referenceMediaIds];
        image.generationPromptComplete = true;
        image.referenceMediaIdsComplete = true;
        this.maybeStartImage(state);
      } else if (action.message.type === "voice") {
        state.fields.transcript = action.message.transcript;
        this.resolveTextComplete(state);
        if (this.input.voiceRequestStreaming) {
          this.ensureStreamingTts(state);
          this.finishStreamingVoice(state);
        } else {
          this.startVoiceSynthesis(state, action.message.transcript);
        }
      } else {
        this.resolveTextComplete(state);
        void this.completeTextDelivery(state).catch(() => undefined);
      }
    }

    for (const state of this.actions.values()) this.flushTextDelta(state);

    await Promise.all(
      decision.actions.map(async (action, index) => {
        if (action.type !== "send_message") return;
        if (action.message.type === "sticker") return;
        const state = this.getAction(sourceActionIndices[index] ?? index);
        if (action.message.type === "image") {
          const image = ensureImageState(state);
          try {
            const generated = await image.imagePromise;
            if (generated) imageMedia.set(index, generated);
          } catch (error) {
            imageGenerationErrors.set(index, toErrorMessage(error));
          } finally {
            this.resolveDelivery(state);
          }
          return;
        }
        if (action.message.type !== "voice") return;
        const voice = ensureVoiceState(state);
        try {
          const generated = await voice.voicePromise;
          if (generated) voiceMedia.set(index, generated);
        } catch (error) {
          voice.ttsError = toErrorMessage(error);
          await state.revealPromise;
          if (state.revealed)
            this.appPush.pushToUser(this.input.ownerUserId, {
              type: "message.audio.failed",
              messageId: state.id,
              conversationId: this.input.conversationId,
              error: voice.ttsError,
            });
        } finally {
          this.resolveDelivery(state);
        }
      }),
    );
    await this.deliveryTail;
    await Promise.all(
      [...this.actions.values()].map((state) => state.text.liveCacheWrite),
    );

    return {
      deferredDelivery: this.deferredDelivery,
      messageIds: new Map(
        decision.actions.flatMap((action, index) => {
          if (action.type !== "send_message") return [];
          if (action.message.type === "sticker") return [];
          const state = this.getAction(sourceActionIndices[index] ?? index);
          return state.created ? [[index, state.id] as const] : [];
        }),
      ),
      voiceMedia,
      imageMedia,
      imageGenerationErrors,
      messageCreatedAt: new Map(
        decision.actions.flatMap((action, index) => {
          if (action.type !== "send_message") return [];
          if (action.message.type === "sticker") return [];
          const state = this.getAction(sourceActionIndices[index] ?? index);
          return state.createdAt === undefined
            ? []
            : [[index, state.createdAt] as const];
        }),
      ),
      ttsErrors: new Map(
        decision.actions.flatMap((action, index) => {
          if (action.type !== "send_message") return [];
          if (action.message.type === "sticker") return [];
          const state = this.getAction(sourceActionIndices[index] ?? index);
          return state.kind.type === "voice" && state.kind.ttsError
            ? [[index, state.kind.ttsError] as const]
            : [];
        }),
      ),
    };
  }

  beginVoiceOptimization(actionIndex: number) {
    const state = this.getAction(actionIndex);
    setActionKind(state, "voice");
    const voice = ensureVoiceState(state);
    voice.tts?.abort();
    voice.tts = undefined;
    voice.voicePromise = undefined;
    voice.ttsError = undefined;
    voice.pendingAudio = [];
    voice.optimizedTranscriptReady = false;
    state.fields.transcript = "";
    if (this.input.voiceRequestStreaming) this.ensureStreamingTts(state);
  }

  pushOptimizedVoiceDelta(actionIndex: number, delta: string) {
    if (!delta) return;
    const state = this.getAction(actionIndex);
    setActionKind(state, "voice");
    state.fields.transcript = append(state.fields.transcript, delta);
    if (this.input.voiceRequestStreaming) {
      this.ensureStreamingTts(state);
      ensureVoiceState(state).tts?.write(delta);
    }
  }

  completeVoiceOptimization(actionIndex: number, transcript: string) {
    const state = this.getAction(actionIndex);
    setActionKind(state, "voice");
    const voice = ensureVoiceState(state);
    state.fields.transcript = transcript;
    voice.optimizedTranscriptReady = true;
    this.ensureCreated(state);
    this.queueTextDelta(state, transcript, false);
    this.resolveTextComplete(state);
    if (this.input.voiceRequestStreaming) this.finishStreamingVoice(state);
  }

  fallbackVoiceOptimization(actionIndex: number, transcript: string) {
    const state = this.getAction(actionIndex);
    setActionKind(state, "voice");
    const voice = ensureVoiceState(state);
    voice.tts?.abort();
    voice.tts = undefined;
    voice.voicePromise = undefined;
    voice.ttsError = undefined;
    voice.pendingAudio = [];
    voice.optimizedTranscriptReady = false;
    state.fields.transcript = "";
    // finalize() will reveal and synthesize the decision-model fallback.
    void transcript;
  }

  async fail(error: unknown, diagnostics?: PrimeStreamFailureDiagnostics) {
    const createdStates = [...this.actions.values()].filter(
      (state) => state.created,
    );
    const rawResponseMessageId = createdStates[0]?.id;
    for (const state of this.actions.values()) {
      this.resolveTextComplete(state);
      this.flushTextDelta(state);
      if (state.kind.type === "voice") state.kind.tts?.abort();
    }
    await Promise.all(
      createdStates.map((state, index) =>
        this.failState(state, error, {
          ...(index === 0 && diagnostics
            ? buildFailureDiagnostics(diagnostics)
            : diagnostics && rawResponseMessageId
              ? { rawResponseMessageId }
              : {}),
        }),
      ),
    );
  }

  private getAction(index: number) {
    const existing = this.actions.get(index);
    if (existing) return existing;
    const state: StreamedActionState = {
      id: `msg_${randomUUID()}`,
      kind: { type: "unresolved" },
      typeBuffer: "",
      fields: {},
      ignored: false,
      created: false,
      revealed: false,
      delivery: createDeferred<number>(),
      text: {
        pending: "",
        flushScheduled: false,
        complete: createDeferred<void>(),
        liveCacheWrite: Promise.resolve(),
      },
    };
    this.actions.set(index, state);
    return state;
  }

  private ensureCreated(state: StreamedActionState) {
    const type = messageType(state);
    if (state.created || !type) return;
    // These actions are persisted by the executor. Deferring the surrounding
    // messages too preserves mixed action ordering in the final timeline.
    if (this.deferredDelivery) return;
    const hasPredecessor = this.scheduledMessageCount > 0;
    this.scheduledMessageCount += 1;
    state.created = true;
    const predecessor = this.deliveryTail;
    state.revealPromise = (async () => {
      const predecessorCompletedAt = await predecessor;
      if (hasPredecessor && isTimedMessageType(type)) {
        await state.text.complete.promise;
        const elapsed = Date.now() - predecessorCompletedAt;
        const remaining =
          textMessageGapMs(
            state.fields[visibleField(type)] ?? "",
            this.input.runtimeConfig.typingCharsPerMinute,
          ) - elapsed;
        if (remaining > 0) await delay(remaining);
      }
      const now = Date.now();
      state.createdAt = now;
      const placeholder = this.buildPlaceholder(state, now, "pending", {
        kind: "prime_figure",
      });
      await this.messages.save({
        ownerUserId: this.input.ownerUserId,
        ...placeholder,
      });
      state.revealed = true;
      this.appPush.pushToUser(this.input.ownerUserId, {
        type: "message.created",
        message: placeholder,
      });
      if (
        this.input.voiceRequestStreaming &&
        state.kind.type === "voice" &&
        state.kind.tts
      )
        this.startAudioDelivery(state);
      this.flushTextDelta(state);
    })();
    this.deliveryTail = state.delivery.promise;
  }

  private pushAudioChunk(state: StreamedActionState, chunk: Buffer) {
    const voice = ensureVoiceState(state);
    this.appPush.pushToUser(this.input.ownerUserId, {
      type: "message.audio.chunk",
      messageId: state.id,
      conversationId: this.input.conversationId,
      sequence: voice.audioSequence++,
      dataBase64: chunk.toString("base64"),
    });
  }

  private startAudioDelivery(state: StreamedActionState) {
    const voice = ensureVoiceState(state);
    if (voice.audioStarted) return;
    this.appPush.pushToUser(this.input.ownerUserId, {
      type: "message.audio.started",
      messageId: state.id,
      conversationId: this.input.conversationId,
      mimeType: "audio/mpeg",
    });
    voice.audioStarted = true;
    for (const chunk of voice.pendingAudio) this.pushAudioChunk(state, chunk);
    voice.pendingAudio = [];
  }

  private ensureStreamingTts(state: StreamedActionState) {
    if (state.kind.type !== "voice") return;
    const voice = state.kind;
    if (voice.tts || voice.ttsError) return;
    try {
      voice.tts = this.tts.createStream((chunk) => {
        if (voice.audioStarted) this.pushAudioChunk(state, chunk);
        else voice.pendingAudio.push(chunk);
      });
      if (state.revealed) this.startAudioDelivery(state);
    } catch (error) {
      voice.ttsError = toErrorMessage(error);
      void state.revealPromise?.then(() => {
        this.appPush.pushToUser(this.input.ownerUserId, {
          type: "message.audio.failed",
          messageId: state.id,
          conversationId: this.input.conversationId,
          error: voice.ttsError as string,
        });
      });
    }
  }

  private finishStreamingVoice(state: StreamedActionState) {
    this.ensureStreamingTts(state);
    if (state.kind.type !== "voice") return;
    const voice = state.kind;
    if (voice.voicePromise || !voice.tts) return;
    voice.voicePromise = this.persistVoiceResult(
      state,
      voice.tts.finish(),
      state.fields.transcript ?? "",
    );
    void voice.voicePromise.catch(() => undefined);
  }

  private startVoiceSynthesis(state: StreamedActionState, transcript: string) {
    if (state.kind.type !== "voice") return;
    const voice = state.kind;
    if (voice.voicePromise) return;
    const audioStarted = state.revealPromise
      ? state.revealPromise.then(() => this.startAudioDelivery(state))
      : Promise.resolve();
    void audioStarted.catch(() => undefined);
    voice.voicePromise = this.persistVoiceResult(
      state,
      this.tts.synthesize(transcript, (chunk) => {
        if (voice.audioStarted) this.pushAudioChunk(state, chunk);
        else voice.pendingAudio.push(chunk);
      }),
      transcript,
      audioStarted,
    );
    void voice.voicePromise.catch(() => undefined);
  }

  private async persistVoiceResult(
    state: StreamedActionState,
    resultPromise: Promise<FishAudioTtsResult>,
    transcript: string,
    audioStarted?: Promise<unknown>,
  ) {
    const deliveryStarted =
      audioStarted ??
      (state.revealPromise
        ? state.revealPromise.then(() => this.startAudioDelivery(state))
        : Promise.resolve());
    const result = await resultPromise;
    const resource = await this.resources.saveGeneratedMedia(
      this.input.ownerUserId,
      "prime_figure_voice",
      result.mimeType,
      result.audio,
    );
    await this.conversationMedia.ensure({
      ownerUserId: this.input.ownerUserId,
      conversationId: this.input.conversationId,
      resourceId: resource.id,
      mediaType: "voice",
      description: transcript,
      source: "generated",
    });
    await deliveryStarted;
    if (state.revealed)
      this.appPush.pushToUser(this.input.ownerUserId, {
        type: "message.audio.completed",
        messageId: state.id,
        conversationId: this.input.conversationId,
        mediaUrl: resource.publicPath,
      });
    return {
      resourceId: resource.id,
      mediaUrl: resource.publicPath,
      durationSeconds: estimateMp3DurationSeconds(result.audio),
    };
  }

  private maybeStartImage(state: StreamedActionState) {
    if (state.kind.type !== "image") return;
    if (this.input.runtimeConfig.optimization.image.enabled && !this.finalizing)
      return;
    const image = state.kind;
    if (
      image.imagePromise ||
      !image.generationPromptComplete ||
      !image.referenceMediaIdsComplete
    )
      return;
    image.imagePromise = (async () => {
      const references = await this.conversationMedia.resolveImageReferences(
        this.input.ownerUserId,
        this.input.conversationId,
        image.referenceMediaIds,
      );
      const generated = await this.imageGeneration.generate({
        prompt: state.fields.generationPrompt ?? "",
        sessionId: primeModelSessionId(
          this.input.conversationId,
          "image-generation",
        ),
        references: await Promise.all(
          references.map(async (reference) => {
            const resource = await this.resources.readForOwner(
              this.input.ownerUserId,
              reference.resourceId,
            );
            if (!resource)
              throw new Error(`参考图片资源不可读：${reference.mediaId}。`);
            return { mimeType: resource.record.mimeType, data: resource.data };
          }),
        ),
      });
      const resource = await this.resources.saveGeneratedMedia(
        this.input.ownerUserId,
        "prime_figure_image",
        generated.mimeType,
        generated.data,
      );
      const registered = await this.conversationMedia.ensure({
        ownerUserId: this.input.ownerUserId,
        conversationId: this.input.conversationId,
        resourceId: resource.id,
        mediaType: "image",
        description: state.fields.description ?? "",
        source: "generated",
      });
      return {
        resourceId: resource.id,
        mediaUrl: resource.publicPath,
        mediaId: registered.mediaId,
        model: generated.model,
        ...requireVisualDimensions(resource),
      };
    })();
    void image.imagePromise.catch(() => undefined);
  }

  private async completeTextDelivery(state: StreamedActionState) {
    await state.revealPromise;
    this.flushTextDelta(state);
    this.resolveDelivery(state);
  }

  private resolveDelivery(state: StreamedActionState) {
    state.delivery.resolve(Date.now());
  }

  private resolveTextComplete(state: StreamedActionState) {
    state.text.complete.resolve(undefined);
  }

  private async failState(
    state: StreamedActionState,
    error: unknown,
    diagnostics: Record<string, unknown> = {},
  ) {
    await state.revealPromise?.catch(() => undefined);
    if (!state.revealed) return;
    const now = state.createdAt ?? Date.now();
    const message = this.buildPlaceholder(state, now, "failed", {
      kind: "prime_figure_stream_error",
      error: toErrorMessage(error),
      ...diagnostics,
    });
    await this.messages.save({
      ownerUserId: this.input.ownerUserId,
      ...message,
    });
    this.appPush.pushToUser(this.input.ownerUserId, {
      type: "message.completed",
      message,
    });
    this.resolveDelivery(state);
  }

  private queueTextDelta(
    state: StreamedActionState,
    delta: string,
    writeTts = true,
  ) {
    if (
      writeTts &&
      this.input.voiceRequestStreaming &&
      state.kind.type === "voice"
    )
      state.kind.tts?.write(delta);
    state.text.pending += delta;
    if (state.text.flushScheduled) return;
    state.text.flushScheduled = true;
    queueMicrotask(() => this.flushTextDelta(state));
  }

  private flushTextDelta(state: StreamedActionState) {
    state.text.flushScheduled = false;
    if (!state.revealed) return;
    const delta = state.text.pending;
    if (!delta) return;
    state.text.pending = "";
    this.appPush.pushToUser(this.input.ownerUserId, {
      type: "message.delta",
      messageId: state.id,
      conversationId: this.input.conversationId,
      delta,
      updatedAt: Date.now(),
    });
    const updatedAt = Date.now();
    const liveMessage: Message = {
      ...this.buildPlaceholder(state, state.createdAt ?? updatedAt, "pending", {
        kind: "prime_figure",
      }),
      content: { text: state.fields[visibleField(messageType(state))] ?? "" },
      updatedAt,
    };
    state.text.liveCacheWrite = state.text.liveCacheWrite.then(() =>
      this.messages.updateCachedLive(this.input.ownerUserId, liveMessage),
    );
  }

  private buildPlaceholder(
    state: StreamedActionState,
    now: number,
    status: Message["status"],
    metadata: Record<string, unknown>,
  ): Message {
    return {
      id: state.id,
      conversationId: this.input.conversationId,
      role: "assistant",
      contentType: messageType(state) ?? "text",
      content: { text: "" },
      status,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
  }
}

function buildFailureDiagnostics(input: PrimeStreamFailureDiagnostics) {
  const rawResponse = input.rawResponse.slice(0, RAW_RESPONSE_METADATA_LIMIT);
  return {
    providerId: input.providerId,
    model: input.model,
    rawResponse,
    rawResponseTruncated: rawResponse.length < input.rawResponse.length,
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const deferred: Deferred<T> = {
    promise: new Promise<T>((resolve) => {
      resolvePromise = resolve;
    }),
    settled: false,
    resolve(value) {
      if (deferred.settled) return;
      deferred.settled = true;
      resolvePromise(value);
    },
  };
  return deferred;
}

function messageType(
  state: StreamedActionState,
): "text" | "image" | "voice" | undefined {
  return state.kind.type === "unresolved" ? undefined : state.kind.type;
}

function setActionKind(
  state: StreamedActionState,
  type: "text" | "image" | "voice",
) {
  if (state.kind.type === type) return;
  if (type === "text") {
    state.kind = { type };
    return;
  }
  if (type === "voice") {
    state.kind = {
      type,
      audioStarted: false,
      audioSequence: 0,
      pendingAudio: [],
    };
    return;
  }
  state.kind = {
    type,
    referenceMediaIds: [],
    referenceMediaIdBuffer: "",
    referenceMediaIdsComplete: false,
    generationPromptComplete: false,
  };
}

function ensureVoiceState(state: StreamedActionState) {
  if (state.kind.type !== "voice") setActionKind(state, "voice");
  return state.kind as VoiceActionState;
}

function ensureImageState(state: StreamedActionState) {
  if (state.kind.type !== "image") setActionKind(state, "image");
  return state.kind as ImageActionState;
}

function isMessageType(
  value: string | undefined,
): value is "text" | "image" | "voice" {
  return value === "text" || value === "image" || value === "voice";
}

function isTimedMessageType(
  value: "text" | "image" | "voice" | undefined,
): value is "text" | "voice" {
  return value === "text" || value === "voice";
}

function visibleField(type: "text" | "image" | "voice" | undefined) {
  return type === "voice"
    ? "transcript"
    : type === "image"
      ? "description"
      : "text";
}

function getVisibleText(message: PrimeFigureOutgoingMessage) {
  if (message.type === "text") return message.text;
  if (message.type === "image") return message.description;
  if (message.type === "voice") return message.transcript;
  return "";
}

function append(current: string | undefined, delta: string) {
  return `${current ?? ""}${delta}`;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function textMessageGapMs(text: string, configured: number) {
  const charactersPerMinute =
    Number.isFinite(configured) && configured > 0 ? configured : 300;
  const characterCount = Array.from(text).length;
  return Math.round((characterCount * 60_000) / charactersPerMinute);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
