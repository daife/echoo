import { ApiClient, MessageApi } from "@echoo/api-client";
import { MessageService } from "../../services/MessageService";
import type { RuntimeBundle } from "../../runtimes/factory/RuntimeBundle";

export function initApp(runtime: RuntimeBundle) {
  const api = new ApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api",
    getAccessToken: runtime.auth.getAccessToken
  });

  return {
    messageService: new MessageService(new MessageApi(api), runtime.storage)
  };
}
