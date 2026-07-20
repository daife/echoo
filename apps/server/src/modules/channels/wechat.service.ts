import type { Message } from "@echoo/shared";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { MessagingService } from "../messaging/messaging.service.js";
import { MessageRepository } from "../messaging/message.repository.js";
import { ResourceRepository } from "../resources/resource.repository.js";
import {
  ChannelBindingRepository,
  type WechatBinding,
} from "./channel-binding.repository.js";
import { wechatClient } from "./wechat.client.js";

const loginOwners = new Map<
  string,
  { ownerUserId: string; conversationId: string }
>();
const pollers = new Map<string, AbortController>();
const DELIVERY_RETRY_BASE_MS = 5_000;

function detectImage(data: Buffer) {
  if (data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return { mimeType: "image/png", extension: "png" };
  if (data.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")))
    return { mimeType: "image/jpeg", extension: "jpg" };
  if (data.subarray(8, 12).toString("ascii") === "WEBP")
    return { mimeType: "image/webp", extension: "webp" };
  throw new Error("微信图片格式不受支持");
}

export class WechatService {
  constructor(
    private readonly bindings = new ChannelBindingRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly messaging = new MessagingService(),
    private readonly messages = new MessageRepository(),
    private readonly resources = new ResourceRepository(),
    private readonly client = wechatClient,
  ) {}

  private deliveryTimer?: NodeJS.Timeout;
  private deliveryStopped = true;

  getBinding(ownerUserId: string) {
    return this.bindings.findWechat(ownerUserId);
  }

  async startLogin(ownerUserId: string, conversationId: string) {
    await this.assertFigureConversation(ownerUserId, conversationId);
    const existing = await this.bindings.findWechat(ownerUserId);
    if (existing)
      return {
        kind: "already_bound" as const,
        binding: this.publicBinding(existing),
      };
    const login = await this.client.startLogin();
    loginOwners.set(login.attemptId, { ownerUserId, conversationId });
    return { kind: "started" as const, ...login };
  }

  async pollLogin(ownerUserId: string, attemptId: string) {
    const owner = loginOwners.get(attemptId);
    if (!owner || owner.ownerUserId !== ownerUserId) return null;
    const result = await this.client.pollLogin(attemptId);
    if (result?.status === "connected" && result.account) {
      const existing = await this.bindings.findWechat(ownerUserId);
      if (!existing) {
        const binding = await this.bindings.saveConnected({
          ownerUserId,
          conversationId: owner.conversationId,
          account: result.account,
        });
        loginOwners.delete(attemptId);
        if (binding) void this.startPoller(binding);
        return {
          ...result,
          binding: binding ? this.publicBinding(binding) : undefined,
        };
      }
      return {
        ...result,
        needsRebind: existing.conversationId !== owner.conversationId,
        binding: this.publicBinding(existing),
      };
    }
    return result;
  }

  async rebind(ownerUserId: string, conversationId: string) {
    await this.assertFigureConversation(ownerUserId, conversationId);
    const existing = await this.bindings.findWechat(ownerUserId);
    if (!existing) return { kind: "not_found" as const };
    const binding = await this.bindings.saveConnected({
      ownerUserId,
      conversationId,
      account: existing.account,
    });
    if (binding) void this.startPoller(binding);
    return {
      kind: "ok" as const,
      binding: binding ? this.publicBinding(binding) : undefined,
    };
  }

  async unbind(ownerUserId: string) {
    const binding = await this.bindings.findWechat(ownerUserId);
    if (binding) pollers.get(binding.account.id)?.abort();
    await this.bindings.deleteWechat(ownerUserId);
  }

  async startExisting() {
    for (const owner of await this.listOwners()) {
      const binding = await this.bindings.findWechat(owner);
      if (binding) void this.startPoller(binding);
    }
    this.startDeliveryWorker();
  }

  stopAll() {
    for (const controller of pollers.values()) controller.abort();
    pollers.clear();
    this.deliveryStopped = true;
    if (this.deliveryTimer) clearTimeout(this.deliveryTimer);
  }

  private listOwners() {
    return this.bindings.listOwnerIds();
  }

  private async assertFigureConversation(
    ownerUserId: string,
    conversationId: string,
  ) {
    const conversation = await this.conversations.findByIdForOwner(
      ownerUserId,
      conversationId,
    );
    if (
      !conversation ||
      !["slice-figure", "prime-figure"].includes(conversation.type)
    )
      throw new Error("只能绑定角色会话。");
  }

  private async startPoller(binding: WechatBinding) {
    if (
      pollers.has(binding.account.id) ||
      !(await this.bindings.claim(binding.account.id))
    )
      return;
    const controller = new AbortController();
    pollers.set(binding.account.id, controller);
    void (async () => {
      let cursor = binding.account.syncBuf ?? "";
      try {
        while (!controller.signal.aborted) {
          const response = await this.client.getUpdates(
            binding.account,
            cursor,
            controller.signal,
          );
          await this.bindings.renewLease(binding.account.id);
          for (const message of response.msgs ?? []) {
            const current =
              (await this.bindings.findByAccount(binding.account.id)) ??
              binding;
            await this.handleInbound(current, message);
          }
          if (response.get_updates_buf) {
            cursor = response.get_updates_buf;
            await this.bindings.updateCursor(binding.account.id, cursor);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted)
          await this.bindings.setStatus(
            binding.account.id,
            "error",
            String(error),
          );
      } finally {
        pollers.delete(binding.account.id);
      }
    })();
  }

  private async handleInbound(binding: WechatBinding, payload: any) {
    const messageId = payload?.message_id ?? payload?.client_id ?? payload?.seq;
    if (messageId === undefined || messageId === null || messageId === "") {
      console.warn("忽略缺少稳定 ID 的微信入站消息", {
        bindingId: binding.id,
        fromUserId: payload?.from_user_id,
      });
      return;
    }
    if (
      !binding.account.externalUserId ||
      payload?.from_user_id !== binding.account.externalUserId
    ) {
      console.warn("忽略非绑定用户的微信入站消息", {
        bindingId: binding.id,
        messageId,
        fromUserId: payload?.from_user_id,
      });
      return;
    }
    const clientMessageId = `wechat:${messageId}`;
    const text = (payload.item_list ?? []).find((item: any) => item.type === 1)
      ?.text_item?.text;
    if (typeof text === "string" && text.trim()) {
      await this.messaging.createUserTextMessage({
        ownerUserId: binding.ownerUserId,
        conversationId: binding.conversationId,
        text: text.trim(),
        clientMessageId,
      });
      return;
    }
    const image = (payload.item_list ?? []).find(
      (item: any) => item.type === 2 && item.image_item?.media,
    );
    if (image) {
      const data = await this.client.downloadImage(binding.account, image);
      const detected = detectImage(data);
      await this.messaging.createUserMediaMessage({
        ownerUserId: binding.ownerUserId,
        conversationId: binding.conversationId,
        contentType: "image",
        upload: {
          fileName: `wechat-${messageId}.${detected.extension}`,
          mimeType: detected.mimeType,
          dataBase64: data.toString("base64"),
        },
        clientMessageId,
      });
    } else
      console.warn("忽略不支持的微信入站消息", {
        bindingId: binding.id,
        messageId,
        itemTypes: payload.item_list?.map((item: any) => item.type),
      });
  }

  private publicBinding(binding: WechatBinding) {
    return {
      id: binding.id,
      interfaceType: binding.interfaceType,
      conversationId: binding.conversationId,
      displayName: binding.displayName,
      externalAccountId: binding.externalAccountId,
      enabled: binding.enabled,
      status: binding.status,
      boundAt: binding.boundAt,
      createdAt: binding.createdAt,
    };
  }

  async deliver(message: Message) {
    if (
      message.role !== "assistant" ||
      (message.contentType !== "text" && message.contentType !== "image")
    )
      return;
    const binding = await this.bindings.findByConversation(
      message.conversationId,
    );
    if (!binding?.account.externalUserId) return;
    if (!(await this.bindings.createDeliveryTask(binding.id, message.id)))
      return;
    await this.sendDelivery(binding, message, 0);
  }

  private async sendDelivery(
    binding: WechatBinding,
    message: Message,
    attempts: number,
  ) {
    try {
      if (message.contentType === "text" && message.content.text) {
        await this.client.sendText(
          binding.account,
          binding.account.externalUserId!,
          message.content.text,
          message.id,
        );
      } else if (
        message.contentType === "image" &&
        message.content.resourceId
      ) {
        const resource = await this.resources.readForOwner(
          binding.ownerUserId,
          message.content.resourceId,
        );
        if (!resource) throw new Error("微信投递图片资源不存在");
        await this.client.sendImage(
          binding.account,
          binding.account.externalUserId!,
          resource.data,
          message.id,
        );
      } else {
        await this.bindings.finishDelivery(binding.id, message.id);
        return;
      }
      await this.bindings.finishDelivery(binding.id, message.id);
    } catch (error) {
      const delay = DELIVERY_RETRY_BASE_MS * 2 ** Math.min(attempts, 5);
      await this.bindings.finishDelivery(
        binding.id,
        message.id,
        String(error),
        Date.now() + delay,
      );
    }
  }

  private startDeliveryWorker() {
    if (!this.deliveryStopped) return;
    this.deliveryStopped = false;
    const run = async () => {
      if (this.deliveryStopped) return;
      try {
        await this.processDeliveryBatch();
      } catch (error) {
        console.error("微信投递恢复任务失败", error);
      } finally {
        if (!this.deliveryStopped) this.deliveryTimer = setTimeout(run, 2_000);
      }
    };
    void run();
  }

  private async processDeliveryBatch() {
    const tasks = await this.bindings.listDueDeliveries();
    for (const task of tasks) {
      if (!(await this.bindings.claimDelivery(task.id))) continue;
      const binding = await this.bindings.findById(task.binding_id);
      if (!binding?.account.externalUserId) continue;
      const message = await this.messages.findByIdInConversation(
        binding.ownerUserId,
        binding.conversationId,
        task.message_id,
      );
      if (message)
        await this.sendDelivery(binding, message, Number(task.attempts));
    }
  }
}
