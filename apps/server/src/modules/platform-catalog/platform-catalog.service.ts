import type {
  ModelRecommendationCategory,
  RuntimeConfigWarning,
} from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { environment } from "../../infra/config/environment.js";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import type {
  StoredModelEndpointConfig,
  StoredPrimeFigureRuntimeConfig,
  StoredSliceFigureRuntimeConfig,
  StoredUserRuntimeConfig,
} from "../runtime-config/runtime-config.types.js";

interface ModelRow extends RowDataPacket {
  model_id: string;
  name: string;
  description: string | null;
  input_modalities: unknown;
  output_modalities: unknown;
  pricing: unknown;
  supported_parameters: unknown;
  context_length: number | null;
  available: number;
  synced_at: number;
}

interface EndpointRow extends RowDataPacket {
  provider_slug: string;
  provider_name: string;
  pricing: unknown;
  status: number;
}

interface RecommendationRow extends ModelRow {
  category: ModelRecommendationCategory;
  service: "openrouter" | "fish_audio";
  provider_slugs: unknown;
  display_order: number;
}

type OpenRouterModel = {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, string | number | null>;
  supported_parameters?: string[];
};

export class PlatformCatalogService {
  async syncModels() {
    const payload = await openRouterFetch<{ data?: OpenRouterModel[] }>(
      "/models?output_modalities=all",
    );
    const models = (payload.data ?? []).filter(
      (model) => model.id && model.name,
    );
    const now = Date.now();
    await withTransaction(async (connection) => {
      await execute(
        "UPDATE platform_models SET available = FALSE",
        [],
        connection,
      );
      for (const model of models) {
        await execute(
          `INSERT INTO platform_models
           (model_id, name, description, input_modalities, output_modalities,
            pricing, supported_parameters, context_length, available, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
             input_modalities = VALUES(input_modalities), output_modalities = VALUES(output_modalities),
             pricing = VALUES(pricing), supported_parameters = VALUES(supported_parameters),
             context_length = VALUES(context_length), available = TRUE, synced_at = VALUES(synced_at)`,
          [
            model.id,
            model.name,
            model.description ?? null,
            JSON.stringify(model.architecture?.input_modalities ?? []),
            JSON.stringify(model.architecture?.output_modalities ?? []),
            JSON.stringify(model.pricing ?? {}),
            JSON.stringify(model.supported_parameters ?? []),
            model.context_length ?? null,
            now,
          ],
          connection,
        );
      }
    });
    return { count: models.length, syncedAt: now };
  }

