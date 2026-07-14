import type { PrimeMediaAnnotation } from "@echoo/shared";
import { primeMediaAnnotationSchema } from "@echoo/shared";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import type {
  ChatCompletionContentPart,
  ChatCompletionInput,
} from "../../../ai/ai-provider.interface.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";
import type {
  StoredPrimeFigureRuntimeConfig,
  StoredTextModelConfig,
} from "../../../runtime-config/runtime-config.types.js";
import {
  AUDIO_ANNOTATION_SYSTEM_PROMPT,
  VISUAL_ANNOTATION_SYSTEM_PROMPT,
} from "./prime-prompt-composer.js";

export interface PrimePendingMedia {
  id: string;
  messageId: string;
  type: "image" | "video" | "voice";
  resourceId: string;
}

export class PrimeMediaAnnotationService {
  constructor(
    private readonly providers = new AiProviderRegistry(),
    private readonly resources = new ResourceRepository(),
  ) {}

  async annotate(
    ownerUserId: string,
    media: PrimePendingMedia[],
    config: StoredPrimeFigureRuntimeConfig,
  ) {
    const visual = media.filter(
      (item) =>
        item.type !== "voice" &&
        config.understanding.visual.mode === "auxiliary",
    );
    const audio = media.filter(
      (item) =>
        item.type === "voice" &&
        config.understanding.audio.mode === "auxiliary",
    );
    const results = await Promise.all([
      this.annotateBatch(
        ownerUserId,
        visual,
        config.understanding.visual.model,
        VISUAL_ANNOTATION_SYSTEM_PROMPT,
      ),
      this.annotateBatch(
        ownerUserId,
        audio,
        config.understanding.audio.model,
        AUDIO_ANNOTATION_SYSTEM_PROMPT,
      ),
    ]);
    return results.flat();
  }

  private async annotateBatch(
    ownerUserId: string,
    media: PrimePendingMedia[],
    modelConfig: StoredTextModelConfig,
    systemPrompt: string,
  ): Promise<PrimeMediaAnnotation[]> {
    if (!media.length) return [];
    const provider = this.providers.createProvider(modelConfig);
    const content: ChatCompletionContentPart[] = [];
    for (const item of media) {
      content.push({
        type: "text",
        text: JSON.stringify({ mediaId: item.id, type: item.type }),
      });
      content.push(await this.rawMediaPart(ownerUserId, item));
    }
    const completion: ChatCompletionInput = {
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
      reasoningMode: "disabled",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      responseFormat: annotationResponseFormat(media),
    };
    const response = await provider.createChatCompletion(completion);
    const parsed = JSON.parse(response.text) as { annotations?: unknown[] };
    if (!Array.isArray(parsed.annotations))
      throw new Error("辅助理解模型没有返回 annotations。 ");
    const annotations = parsed.annotations.map((value) =>
      primeMediaAnnotationSchema.parse(value),
    );
    if (
      annotations.length !== media.length ||
      new Set(annotations.map((item) => item.id)).size !== media.length
    )
      throw new Error("辅助理解模型返回的媒体标注数量或 ID 不匹配。");
    return annotations;
  }

  private async rawMediaPart(
    ownerUserId: string,
    item: PrimePendingMedia,
  ): Promise<ChatCompletionContentPart> {
    const resource = await this.resources.readForOwner(
      ownerUserId,
      item.resourceId,
    );
    if (!resource)
      throw new Error(`媒体资源不存在或不属于当前用户：${item.id}。`);
    const mimeType = resource.record.mimeType;
    const base64 = resource.data.toString("base64");
    if (item.type === "image")
      return {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64}` },
      };
    if (item.type === "video")
      return {
        type: "video_url",
        video_url: { url: `data:${mimeType};base64,${base64}` },
      };
    const format = AUDIO_FORMAT_BY_MIME_TYPE.get(mimeType);
    if (!format) throw new Error(`不支持的辅助听觉 MIME 类型：${mimeType}。`);
    return { type: "input_audio", input_audio: { data: base64, format } };
  }
}

function annotationResponseFormat(media: PrimePendingMedia[]) {
  return {
    type: "json_schema",
    json_schema: {
      name: "prime_auxiliary_media_annotations",
      strict: true,
      schema: {
        type: "object",
        properties: {
          annotations: {
            type: "array",
            minItems: media.length,
            maxItems: media.length,
            items: { anyOf: media.map(annotationItemSchema) },
          },
        },
        required: ["annotations"],
        additionalProperties: false,
      },
    },
  } as const;
}

function annotationItemSchema(item: PrimePendingMedia) {
  const valueField = item.type === "voice" ? "transcript" : "description";
  return {
    type: "object",
    properties: {
      id: { const: item.id },
      type: { const: item.type },
      [valueField]: { type: "string", minLength: 1 },
    },
    required: ["id", "type", valueField],
    additionalProperties: false,
  } as const;
}

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
