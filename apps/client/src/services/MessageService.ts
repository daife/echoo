import type { MessageApi, ResourcesApi } from "@echoo/api-client";
import type {
  CreateMediaMessageInput,
  LocalMessage,
  Message,
} from "@echoo/shared";

/** MySQL is canonical. The client keeps only the currently visible page in React state. */
export class MessageService {
  constructor(
    private readonly api: MessageApi,
    private readonly resources?: ResourcesApi,
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
    contentType: "image" | "voice";
    blob: Blob;
    fileName: string;
  }) {
    if (!this.resources) throw new Error("媒体上传服务未配置。");
    const mimeType =
      input.contentType === "voice" ? "audio/mpeg" : "image/jpeg";
    const ticket = await this.resources.createUpload({
      kind: input.contentType === "voice" ? "end_user_voice" : "end_user_image",
      fileName: input.fileName,
      mimeType,
      byteSize: input.blob.size,
    });
    await this.resources.upload(ticket, input.blob);
    await this.resources.complete(ticket.resourceId);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const status = await this.resources.status(ticket.resourceId);
      if (status.status === "ready") return status;
      if (status.status === "failed") throw new Error("媒体处理失败。");
      await delay(250);
    }
    throw new Error("媒体处理超时，请稍后重试。");
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

function delay(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds),
  );
}

function toLocalMessage(message: Message): LocalMessage {
  return { ...message, syncStatus: "synced" };
}
