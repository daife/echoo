import type { RewardsApi } from "@echoo/api-client";

export class RewardsService {
  constructor(private readonly api: RewardsApi) {}

  getCenter() {
    return this.api.getCenter();
  }

  redeemInviteCode(code: string) {
    return this.api.redeemInviteCode(code);
  }

  bindPromotion(shareText: string) {
    return this.api.bindPromotion(shareText);
  }

  quotePromotion(bindingId: string) {
    return this.api.quotePromotion(bindingId);
  }

  settlePromotion(bindingId: string, quoteId: string) {
    return this.api.settlePromotion(bindingId, quoteId);
  }
}
