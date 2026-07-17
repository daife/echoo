import type { MessageApi, ResourcesApi } from "@echoo/api-client";
import type {
  CreateMediaMessageInput,
  LocalMessage,
  Message,
} from "@echoo/shared";
import type { MessageRuntime } from "../runtimes/contracts";

/** MySQL is canonical. The client keeps only the currently visible page in React state. */
export class MessageService {
  constructor(
    private readonly api: MessageApi,
    private readonly resources?: ResourcesApi,
    private readonly runtime?: MessageRuntime,
  ) {}
  async loadLatestConversationMessages(conversationId: string, limit = 50) {
    const page = await this.api.listConversationMessages(conversationId, {
      limit,
    });
    return { ...page, items: page.items.map(toLocalMessage) };
  }
  async loadOlderConversationMessages(
    conversationId: string,
    before: string,
    limit = 50,
  ) {
    const page = await this.api.listConversationMessages(conversationId, {
      before,
      limit,
    });
    return { ...page, items: page.items.map(toLocalMessage) };
  }
  async loadNewerConversationMessages(
    conversationId: string,
    after: string,
    limit = 50,
  ) {
    const page = await this.api.listConversationMessages(conversationId, {
      after,
      limit,
    });
    return { ...page, items: page.items.map(toLocalMessage) };
  }
  sendTextMessage(input: {
    conversationId: string;
    text: string;
    clientMessageId?: string;
  }) {
    return this.api.createTextMessage(input);
  }
  sendMediaMessage(input: CreateMediaMessageInput) {
    return this.api.createMediaMessage(input);
  }
  async uploadMedia(input: {
    contentType: "image" | "voice" | "video";
    blob: Blob;
    fileName: string;
  }) {
    if (!this.resources) throw new Error("媒体上传服务未配置。");
    const mimeType =
      input.contentType === "voice"
        ? "audio/mpeg"
        : input.contentType === "video"
          ? normalizeVideoMimeType(input.blob.type)
          : "image/jpeg";
    const ticket = await this.resources.createUpload({
      kind:
        input.contentType === "voice"
          ? "end_user_voice"
          : input.contentType === "video"
            ? "end_user_video"
            : "end_user_image",
      fileName: input.fileName,
      mimeType,
      byteSize: input.blob.size,
    });
    await this.resources.upload(ticket, input.blob);
    await this.resources.complete(ticket.resourceId);
    if (this.runtime?.getSyncStatus() === "live") {
      const pushed = await this.waitForResource(ticket.resourceId, 30_000);
      if (pushed?.status === "ready") return pushed;
      if (pushed?.status === "failed") throw new Error("媒体处理失败。");
    }
    const fallbackDelays = [1_000, 2_000, 4_000, 8_000];
    for (const fallbackDelay of fallbackDelays) {
      await delay(fallbackDelay);
      const status = await this.resources.status(ticket.resourceId);
      if (status.status === "ready") return status;
      if (status.status === "failed") throw new Error("媒体处理失败。");
    }
    throw new Error("媒体处理超时，请稍后重试。");
  }

  private waitForResource(resourceId: string, timeoutMs: number) {
    if (!this.runtime) return Promise.resolve(null);
    return new Promise<import("@echoo/shared").MediaResourceStatus | null>(
      (resolve) => {
        let settled = false;
        const finish = (
          value: import("@echoo/shared").MediaResourceStatus | null,
        ) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          unsubscribe();
          resolve(value);
        };
        const unsubscribe = this.runtime!.onSyncChange((change) => {
          if (
            change.entityType !== "resource" ||
            change.entityId !== resourceId ||
            change.entity?.entityType !== "resource"
          )
            return;
          if (
            change.entity.value.status === "ready" ||
            change.entity.value.status === "failed"
          )
            finish(change.entity.value);
        });
        const timer = window.setTimeout(() => finish(null), timeoutMs);
      },
    );
  }
  resolveTransfer(input: import("@echoo/shared").ResolveTransferInput) {
    return this.api.resolveTransfer(input);
  }
  triggerPrimeFigureHint(conversationId: string, instruction: string) {
    return this.api.triggerPrimeFigureHint(conversationId, instruction);
  }
  markRead(messageId: string) {
    return this.api.markRead(messageId, Date.now());
  }
  deleteConversation(conversationId: string) {
    return this.api.deleteConversation(conversationId);
  }
  rollbackConversation(conversationId: string, messageId: string) {
    return this.api.rollbackConversation(conversationId, messageId);
  }
  updateAssistantMessage(
    conversationId: string,
    messageId: string,
    text: string,
  ) {
    return this.api.updateAssistantMessage(conversationId, messageId, text);
  }
}

function normalizeVideoMimeType(value: string) {
  if (
    value === "video/mp4" ||
    value === "video/webm" ||
    value === "video/quicktime" ||
    value === "video/mov" ||
    value === "video/mpeg"
  )
    return value;
  throw new Error("不支持的视频格式。");
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds),
  );
}

function toLocalMessage(message: Message): LocalMessage {
  return { ...message, syncStatus: "synced" };
}
