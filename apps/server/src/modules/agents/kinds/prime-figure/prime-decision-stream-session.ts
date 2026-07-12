import { randomUUID } from "node:crypto";
import type {
  Message,
  PrimeFigureDecision,
  PrimeFigureOutgoingMessage,
} from "@echoo/shared";
import { AppPushService } from "../../../realtime/delivery.service.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";
import { OpenRouterImageGenerationService } from "../../../image-generation/openrouter-image-generation.service.js";
import {
  FishAudioTtsService,
  type FishAudioTtsStream,
} from "../../../tts/fish-audio-tts.service.js";
import type { PrimeDecisionStreamFieldDelta } from "./prime-decision-stream-parser.js";
import { PrimeConversationMediaRepository } from "./prime-conversation-media.repository.js";
import { MessageRepository } from "../../../messaging/message.repository.js";

export interface ResolvedPrimeVoiceMedia {
  resourceId: string;
  mediaUrl: string;
}

export interface ResolvedPrimeImageMedia extends ResolvedPrimeVoiceMedia {
  mediaId: string;
  model: string;
}

interface StreamedActionState {
  id: string;
  type?: "text" | "image" | "voice";
  typeBuffer: string;
  fields: Partial<
    Record<"text" | "description" | "generationPrompt" | "transcript", string>
  >;
  created: boolean;
  revealed: boolean;
  createdAt?: number;
  revealPromise?: Promise<void>;
  deliveryDone: Promise<number>;
  resolveDeliveryDone: (completedAt: number) => void;
  deliveryResolved: boolean;
  tts?: FishAudioTtsStream;
  voicePromise?: Promise<ResolvedPrimeVoiceMedia>;
  ttsError?: string;
  audioSequence: number;
  pendingAudio: Buffer[];
  referenceMediaIds: string[];
  referenceMediaIdBuffer: string;
  referenceMediaIdsComplete: boolean;
  generationPromptComplete: boolean;
  imagePromise?: Promise<ResolvedPrimeImageMedia>;
  pendingText: string;
  textFlushScheduled: boolean;
  textComplete: Promise<void>;
  resolveTextComplete: () => void;
  textCompleteResolved: boolean;
  liveCacheWrite: Promise<void>;
}

export class PrimeDecisionStreamSession {
  private readonly actions = new Map<number, StreamedActionState>();
  private deliveryTail: Promise<number> = Promise.resolve(Date.now());

  constructor(
    private readonly input: { ownerUserId: string; conversationId: string },
    private readonly appPush = new AppPushService(),
    private readonly tts = new FishAudioTtsService(),
    private readonly resources = new ResourceRepository(),
    private readonly imageGeneration = new OpenRouterImageGenerationService(),
    private readonly conversationMedia = new PrimeConversationMediaRepository(),
    private readonly messages = new MessageRepository(),
  ) {}

  handleField(event: PrimeDecisionStreamFieldDelta) {
    const state = this.getAction(event.actionIndex);
    if (event.field === "type") {
      if (!event.complete) state.typeBuffer += event.delta;
      if (event.complete && isMessageType(state.typeBuffer)) {
        state.type = state.typeBuffer;
        this.ensureCreated(event.actionIndex, state);
      }
      return;
    }

    if (event.field === "referenceMediaId") {
      state.referenceMediaIdBuffer += event.delta;
      if (event.complete) {
        if (state.referenceMediaIdBuffer)
          state.referenceMediaIds.push(state.referenceMediaIdBuffer);
        state.referenceMediaIdBuffer = "";
      }
      return;
    }
    if (event.field === "referenceMediaIds") {
      state.referenceMediaIdsComplete = true;
      this.maybeStartImage(state);
      return;
    }

    state.fields[event.field] = append(state.fields[event.field], event.delta);
    if (event.field === "transcript" && event.delta) this.ensureTts(state);
    if (event.field === "generationPrompt" && event.complete) {
      state.generationPromptComplete = true;
      this.maybeStartImage(state);
    }
    if (
      state.created &&
      event.delta &&
      event.field === visibleField(state.type)
    ) {
      this.queueTextDelta(state, event.delta);
    }
    if (
      event.complete &&
      ((state.type === "text" && event.field === "text") ||
        (state.type === "voice" && event.field === "transcript"))
    ) {
      this.resolveTextComplete(state);
      if (state.type === "text")
        void this.completeTextDelivery(state).catch(() => undefined);
    }
    if (event.complete && event.field === "transcript")
      this.maybeFinishVoice(state);
  }