  async syncEndpoints(modelId: string) {
    const slash = modelId.indexOf("/");
    if (slash <= 0) throw new Error("OpenRouter 模型 ID 格式无效。");
    const author = encodeURIComponent(modelId.slice(0, slash));
    const slug = encodeURIComponent(modelId.slice(slash + 1));
    const payload = await openRouterFetch<{
      data?: { endpoints?: Array<Record<string, unknown>> };
    }>(`/models/${author}/${slug}/endpoints`);
    const endpoints = payload.data?.endpoints ?? [];
    const now = Date.now();
    await withTransaction(async (connection) => {
      await execute(
        "DELETE FROM platform_model_endpoints WHERE model_id = ?",
        [modelId],
        connection,
      );
      for (const endpoint of endpoints) {
        const slugValue = String(endpoint.tag ?? "").trim();
        if (!slugValue) continue;
        await execute(
          `INSERT INTO platform_model_endpoints
           (model_id, provider_slug, provider_name, pricing, status, latency_ms, throughput, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            modelId,
            slugValue,
            String(endpoint.provider_name ?? slugValue),
            JSON.stringify(endpoint.pricing ?? {}),
            Number(endpoint.status ?? 0),
            nullableNumber(endpoint.latency_last_30m),
            nullableNumber(endpoint.throughput_last_30m),
            now,
          ],
          connection,
        );
      }
    });
    return { modelId, count: endpoints.length, syncedAt: now };
  }

  async listModels(search = "", limit = 100) {
    const rows = await queryRows<ModelRow>(
      `SELECT * FROM platform_models
        WHERE (? = '' OR model_id LIKE ? OR name LIKE ?)
        ORDER BY available DESC, name ASC LIMIT ?`,
      [search, `%${search}%`, `%${search}%`, Math.min(500, Math.max(1, limit))],
    );
    return Promise.all(rows.map((row) => this.toModel(row, true)));
  }

  async getRecommendations(category: ModelRecommendationCategory) {
    const rows = await queryRows<RecommendationRow>(
      `SELECT r.category, r.service, r.provider_slugs, r.display_order,
              COALESCE(m.model_id, r.model_id) model_id,
              COALESCE(m.name, r.model_id) name, m.description,
              COALESCE(m.input_modalities, JSON_ARRAY()) input_modalities,
              COALESCE(m.output_modalities, JSON_ARRAY('audio')) output_modalities,
              COALESCE(m.pricing, JSON_OBJECT()) pricing,
              COALESCE(m.supported_parameters, JSON_ARRAY()) supported_parameters,
              m.context_length, COALESCE(m.available, TRUE) available,
              COALESCE(m.synced_at, r.updated_at) synced_at
         FROM platform_recommendations r
         LEFT JOIN platform_models m ON m.model_id = r.model_id
        WHERE r.category = ? ORDER BY r.display_order, r.model_id`,
      [category],
    );
    return Promise.all(
      rows.map(async (row) => {
        const providers = await this.providersFor(
          row.model_id,
          stringArray(row.provider_slugs),
        );
        return {
          category: row.category,
          modelId: row.model_id,
          name: row.name,
          inputModalities: stringArray(row.input_modalities),
          outputModalities: stringArray(row.output_modalities),
          pricing: objectValue(row.pricing),
          recommendedProviders: providers.map((provider) => ({
            slug: provider.provider_slug,
            name: provider.provider_name,
          })),
        };
      }),
    );
  }

  async replaceRecommendations(
    category: ModelRecommendationCategory,
    items: Array<{
      modelId: string;
      service?: "openrouter" | "fish_audio";
      providerSlugs?: string[];
    }>,
  ) {
    const now = Date.now();
    await withTransaction(async (connection) => {
      await execute(
        "DELETE FROM platform_recommendations WHERE category = ?",
        [category],
        connection,
      );
      for (const [index, item] of items.entries()) {
        await execute(
          `INSERT INTO platform_recommendations
           (category, model_id, service, provider_slugs, display_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            category,
            item.modelId.trim(),
            item.service ??
              (category === "fish_tts" ? "fish_audio" : "openrouter"),
            JSON.stringify(item.providerSlugs ?? []),
            index,
            now,
            now,
          ],
          connection,
        );
      }
    });
    return this.getRecommendations(category);
  }

  async validateUserConfig(config: StoredUserRuntimeConfig) {
    return [
      ...(await this.validateSlice(config.sliceFigure)),
      ...(await this.validatePrime(config.primeFigure)),
    ];
  }

  async validateFigureConfig(
    type: "slice-figure" | "prime-figure" | "prime-world",
    config:
      StoredSliceFigureRuntimeConfig | StoredPrimeFigureRuntimeConfig | unknown,
  ) {
    if (type === "slice-figure")
      return this.validateSlice(config as StoredSliceFigureRuntimeConfig);
    if (type === "prime-figure")
      return this.validatePrime(config as StoredPrimeFigureRuntimeConfig);
    return [];
  }

  private async validateSlice(config: StoredSliceFigureRuntimeConfig) {
    return this.validateEndpoint(
      "sliceFigure.llm",
      config.llm,
      ["text"],
      ["text"],
    );
  }

  private async validatePrime(config: StoredPrimeFigureRuntimeConfig) {
    const warnings: RuntimeConfigWarning[] = [];
    warnings.push(
      ...(await this.validateEndpoint(
        "primeFigure.decisionModel",
        config.decisionModel,
        [
          "text",
          ...(config.understanding.visual.mode === "native" ? ["image"] : []),
          ...(config.understanding.audio.mode === "native" ? ["audio"] : []),
        ],
        ["text"],
      )),
    );
    if (config.outputs.image.enabled)
      warnings.push(
        ...(await this.validateEndpoint(
          "primeFigure.outputs.image.generator",
          config.outputs.image.generator,
          ["text"],
          ["image"],
        )),
      );
    for (const [path, enabled, endpoint] of [
      [
        "primeFigure.optimization.image.model",
        config.optimization.image.enabled,
        config.optimization.image.model,
      ],
      [
        "primeFigure.optimization.voice.model",
        config.optimization.voice.enabled,
        config.optimization.voice.model,
      ],
    ] as const)
      if (enabled)
        warnings.push(
          ...(await this.validateEndpoint(path, endpoint, ["text"], ["text"])),
        );
    if (config.understanding.visual.mode === "auxiliary")
      warnings.push(
        ...(await this.validateEndpoint(
          "primeFigure.understanding.visual.model",
          config.understanding.visual.model,
          ["image"],
          ["text"],
        )),
      );
    if (config.understanding.audio.mode === "auxiliary")
      warnings.push(
        ...(await this.validateEndpoint(
          "primeFigure.understanding.audio.model",
          config.understanding.audio.model,
          ["audio"],
          ["text"],
        )),
      );
    return warnings;
  }

