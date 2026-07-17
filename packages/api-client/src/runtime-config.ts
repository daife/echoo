import type {
  ConversationRuntimeConfigPatchRequest,
  ConversationRuntimeConfigResponse,
  UserRuntimeConfigPatch,
  UserRuntimeConfigView,
  WalletView,
  ModelRecommendationCategory,
  RecommendedModelView,
} from "@echoo/shared";
import type { ApiClient } from "./client";

export class RuntimeConfigApi {
  constructor(private readonly client: ApiClient) {}

  getUserConfig(): Promise<UserRuntimeConfigView> {
    return this.client.get("/users/me/runtime-config");
  }

  updateUserConfig(
    patch: UserRuntimeConfigPatch,
  ): Promise<UserRuntimeConfigView> {
    return this.client.patch("/users/me/runtime-config", patch);
  }

  getConversationConfig(
    conversationId: string,
  ): Promise<ConversationRuntimeConfigResponse> {
    return this.client.get(`/conversations/${conversationId}/runtime-config`);
  }

  updateConversationConfig(
    conversationId: string,
    patch: ConversationRuntimeConfigPatchRequest,
  ): Promise<ConversationRuntimeConfigResponse> {
    return this.client.patch(
      `/conversations/${conversationId}/runtime-config`,
      patch,
    );
  }

  getWallet(): Promise<WalletView> {
    return this.client.get("/users/me/wallet");
  }

  getRecommendations(
    category: ModelRecommendationCategory,
  ): Promise<RecommendedModelView[]> {
    return this.client.get(
      `/platform/recommendations?category=${encodeURIComponent(category)}`,
    );
  }
}
