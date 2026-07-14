import type { RuntimeConfigApi } from "@echoo/api-client";
import type {
  ConversationRuntimeConfigPatchRequest,
  UserRuntimeConfigPatch,
} from "@echoo/shared";

export class RuntimeConfigService {
  constructor(private readonly api: RuntimeConfigApi) {}

  getUserConfig() {
    return this.api.getUserConfig();
  }

  updateUserConfig(patch: UserRuntimeConfigPatch) {
    return this.api.updateUserConfig(patch);
  }

  getConversationConfig(conversationId: string) {
    return this.api.getConversationConfig(conversationId);
  }

  updateConversationConfig(
    conversationId: string,
    patch: ConversationRuntimeConfigPatchRequest,
  ) {
    return this.api.updateConversationConfig(conversationId, patch);
  }
}
