import type { Conversation } from "@echoo/shared";
import type { ApiClient } from "./client";

export interface WechatBindingView {
  id: string;
  interfaceType: "wechat";
  conversationId: string;
  displayName: string;
  externalAccountId?: string;
  enabled: boolean;
  status?: "pending" | "connected" | "paused" | "error";
  boundAt?: number;
  createdAt: number;
}

export class ChannelsApi {
  constructor(private readonly client: ApiClient) {}
  getWechatBinding(): Promise<{ binding: WechatBindingView | null }> {
    return this.client.get("/channels/wechat/binding");
  }
  startWechatLogin(
    conversationId: string,
  ): Promise<{ attemptId: string; qrcodeUrl?: string; status: string }> {
    return this.client.post("/channels/wechat/login", { conversationId });
  }
  pollWechatLogin(attemptId: string): Promise<any> {
    return this.client.get(`/channels/wechat/login/${attemptId}`);
  }
  rebindWechat(
    conversationId: string,
  ): Promise<{ binding: WechatBindingView }> {
    return this.client.post("/channels/wechat/rebind", { conversationId });
  }
  unbindWechat(): Promise<{ ok: true }> {
    return this.client.delete("/channels/wechat/binding");
  }
}
