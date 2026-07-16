import {
  AgentsApi,
  ApiClient,
  AuthApi,
  CharacterAssetsApi,
  MessageApi,
  RuntimeConfigApi,
  ResourcesApi,
} from "@echoo/api-client";
import { AgentService } from "../../services/AgentService";
import { AuthService } from "../../services/AuthService";
import { MessageService } from "../../services/MessageService";
import type { RuntimeBundle } from "../../runtimes/factory/RuntimeBundle";
import { RuntimeConfigService } from "../../services/RuntimeConfigService";
import { CharacterAssetService } from "../../services/CharacterAssetService";

export function initApp(runtime: RuntimeBundle) {
  const api = new ApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api",
    getAccessToken: () => runtime.auth.getAccessToken(),
  });

  return {
    agentService: new AgentService(new AgentsApi(api)),
    characterAssetService: new CharacterAssetService(
      new CharacterAssetsApi(api),
    ),
    authService: new AuthService(
      new AuthApi(api),
      runtime.auth,
      runtime.storage,
    ),
    messageService: new MessageService(
      new MessageApi(api),
      new ResourcesApi(api),
    ),
    runtimeConfigService: new RuntimeConfigService(new RuntimeConfigApi(api)),
  };
}