  private async validateEndpoint(
    path: string,
    endpoint: StoredModelEndpointConfig,
    requiredInputs: string[],
    requiredOutputs: string[],
  ) {
    if (endpoint.source !== "platform") return [];
    const row = await queryOne<ModelRow>(
      "SELECT * FROM platform_models WHERE model_id = ? AND available = TRUE",
      [endpoint.model],
    );
    if (!row)
      return [
        warning(
          path,
          "MODEL_NOT_IN_CATALOG",
          "该模型不在当前平台目录中，将在调用时交由 OpenRouter 校验。",
        ),
      ];
    const inputs = stringArray(row.input_modalities);
    const outputs = stringArray(row.output_modalities);
    const missing = [
      ...requiredInputs
        .filter((item) => !inputs.includes(item))
        .map((item) => `输入 ${item}`),
      ...requiredOutputs
        .filter((item) => !outputs.includes(item))
        .map((item) => `输出 ${item}`),
    ];
    if (missing.length)
      throw new Error(
        `模型 ${endpoint.model} 不支持当前配置所需的${missing.join("、")}能力。`,
      );
    const warnings: RuntimeConfigWarning[] = [];
    if (Date.now() - row.synced_at > 24 * 60 * 60 * 1000)
      warnings.push(
        warning(
          path,
          "MODEL_METADATA_STALE",
          "模型元数据已超过 24 小时未同步。",
        ),
      );
    if (endpoint.routingProvider) {
      const provider = await queryOne<EndpointRow>(
        `SELECT provider_slug, provider_name, pricing, status
           FROM platform_model_endpoints WHERE model_id = ? AND provider_slug = ?`,
        [endpoint.model, endpoint.routingProvider],
      );
      if (!provider)
        warnings.push(
          warning(
            path,
            "PROVIDER_UNVERIFIED",
            "手填的推理服务商未在已同步端点中找到，将由 OpenRouter 在调用时校验。",
          ),
        );
    }
    return warnings;
  }

  private async toModel(row: ModelRow, includeProviders: boolean) {
    return {
      modelId: row.model_id,
      name: row.name,
      description: row.description,
      inputModalities: stringArray(row.input_modalities),
      outputModalities: stringArray(row.output_modalities),
      pricing: objectValue(row.pricing),
      supportedParameters: stringArray(row.supported_parameters),
      contextLength: row.context_length,
      available: Boolean(row.available),
      syncedAt: row.synced_at,
      providers: includeProviders ? await this.providersFor(row.model_id) : [],
    };
  }

  private providersFor(modelId: string, selected?: string[]) {
    return queryRows<EndpointRow>(
      `SELECT provider_slug, provider_name, pricing, status
         FROM platform_model_endpoints WHERE model_id = ?
         ${selected?.length ? `AND provider_slug IN (${selected.map(() => "?").join(",")})` : ""}
        ORDER BY provider_name`,
      [modelId, ...(selected ?? [])],
    );
  }
}

async function openRouterFetch<T>(path: string): Promise<T> {
  const apiKey = environment.platformOpenRouterApiKey;
  if (!apiKey) throw new Error("PLATFORM_OPENROUTER_API_KEY 尚未配置。");
  const baseUrl = environment.platformOpenRouterBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(
      `OpenRouter 目录请求失败：${response.status} ${response.statusText}`,
    );
  return (await response.json()) as T;
}

function warning(
  path: string,
  code: RuntimeConfigWarning["code"],
  message: string,
) {
  return { path, code, message } satisfies RuntimeConfigWarning;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function objectValue(value: unknown): Record<string, string | number | null> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, string | number | null>)
    : {};
}
