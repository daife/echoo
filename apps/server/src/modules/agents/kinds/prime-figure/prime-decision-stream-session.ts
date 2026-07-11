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
  tts?: FishAudioTtsStream;
  ttsError?: string;
  audioSequence: number;
  pendingText: string;
  textFlushScheduled: boolean;
}

export class PrimeDecisionStreamSession {
  private readonly actions = new Map<number, StreamedActionState>();

  constructor(
    private readonly input: { ownerUserId: string; conversationId: string },
    private readonly appPush = new AppPushService(),
    private readonly tts = new FishAudioTtsService(),
    private readonly resources = new ResourceRepository(),
    private readonly imageGeneration = new OpenRouterImageGenerationService(),
    private readonly conversationMedia = new PrimeConversationMediaRepository(),
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

    state.fields[event.field] = append(state.fields[event.field], event.delta);
    if (
      state.created &&
      event.delta &&
      event.field === visibleField(state.type)
    ) {
      this.queueTextDelta(state, event.delta);
    }
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
    }

    for (const state of this.actions.values()) this.flushTextDelta(state);

    await Promise.all(
      decision.actions.map(async (action, index) => {
        if (action.type !== "send_message") return;
        if (action.message.type === "image") {
          try {
            const references = this.conversationMedia.resolveImageReferences(
              this.input.ownerUserId,
              this.input.conversationId,
              action.message.referenceMediaIds,
            );
            const generated = await this.imageGeneration.generate({
              prompt: action.message.generationPrompt,
              references: references.map((reference) => {
                const resource = this.resources.readForOwner(
                  this.input.ownerUserId,
                  reference.resourceId,
                );
                if (!resource)
                  throw new Error(`参考图片资源不可读：${reference.mediaId}。`);
                return {
                  mimeType: resource.record.mimeType,
                  data: resource.data,
                };
              }),
            });
            const resource = this.resources.saveGeneratedMedia(
              this.input.ownerUserId,
              "prime_figure_image",
              generated.mimeType,
              generated.data,
            );
            const registered = this.conversationMedia.ensure({
              ownerUserId: this.input.ownerUserId,
              conversationId: this.input.conversationId,
              resourceId: resource.id,
              mediaType: "image",
              description: action.message.description,
              source: "generated",
            });
            imageMedia.set(index, {
              resourceId: resource.id,
              mediaUrl: resource.publicPath,
              mediaId: registered.mediaId,
              model: generated.model,
            });
          } catch (error) {
            imageGenerationErrors.set(index, toErrorMessage(error));
          }
          return;
        }
        if (action.message.type !== "voice") return;
        const state = this.getAction(index);
        if (!state.tts) return;
        try {
          const result = await state.tts.finish();
          const resource = this.resources.saveGeneratedMedia(
            this.input.ownerUserId,
            "prime_figure_voice",
            result.mimeType,
            result.audio,
          );
          this.conversationMedia.ensure({
            ownerUserId: this.input.ownerUserId,
            conversationId: this.input.conversationId,
            resourceId: resource.id,
            mediaType: "voice",
            description: action.message.transcript,
            source: "generated",
          });
          voiceMedia.set(index, {
            resourceId: resource.id,
            mediaUrl: resource.publicPath,
          });
          this.appPush.pushToUser(this.input.ownerUserId, {
            type: "message.audio.completed",
            messageId: state.id,
            conversationId: this.input.conversationId,
            mediaUrl: resource.publicPath,
          });
        } catch (error) {
          state.ttsError = toErrorMessage(error);
          this.appPush.pushToUser(this.input.ownerUserId, {
            type: "message.audio.failed",
            messageId: state.id,
            conversationId: this.input.conversationId,
            error: state.ttsError,
          });
        }
      }),
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
      ttsErrors: new Map(
        [...this.actions]
          .filter(([, state]) => state.ttsError)
          .map(([index, state]) => [index, state.ttsError as string]),
      ),
    };
  }

  fail(error: unknown) {
    for (const state of this.actions.values()) {
      this.flushTextDelta(state);
      state.tts?.abort();
      if (!state.created) continue;
      const now = Date.now();
      this.appPush.pushToUser(this.input.ownerUserId, {
        type: "message.completed",
        message: this.buildPlaceholder(state, now, "failed", {
          kind: "prime_figure_stream_error",
          error: toErrorMessage(error),
        }),
      });
    }
  }

  private getAction(index: number) {
    const existing = this.actions.get(index);
    if (existing) return existing;
    const state: StreamedActionState = {
      id: `msg_${randomUUID()}`,
      typeBuffer: "",
      fields: {},
      created: false,
      audioSequence: 0,
      pendingText: "",
      textFlushScheduled: false,
    };
    this.actions.set(index, state);
    return state;
  }

  private ensureCreated(index: number, state: StreamedActionState) {
    if (state.created || !isMessageType(state.type)) return;
    state.created = true;
    const now = Date.now() + index;
    this.appPush.pushToUser(this.input.ownerUserId, {
      type: "message.created",
      message: this.buildPlaceholder(state, now, "pending", {
        kind: "prime_figure",
      }),
    });
    const initial = state.fields[visibleField(state.type)] ?? "";
    if (initial) this.queueTextDelta(state, initial);

    if (state.type === "voice") {
      try {
        state.tts = this.tts.createStream((chunk) => {
          this.appPush.pushToUser(this.input.ownerUserId, {
            type: "message.audio.chunk",
            messageId: state.id,
            conversationId: this.input.conversationId,
            sequence: state.audioSequence++,
            dataBase64: chunk.toString("base64"),
          });
        });
        this.appPush.pushToUser(this.input.ownerUserId, {
          type: "message.audio.started",
          messageId: state.id,
          conversationId: this.input.conversationId,
          mimeType: "audio/mpeg",
        });
      } catch (error) {
        state.ttsError = toErrorMessage(error);
        this.appPush.pushToUser(this.input.ownerUserId, {
          type: "message.audio.failed",
          messageId: state.id,
          conversationId: this.input.conversationId,
          error: state.ttsError,
        });
      }
    }
  }

  private queueTextDelta(state: StreamedActionState, delta: string) {
    state.pendingText += delta;
    if (state.textFlushScheduled) return;
    state.textFlushScheduled = true;
    queueMicrotask(() => this.flushTextDelta(state));
  }

  private flushTextDelta(state: StreamedActionState) {
    state.textFlushScheduled = false;
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
    if (state.type === "voice") state.tts?.write(delta);
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
