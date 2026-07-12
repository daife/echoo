import { AgentsApi, ApiClient, AuthApi, MessageApi } from "@echoo/api-client";
import { AgentService } from "../../services/AgentService";
import { AuthService } from "../../services/AuthService";
import { MessageService } from "../../services/MessageService";
import type { RuntimeBundle } from "../../runtimes/factory/RuntimeBundle";

export function initApp(runtime: RuntimeBundle) {
  const api = new ApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api",
    getAccessToken: () => runtime.auth.getAccessToken()
  });

  return {
    agentService: new AgentService(new AgentsApi(api)),
    authService: new AuthService(new AuthApi(api), runtime.auth, runtime.storage),
    messageService: new MessageService(new MessageApi(api))
  };
}
