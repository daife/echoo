import type {
  PromotionBindingView,
  PromotionQuoteView,
  RewardCenterView,
} from "@echoo/shared";
import type { ApiClient } from "./client";

export class RewardsApi {
  constructor(private readonly client: ApiClient) {}

  getCenter(): Promise<RewardCenterView> {
    return this.client.get("/users/me/rewards");
  }

  redeemInviteCode(code: string): Promise<RewardCenterView> {
    return this.client.post("/users/me/invitations/redeem", { code });
  }

  bindPromotion(shareText: string): Promise<PromotionBindingView> {
    return this.client.post("/users/me/promotions", { shareText });
  }

  quotePromotion(bindingId: string): Promise<PromotionQuoteView> {
    return this.client.post(`/users/me/promotions/${bindingId}/quote`);
  }

  settlePromotion(
    bindingId: string,
    quoteId: string,
  ): Promise<PromotionBindingView> {
    return this.client.post(`/users/me/promotions/${bindingId}/settle`, {
      quoteId,
    });
  }
}
