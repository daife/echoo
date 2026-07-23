import { createHash, timingSafeEqual } from "node:crypto";
import {
  primeFigureRuntimeConfigPatchSchema,
  sliceFigureRuntimeConfigPatchSchema,
  userRuntimeConfigPatchSchema,
  type ModelRecommendationCategory,
} from "@echoo/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { environment } from "../../infra/config/environment.js";
import { BillingService } from "../billing/billing.service.js";
import { isRecommendationCategory } from "../platform-catalog/platform-catalog.controller.js";
import { PlatformCatalogService } from "../platform-catalog/platform-catalog.service.js";
import { RuntimeConfigService } from "../runtime-config/runtime-config.service.js";
import { PlatformSettingsService } from "../platform-settings/platform-settings.service.js";
import { RechargeService } from "../payments/recharge.service.js";
import {
  AdminAccountService,
  InvalidAccountFlagsError,
} from "./admin-account.service.js";

const adjustmentSchema = z.object({
  amountUsd: z.string().trim().min(1).max(40),
  note: z.string().trim().min(1).max(500),
});

const recommendationsSchema = z.object({
  items: z
    .array(
      z.object({
        modelId: z.string().trim().min(1).max(255),
        service: z.enum(["openrouter", "fish_audio"]).optional(),
        providerSlugs: z
          .array(z.string().trim().min(1).max(160))
          .max(50)
          .optional(),
      }),
    )
    .max(100),
});

const presetNameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const accountFlagsSchema = z
  .object({
    isAdmin: z.boolean().optional(),
    isDefaultFollow: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.isAdmin !== undefined || value.isDefaultFollow !== undefined,
    "至少需要提供一个账号标记。",
  );

const adminSettingsSchema = z.object({
  billingMultiplier: z.number().optional(),
  usdToCnyRate: z.string().trim().min(1).max(40).optional(),
  newUserInitialCreditUsd: z.string().trim().min(1).max(40).optional(),
  invitation: z
    .object({
      inviterRewardUsd: z.string().trim().min(1).max(40),
      inviteeRewardUsd: z.string().trim().min(1).max(40),
    })
    .optional(),
  promotion: z
    .object({
      minimumLikes: z.number().int().nonnegative(),
      usdPerLike: z.string().trim().min(1).max(40),
      maxRewardUsd: z.string().trim().min(1).max(40),
    })
    .optional(),
});

export async function registerAdminRoutes(app: FastifyInstance) {
  const billing = new BillingService();
  const catalog = new PlatformCatalogService();
  const runtimeConfigs = new RuntimeConfigService();
  const platformSettings = new PlatformSettingsService();
  const recharge = new RechargeService({ settings: platformSettings });
  const adminAccounts = new AdminAccountService();

  app.post<{ Body: { password?: string } }>(
    "/login",
    async (request, reply) => {
      const configured = environment.adminPassword;
      if (!configured)
        return reply
          .code(503)
          .send({ error: "ADMIN_DISABLED", message: "管理员后台尚未配置。" });
      if (!safeEqual(request.body?.password ?? "", configured))
        return reply.code(401).send({
          error: "INVALID_ADMIN_PASSWORD",
          message: "管理员密码错误。",
        });
      return {
        accessToken: app.jwt.sign(
          { sub: "admin", type: "admin" },
          { expiresIn: "8h" },
        ),
        expiresInSeconds: 8 * 60 * 60,
      };
    },
  );

  app.get<{ Querystring: { q?: string; role?: string } }>(
    "/users",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      if (request.query.role && request.query.role !== "admin")
        return reply.code(400).send({
          error: "INVALID_USER_ROLE_FILTER",
          message: "用户角色筛选无效。",
        });
      return adminAccounts.listUsers({
        query: request.query.q,
        adminsOnly: request.query.role === "admin",
      });
    },
  );

  app.patch<{ Params: { userId: string }; Body: unknown }>(
    "/users/:userId/account-flags",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      try {
        const result = await adminAccounts.updateAccountFlags(
          request.params.userId,
          accountFlagsSchema.parse(request.body),
        );
        if (!result)
          return reply
            .code(404)
            .send({ error: "USER_NOT_FOUND", message: "用户不存在。" });
        return result;
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof InvalidAccountFlagsError
              ? "INVALID_ACCOUNT_FLAGS"
              : "INVALID_ACCOUNT_FLAGS_REQUEST",
          message: errorMessage(error),
        });
      }
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/users/:userId/wallet",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      return billing.getWallet(request.params.userId);
    },
  );

  app.post<{ Params: { userId: string }; Body: unknown }>(
    "/users/:userId/balance-adjustments",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      try {
        return await billing.adjustBalance({
          ownerUserId: request.params.userId,
          ...adjustmentSchema.parse(request.body),
        });
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "INVALID_ADJUSTMENT", message: errorMessage(error) });
      }
    },
  );

  app.get("/settings", async (request, reply) => {
    if (!(await request.requireAdmin(reply))) return;
    return {
      billingMultiplier: await billing.getMultiplier(),
      recharge: {
        usdToCnyRate: await platformSettings.getUsdToCnyRate(),
        paymentConfigured: recharge.isPaymentConfigured(),
      },
      ...(await platformSettings.getRewardSettings()),
    };
  });

  app.patch<{ Body: unknown }>(
    "/settings",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      try {
        const body = adminSettingsSchema.parse(request.body);
        if (body.billingMultiplier !== undefined)
          await billing.setMultiplier(body.billingMultiplier);
        if (body.usdToCnyRate !== undefined)
          await platformSettings.setUsdToCnyRate(body.usdToCnyRate);
        if (
          body.newUserInitialCreditUsd !== undefined ||
          body.invitation ||
          body.promotion
        )
          await platformSettings.setRewardSettings({
            ...(body.newUserInitialCreditUsd !== undefined
              ? { newUserInitialCreditUsd: body.newUserInitialCreditUsd }
              : {}),
            ...(body.invitation ? { invitation: body.invitation } : {}),
            ...(body.promotion ? { promotion: body.promotion } : {}),
          });
        return {
          billingMultiplier: await billing.getMultiplier(),
          recharge: {
            usdToCnyRate: await platformSettings.getUsdToCnyRate(),
            paymentConfigured: recharge.isPaymentConfigured(),
          },
          ...(await platformSettings.getRewardSettings()),
        };
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "INVALID_SETTINGS", message: errorMessage(error) });
      }
    },
  );

  app.get("/runtime-defaults", async (request, reply) => {
    if (!(await request.requireAdmin(reply))) return;
    return runtimeConfigs.getAdminRuntimeDefaults();
  });

  app.patch<{ Body: unknown }>("/runtime-defaults", async (request, reply) => {
    if (!(await request.requireAdmin(reply))) return;
    try {
      return await runtimeConfigs.updateAdminRuntimeDefaults(
        userRuntimeConfigPatchSchema.parse(request.body),
      );
    } catch (error) {
      return reply.code(400).send({
        error: "INVALID_RUNTIME_DEFAULTS",
        message: errorMessage(error),
      });
    }
  });

  app.post<{ Params: { type: string }; Body: unknown }>(
    "/runtime-presets/:type",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      try {
        const type = parsePresetType(request.params.type);
        const body = presetNameSchema.parse(request.body);
        return await runtimeConfigs.createAdminRuntimePreset(type, body.name);
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_RUNTIME_PRESET",
          message: errorMessage(error),
        });
      }
    },
  );

  app.patch<{
    Params: { type: string; presetId: string };
    Body: unknown;
  }>("/runtime-presets/:type/:presetId", async (request, reply) => {
    if (!(await request.requireAdmin(reply))) return;
    try {
      const type = parsePresetType(request.params.type);
      const base = z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          config: z.unknown().optional(),
        })
        .parse(request.body);
      const config = base.config
        ? type === "slice-figure"
          ? sliceFigureRuntimeConfigPatchSchema.parse(base.config)
          : primeFigureRuntimeConfigPatchSchema.parse(base.config)
        : undefined;
      return await runtimeConfigs.updateAdminRuntimePreset(
        type,
        request.params.presetId,
        {
          ...(base.name !== undefined ? { name: base.name } : {}),
          ...(config ? { config } : {}),
        },
      );
    } catch (error) {
      return reply.code(400).send({
        error: "INVALID_RUNTIME_PRESET",
        message: errorMessage(error),
      });
    }
  });

  app.delete<{ Params: { type: string; presetId: string } }>(
    "/runtime-presets/:type/:presetId",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      try {
        return await runtimeConfigs.deleteAdminRuntimePreset(
          parsePresetType(request.params.type),
          request.params.presetId,
        );
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_RUNTIME_PRESET",
          message: errorMessage(error),
        });
      }
    },
  );

  app.post("/openrouter/sync-models", async (request, reply) => {
    if (!(await request.requireAdmin(reply))) return;
    try {
      return await catalog.syncModels();
    } catch (error) {
      return reply.code(502).send({
        error: "OPENROUTER_SYNC_FAILED",
        message: errorMessage(error),
      });
    }
  });

  app.post<{ Body: { modelId?: string } }>(
    "/openrouter/sync-endpoints",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      try {
        return await catalog.syncEndpoints(request.body?.modelId?.trim() ?? "");
      } catch (error) {
        return reply.code(502).send({
          error: "OPENROUTER_SYNC_FAILED",
          message: errorMessage(error),
        });
      }
    },
  );

  app.get<{
    Querystring: {
      q?: string;
      limit?: string;
      category?: string;
      includeProviders?: string;
    };
  }>(
    "/models",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      const category = request.query.category;
      if (category && !isRecommendationCategory(category))
        return reply.code(400).send({
          error: "INVALID_CATEGORY",
          message: "推荐模型分类无效。",
        });
      const recommendationCategory = category as
        | ModelRecommendationCategory
        | undefined;
      return catalog.listModels(
        request.query.q,
        Number(request.query.limit ?? 100),
        recommendationCategory,
        request.query.includeProviders !== "false",
      );
    },
  );

  app.get<{ Params: { category: string } }>(
    "/recommendations/:category",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      if (!isRecommendationCategory(request.params.category))
        return reply
          .code(400)
          .send({ error: "INVALID_CATEGORY", message: "推荐模型分类无效。" });
      return catalog.getRecommendations(request.params.category);
    },
  );

  app.put<{ Params: { category: string }; Body: unknown }>(
    "/recommendations/:category",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      if (!isRecommendationCategory(request.params.category))
        return reply
          .code(400)
          .send({ error: "INVALID_CATEGORY", message: "推荐模型分类无效。" });
      try {
        const body = recommendationsSchema.parse(request.body);
        return await catalog.replaceRecommendations(
          request.params.category as ModelRecommendationCategory,
          body.items,
        );
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_RECOMMENDATIONS",
          message: errorMessage(error),
        });
      }
    },
  );
}

function safeEqual(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败。";
}

function parsePresetType(value: string): "slice-figure" | "prime-figure" {
  if (value === "slice-figure" || value === "prime-figure") return value;
  throw new Error("推荐配置类型无效。");
}
