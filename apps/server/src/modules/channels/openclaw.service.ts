import { randomUUID } from "node:crypto";
import type { Message, MessageMediaUpload } from "@echoo/shared";
import { MessagingService } from "../messaging/messaging.service.js";
import { ChannelBindingRepository } from "./channel-binding.repository.js";
import { realtimeEventEmitter } from "../realtime/realtime-event-bus.js";

const MAX_POLLING_TIMEOUT = 35000;

export class OpenClawService {
  constructor(
    private readonly bindings = new ChannelBindingRepository(),
    private readonly messaging = new MessagingService(),
  ) {}

  async getUpdates(token: string, cursor: string) {
    const binding = await this.bindings.findByToken(token);
    if (!binding) return { errcode: -1, errmsg: "Invalid token", msgs: [] };

    const startTime = Date.now();
    let msgs: any[] = [];
    let nextCursor = cursor;

    // First try fetching immediately
    const result = await this.fetchNewMessages(binding, cursor);
    if (result.msgs.length > 0) {
      return {
        ret: 0,
        msgs: result.msgs,
        get_updates_buf: result.nextCursor,
        longpolling_timeout_ms: MAX_POLLING_TIMEOUT,
      };
    }

    // Long poll
    return new Promise((resolve) => {
      let timeoutId: NodeJS.Timeout;

      const listener = async (event: { userId: string; payload: any }) => {
        if (event.userId !== binding.ownerUserId) return;
        if (event.payload?.type !== "message.created" && event.payload?.type !== "message.updated") return;
        const msg = event.payload.message as Message;
        if (msg.conversationId !== binding.conversationId) return;

        // Message for our conversation, fetch it
        const result = await this.fetchNewMessages(binding, cursor);
        if (result.msgs.length > 0) {
          clearTimeout(timeoutId);
          realtimeEventEmitter.off("message", listener);
          resolve({
            ret: 0,
            msgs: result.msgs,
            get_updates_buf: result.nextCursor,
            longpolling_timeout_ms: MAX_POLLING_TIMEOUT,
          });
        }
      };

      realtimeEventEmitter.on("message", listener);

      timeoutId = setTimeout(() => {
        realtimeEventEmitter.off("message", listener);
        resolve({
          ret: 0,
          msgs: [],
          get_updates_buf: cursor,
          longpolling_timeout_ms: MAX_POLLING_TIMEOUT,
        });
      }, MAX_POLLING_TIMEOUT);
    });
  }

  private async fetchNewMessages(binding: any, cursor: string) {
    const msgsToReturn: any[] = [];
    let nextCursor = cursor;
    const messages = await this.messaging.listConversationMessages(
      binding.ownerUserId,
      binding.conversationId,
      { after: cursor || null, limit: 50 },
    );
    
    if (messages && messages.items.length > 0) {
      for (const msg of messages.items) {
        if (msg.role === "assistant" && msg.status === "sent") {
          msgsToReturn.push(this.mapToWeixinMessage(msg, binding));
        }
      }
      nextCursor = messages.items[messages.items.length - 1].id;
    }
    return { msgs: msgsToReturn, nextCursor };
  }

  private mapToWeixinMessage(msg: Message, binding: any) {
    const items = [];
    if (msg.contentType === "text" && msg.content.text) {
      items.push({
        type: 1,
        text_item: { text: msg.content.text },
      });
    } else if (msg.contentType === "image") {
      items.push({
        type: 2,
        image_item: {
          cdn_media: {
            encrypt_query_param: msg.content.mediaUrl, // Mock, actual integration might require actual encryption params
            aes_key: "", // Mock
          }
        }
      });
    }
    // Note: Other content types (voice, video) can be added here
    
    return {
      message_id: msg.id.substring(4, 12), // Or a proper numerical ID if required
      from_user_id: "bot",
      to_user_id: binding.channelAccountId || "user",
      create_time_ms: msg.createdAt,
      message_type: 2, // BOT
      message_state: 2, // FINISH
      item_list: items,
      context_token: msg.id, // For reply referencing
    };
  }

  async processIncomingMessage(token: string, msgPayload: any, uin: string) {
    const binding = await this.bindings.findByToken(token);
    if (!binding) return { errcode: -1, errmsg: "Invalid token" };

    // Update the channelAccountId if it changed
    if (binding.channelAccountId !== uin) {
      binding.channelAccountId = uin;
      binding.updatedAt = Date.now();
      await this.bindings.save(binding);
    }

    if (!msgPayload || !msgPayload.item_list) return { ret: 0 };

    for (const item of msgPayload.item_list) {
      if (item.type === 1 && item.text_item) {
        await this.messaging.createUserTextMessage({
          ownerUserId: binding.ownerUserId,
          conversationId: binding.conversationId,
          text: item.text_item.text,
        });
      }
      // Note: Image/Voice/Video processing requires mapping the CDN upload flow
      // which we will simplify for now unless explicitly provided.
    }

    return { ret: 0 };
  }
}
