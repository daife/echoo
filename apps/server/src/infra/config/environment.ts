type StorageProvider = "local" | "s3";

function optional(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function numberValue(
  name: string,
  fallback: number,
  options: { integer?: boolean; minimum?: number } = {},
) {
  const raw = optional(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (
    !Number.isFinite(value) ||
    (options.integer && !Number.isInteger(value)) ||
    (options.minimum !== undefined && value < options.minimum)
  )
    throw new Error(`环境变量 ${name} 的值无效。`);
  return value;
}

function booleanValue(name: string, fallback: boolean) {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`环境变量 ${name} 必须是 true 或 false。`);
}

function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`生产环境必须配置 ${name}。`);
  return value;
}

export function buildEnvironment() {
  const nodeEnv = optional("NODE_ENV") ?? "development";
  const production = nodeEnv === "production";
  const storageProvider = (optional("RESOURCE_STORAGE_PROVIDER") ??
    "local") as StorageProvider;
  if (storageProvider !== "local" && storageProvider !== "s3")
    throw new Error("RESOURCE_STORAGE_PROVIDER 只能是 local 或 s3。");

  const jwtSecret = optional("JWT_SECRET");
  const mysqlUrl = optional("MYSQL_URL");
  const s3Bucket = optional("RESOURCE_S3_BUCKET");
  const s3AccessKeyId = optional("RESOURCE_S3_ACCESS_KEY_ID");
  const s3SecretAccessKey = optional("RESOURCE_S3_SECRET_ACCESS_KEY");

  if (production) {
    required("JWT_SECRET", jwtSecret);
    required("MYSQL_URL", mysqlUrl);
  }
  if (storageProvider === "s3") {
    required("RESOURCE_S3_BUCKET", s3Bucket);
    required("RESOURCE_S3_ACCESS_KEY_ID", s3AccessKeyId);
    required("RESOURCE_S3_SECRET_ACCESS_KEY", s3SecretAccessKey);
  }

  return Object.freeze({
    nodeEnv,
    production,
    serverHost: optional("SERVER_HOST") ?? "127.0.0.1",
    serverPort: numberValue("SERVER_PORT", 8787, { integer: true, minimum: 1 }),
    jwtSecret: jwtSecret ?? "dev-secret",
    clientUrl: optional("CLIENT_URL") ?? "http://localhost:5173",
    mysqlUrl: mysqlUrl ?? "mysql://echoo:echoo@127.0.0.1:3306/echoo",
    mysqlPoolSize: numberValue("MYSQL_POOL_SIZE", 20, {
      integer: true,
      minimum: 1,
    }),
    redisUrl: optional("REDIS_URL") ?? "redis://127.0.0.1:6379",
    agentRunConcurrency: numberValue("AGENT_RUN_CONCURRENCY", 8, {
      integer: true,
      minimum: 1,
    }),
    messageCacheMaxPerConversation: numberValue(
      "MESSAGE_CACHE_MAX_PER_CONVERSATION",
      200,
      { integer: true, minimum: 1 },
    ),
    messageCacheTtlMs: numberValue("MESSAGE_CACHE_TTL_MS", 6 * 60 * 60_000, {
      integer: true,
      minimum: 1,
    }),
    resourceStorageProvider: storageProvider,
    resourceStorageDir: optional("RESOURCE_STORAGE_DIR") ?? ".data/resources",
    resourceS3Endpoint: optional("RESOURCE_S3_ENDPOINT"),
    resourceS3Region: optional("RESOURCE_S3_REGION") ?? "us-east-1",
    resourceS3Bucket: s3Bucket,
    resourceS3AccessKeyId: s3AccessKeyId,
    resourceS3SecretAccessKey: s3SecretAccessKey,
    resourceS3ForcePathStyle: booleanValue(
      "RESOURCE_S3_FORCE_PATH_STYLE",
      false,
    ),
    resourceS3DirectDownloads: booleanValue(
      "RESOURCE_S3_DIRECT_DOWNLOADS",
      false,
    ),
    resendApiKey: optional("RESEND_API_KEY"),
    resendFromEmail:
      optional("RESEND_FROM_EMAIL") ?? "Echoo <onboarding@resend.dev>",
    openRouterSiteUrl:
      optional("OPENROUTER_SITE_URL") ??
      optional("CLIENT_URL") ??
      "http://localhost:5173",
    openRouterAppTitle: optional("OPENROUTER_APP_TITLE") ?? "Echoo",
    platformOpenRouterBaseUrl:
      optional("PLATFORM_OPENROUTER_BASE_URL") ??
      "https://openrouter.ai/api/v1",
    platformOpenRouterApiKey: optional("PLATFORM_OPENROUTER_API_KEY") ?? "",
    platformFishAudioHttpUrl:
      optional("PLATFORM_FISH_AUDIO_HTTP_URL") ??
      "https://api.fish.audio/v1/tts",
    platformFishAudioWsUrl:
      optional("PLATFORM_FISH_AUDIO_WS_URL") ??
      "wss://api.fish.audio/v1/tts/live",
    platformFishAudioApiKey: optional("PLATFORM_FISH_AUDIO_API_KEY") ?? "",
    adminPassword: optional("ADMIN_PASSWORD"),
    primeSilencePollMs: numberValue("PRIME_SILENCE_POLL_MS", 1_000, {
      integer: true,
      minimum: 100,
    }),
  });
}

export const environment = buildEnvironment();
