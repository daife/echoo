import {
  AgentsApi,
  ApiClient,
  AuthApi,
  PublicAssetsApi,
  MessageApi,
  RuntimeConfigApi,
  ResourcesApi,
  PostsApi,
  SocialApi,
  UsersApi,
  RewardsApi,
  PaymentsApi,
  ChannelsApi,
  PrimeWorldApi,
  ConversationsApi,
  NotificationsApi,
} from "@echoo/api-client";
import { AgentService } from "../../services/AgentService";
import { AuthService } from "../../services/AuthService";
import { MessageService } from "../../services/MessageService";
import type { RuntimeBundle } from "../../runtimes/factory/RuntimeBundle";
import { RuntimeConfigService } from "../../services/RuntimeConfigService";
import { PublicAssetService } from "../../services/PublicAssetService";
import { SocialService } from "../../services/SocialService";
import { RewardsService } from "../../services/RewardsService";
import { RechargeService } from "../../services/RechargeService";
import { PrimeWorldService } from "../../services/PrimeWorldService";
import { ConversationService } from "../../services/ConversationService";
import { NotificationService } from "../../services/NotificationService";

export function initApp(runtime: RuntimeBundle) {
  let refreshPromise: Promise<string | null> | null = null;
  const baseUrl =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api";
  const api = new ApiClient({
    baseUrl,
    getAccessToken: () => runtime.auth.getAccessToken(),
    refreshAccessToken: () => {
      if (refreshPromise) return refreshPromise;
      refreshPromise = refreshSession(runtime, baseUrl).finally(() => {
        refreshPromise = null;
      });
      return refreshPromise;
    },
  });

  return {
    conversationService: new ConversationService(new ConversationsApi(api)),
    notificationService: new NotificationService(new NotificationsApi(api)),
    agentService: new AgentService(new AgentsApi(api)),
    primeWorldService: new PrimeWorldService(
      new PrimeWorldApi(api),
      new ResourcesApi(api),
      runtime.message,
    ),
    publicAssetService: new PublicAssetService(new PublicAssetsApi(api)),
    authService: new AuthService(
      new AuthApi(api),
      runtime.auth,
      runtime.storage,
    ),
    messageService: new MessageService(
      new MessageApi(api),
      new ResourcesApi(api),
      runtime.message,
    ),
    runtimeConfigService: new RuntimeConfigService(new RuntimeConfigApi(api)),
    rewardsService: new RewardsService(new RewardsApi(api)),
    rechargeService: new RechargeService(new PaymentsApi(api)),
    channelsApi: new ChannelsApi(api),
    socialService: new SocialService(
      new PostsApi(api),
      new UsersApi(api),
      new SocialApi(api),
      new ResourcesApi(api),
    ),
  };
}

export type AppServices = ReturnType<typeof initApp>;

async function refreshSession(runtime: RuntimeBundle, baseUrl: string) {
  const refreshToken = await runtime.auth.getRefreshToken();
  if (!refreshToken) return null;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (response.status === 401) {
    await runtime.auth.expireSession();
    return null;
  }
  if (!response.ok)
    throw new Error(`刷新登录会话失败：${response.status}`);
  const session =
    (await response.json()) as import("@echoo/shared").AuthSession;
  await runtime.auth.saveTokens(session.tokens);
  return session.tokens.accessToken;
}