  async finalize(decision: PrimeFigureDecision) {
    const voiceMedia = new Map<number, ResolvedPrimeVoiceMedia>();
    const imageMedia = new Map<number, ResolvedPrimeImageMedia>();
    const imageGenerationErrors = new Map<number, string>();

    for (const [index, action] of decision.actions.entries()) {
      if (action.type !== "send_message") continue;
      const state = this.getAction(index);
      state.type = action.message.type;
      this.ensureCreated(index, state);
      const finalText = getVisibleText(action.message);
      const streamedText = state.fields[visibleField(state.type)] ?? "";
      if (finalText.startsWith(streamedText)) {
        const missing = finalText.slice(streamedText.length);
        if (missing) {
          state.fields[visibleField(state.type)] = finalText;
          this.queueTextDelta(state, missing);
        }
      }
      if (action.message.type === "image") {
        state.fields.generationPrompt = action.message.generationPrompt;
        state.referenceMediaIds = [...action.message.referenceMediaIds];
        state.generationPromptComplete = true;
        state.referenceMediaIdsComplete = true;
        this.maybeStartImage(state);
      } else if (action.message.type === "voice") {
        this.resolveTextComplete(state);
        this.ensureTts(state);
        this.maybeFinishVoice(state);
      } else {
        this.resolveTextComplete(state);
        void this.completeTextDelivery(state).catch(() => undefined);
      }
    }

    for (const state of this.actions.values()) this.flushTextDelta(state);

    await Promise.all(
      decision.actions.map(async (action, index) => {
        if (action.type !== "send_message") return;
        const state = this.getAction(index);
        if (action.message.type === "image") {
          try {
            const generated = await state.imagePromise;
            if (generated) imageMedia.set(index, generated);
          } catch (error) {
            imageGenerationErrors.set(index, toErrorMessage(error));
          } finally {
            this.resolveDelivery(state);
          }
          return;
        }
        if (action.message.type !== "voice") return;
        try {
          const generated = await state.voicePromise;
          if (generated) voiceMedia.set(index, generated);
        } catch (error) {
          state.ttsError = toErrorMessage(error);
          await state.revealPromise;
          this.appPush.pushToUser(this.input.ownerUserId, {
            type: "message.audio.failed",
            messageId: state.id,
            conversationId: this.input.conversationId,
            error: state.ttsError,
          });
        } finally {
          this.resolveDelivery(state);
        }
      }),
    );
    await this.deliveryTail;
    await Promise.all(
      [...this.actions.values()].map((state) => state.liveCacheWrite),
    );

    return {
      messageIds: new Map(
        [...this.actions]
          .filter(([, state]) => state.created)
          .map(([index, state]) => [index, state.id]),
      ),
      voiceMedia,
      imageMedia,
      imageGenerationErrors,
      messageCreatedAt: new Map(
        [...this.actions]
          .filter(([, state]) => state.createdAt !== undefined)
          .map(([index, state]) => [index, state.createdAt as number]),
      ),
      ttsErrors: new Map(
        [...this.actions]
          .filter(([, state]) => state.ttsError)
          .map(([index, state]) => [index, state.ttsError as string]),
      ),
    };
  }

  fail(error: unknown) {
    for (const state of this.actions.values()) {
      this.resolveTextComplete(state);
      this.flushTextDelta(state);
      state.tts?.abort();
      if (!state.created) continue;
      void this.failState(state, error);
    }
  }

  private getAction(index: number) {
    const existing = this.actions.get(index);
    if (existing) return existing;
    let resolveDeliveryDone!: (completedAt: number) => void;
    const deliveryDone = new Promise<number>((resolve) => {
      resolveDeliveryDone = resolve;
    });
    let resolveTextComplete!: () => void;
    const textComplete = new Promise<void>((resolve) => {
      resolveTextComplete = resolve;
    });
    const state: StreamedActionState = {
      id: `msg_${randomUUID()}`,
      typeBuffer: "",
      fields: {},
      created: false,
      revealed: false,
      deliveryDone,
      resolveDeliveryDone,
      deliveryResolved: false,
      audioSequence: 0,
      pendingAudio: [],
      referenceMediaIds: [],
      referenceMediaIdBuffer: "",
      referenceMediaIdsComplete: false,
      generationPromptComplete: false,
      pendingText: "",
      textFlushScheduled: false,
      textComplete,
      resolveTextComplete,
      textCompleteResolved: false,
      liveCacheWrite: Promise.resolve(),
    };
    this.actions.set(index, state);
    return state;
  }

