export type PromotionPlatform = "douyin" | "bilibili" | "xiaohongshu";

export interface RewardSettingsView {
  invitation: {
    inviterRewardUsd: string;
    inviteeRewardUsd: string;
    enabled: boolean;
  };
  promotion: {
    minimumLikes: number;
    usdPerLike: string;
    maxRewardUsd: string;
    enabled: boolean;
    requiredTag: "echoo";
  };
  creator: {
    rewardPercent: 1;
  };
}

export interface PromotionBindingView {
  id: string;
  platform: PromotionPlatform;
  workType: string;
  externalContentId: string;
  sourceUrl: string;
  initialLikeCount: number;
  lastCheckedLikeCount?: number;
  settledLikeCount?: number;
  settledRewardUsd?: string;
  status: "bound" | "settled";
  createdAt: number;
  settledAt?: number;
}

export interface RewardCenterView {
  invitation: RewardSettingsView["invitation"] & {
    code: string;
    hasRedeemed: boolean;
  };
  promotion: RewardSettingsView["promotion"] & {
    bindings: PromotionBindingView[];
  };
  creator: RewardSettingsView["creator"] & {
    earnedUsd: string;
  };
}

export interface PromotionQuoteView {
  quoteId: string;
  bindingId: string;
  likeCount: number;
  rewardUsd: string;
  expiresAt: number;
}

export interface AdminRewardSettingsRequest {
  invitation?: {
    inviterRewardUsd: string;
    inviteeRewardUsd: string;
  };
  promotion?: {
    minimumLikes: number;
    usdPerLike: string;
    maxRewardUsd: string;
  };
}

export interface AdminPlatformSettingsView extends RewardSettingsView {
  billingMultiplier: number;
}