  private ensureCreated(index: number, state: StreamedActionState) {
    if (state.created || !isMessageType(state.type)) return;
    state.created = true;
    const predecessor = this.deliveryTail;
    state.revealPromise = (async () => {
      const predecessorCompletedAt = await predecessor;
      if (index > 0 && isTimedMessageType(state.type)) {
        await state.textComplete;
        const elapsed = Date.now() - predecessorCompletedAt;
        const remaining =
          textMessageGapMs(state.fields[visibleField(state.type)] ?? "") -
          elapsed;
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
      if (state.type === "voice" && state.tts) {
        this.appPush.pushToUser(this.input.ownerUserId, {
          type: "message.audio.started",
          messageId: state.id,
          conversationId: this.input.conversationId,
          mimeType: "audio/mpeg",
        });
        for (const chunk of state.pendingAudio)
          this.pushAudioChunk(state, chunk);
        state.pendingAudio = [];
      }
      this.flushTextDelta(state);
    })();
    this.deliveryTail = state.deliveryDone;
  }

  private ensureTts(state: StreamedActionState) {
    if (state.tts || state.ttsError || state.type !== "voice") return;
    try {
      state.tts = this.tts.createStream((chunk) => {
        if (state.revealed) this.pushAudioChunk(state, chunk);
        else state.pendingAudio.push(chunk);
      });
    } catch (error) {
      state.ttsError = toErrorMessage(error);
      void state.revealPromise?.then(() => {
        this.appPush.pushToUser(this.input.ownerUserId, {
          type: "message.audio.failed",
          messageId: state.id,
          conversationId: this.input.conversationId,
          error: state.ttsError as string,
        });
      });
    }
  }

  private pushAudioChunk(state: StreamedActionState, chunk: Buffer) {
    this.appPush.pushToUser(this.input.ownerUserId, {
      type: "message.audio.chunk",
      messageId: state.id,
      conversationId: this.input.conversationId,
      sequence: state.audioSequence++,
      dataBase64: chunk.toString("base64"),
    });
  }

  private maybeFinishVoice(state: StreamedActionState) {
    this.ensureTts(state);
    if (state.voicePromise || !state.tts) return;
    state.voicePromise = (async () => {
      const result = await state.tts!.finish();
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
        description: state.fields.transcript ?? "",
        source: "generated",
      });
      await state.revealPromise;
      this.appPush.pushToUser(this.input.ownerUserId, {
        type: "message.audio.completed",
        messageId: state.id,
        conversationId: this.input.conversationId,
        mediaUrl: resource.publicPath,
      });
      return { resourceId: resource.id, mediaUrl: resource.publicPath };
    })();
    void state.voicePromise.catch(() => undefined);
  }

  private maybeStartImage(state: StreamedActionState) {
    if (
      state.imagePromise ||
      state.type !== "image" ||
      !state.generationPromptComplete ||
      !state.referenceMediaIdsComplete
    )
      return;
    state.imagePromise = (async () => {
      const references = await this.conversationMedia.resolveImageReferences(
        this.input.ownerUserId,
        this.input.conversationId,
        state.referenceMediaIds,
      );
      const generated = await this.imageGeneration.generate({
        prompt: state.fields.generationPrompt ?? "",
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
      };
    })();
    void state.imagePromise.catch(() => undefined);
  }

  private async completeTextDelivery(state: StreamedActionState) {
    await state.revealPromise;
    this.flushTextDelta(state);
    this.resolveDelivery(state);
  }

  private resolveDelivery(state: StreamedActionState) {
    if (state.deliveryResolved) return;
    state.deliveryResolved = true;
    state.resolveDeliveryDone(Date.now());
  }

  private resolveTextComplete(state: StreamedActionState) {
    if (state.textCompleteResolved) return;
    state.textCompleteResolved = true;
    state.resolveTextComplete();
  }

  private async failState(state: StreamedActionState, error: unknown) {
    await state.revealPromise?.catch(() => undefined);
    if (!state.revealed) return;
    const now = state.createdAt ?? Date.now();
    const message = this.buildPlaceholder(state, now, "failed", {
      kind: "prime_figure_stream_error",
      error: toErrorMessage(error),
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

  private queueTextDelta(state: StreamedActionState, delta: string) {
    if (state.type === "voice") state.tts?.write(delta);
    state.pendingText += delta;
    if (state.textFlushScheduled) return;
    state.textFlushScheduled = true;
    queueMicrotask(() => this.flushTextDelta(state));
  }

  private flushTextDelta(state: StreamedActionState) {
    state.textFlushScheduled = false;
    if (!state.revealed) return;
    const delta = state.pendingText;
    if (!delta) return;
    state.pendingText = "";
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
      content: { text: state.fields[visibleField(state.type)] ?? "" },
      updatedAt,
    };
    state.liveCacheWrite = state.liveCacheWrite.then(() =>
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
      contentType: state.type ?? "text",
      content: { text: "" },
      status,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
  }
}

function isMessageType(
  value: string | undefined,
): value is "text" | "image" | "voice" {
  return value === "text" || value === "image" || value === "voice";
}

function isTimedMessageType(
  value: StreamedActionState["type"],
): value is "text" | "voice" {
  return value === "text" || value === "voice";
}

function visibleField(type: StreamedActionState["type"]) {
  return type === "voice"
    ? "transcript"
    : type === "image"
      ? "description"
      : "text";
}

function getVisibleText(message: PrimeFigureOutgoingMessage) {
  if (message.type === "text") return message.text;
  if (message.type === "image") return message.description;
  return message.transcript;
}

function append(current: string | undefined, delta: string) {
  return `${current ?? ""}${delta}`;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function textMessageGapMs(text: string) {
  const configured = Number(process.env.PRIME_TYPING_CHARS_PER_MINUTE ?? 300);
  const charactersPerMinute =
    Number.isFinite(configured) && configured > 0 ? configured : 300;
  const characterCount = Array.from(text).length;
  return Math.round((characterCount * 60_000) / charactersPerMinute);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
