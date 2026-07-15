import { createHash, timingSafeEqual } from "node:crypto";
import {
  userRuntimeConfigPatchSchema,
  type ModelRecommendationCategory,
} from "@echoo/shared";
import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { environment } from "../../infra/config/environment.js";
import { queryRows } from "../../infra/database/mysql.js";
import { BillingService, formatMicroUsd } from "../billing/billing.service.js";
import { isRecommendationCategory } from "../platform-catalog/platform-catalog.controller.js";
import { PlatformCatalogService } from "../platform-catalog/platform-catalog.service.js";
import { RuntimeConfigService } from "../runtime-config/runtime-config.service.js";

interface AdminUserRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string;
  created_at: number;
  balance_micro_usd: number;
}

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

export async function registerAdminRoutes(app: FastifyInstance) {
  const billing = new BillingService();
  const catalog = new PlatformCatalogService();
  const runtimeConfigs = new RuntimeConfigService();

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

  app.get<{ Querystring: { q?: string } }>("/users", async (request, reply) => {
    if (!(await request.requireAdmin(reply))) return;
    const q = (request.query.q ?? "").trim();
    const rows = await queryRows<AdminUserRow>(
      `SELECT u.id, u.email, u.display_name, u.created_at,
              COALESCE(a.balance_micro_usd, 0) balance_micro_usd
         FROM users u LEFT JOIN billing_accounts a ON a.owner_user_id = u.id
        WHERE (? = '' OR u.email LIKE ? OR u.display_name LIKE ?)
        ORDER BY u.created_at DESC LIMIT 200`,
      [q, `%${q}%`, `%${q}%`],
    );
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      balanceUsd: formatMicroUsd(row.balance_micro_usd),
      createdAt: row.created_at,
    }));
  });

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
    return { billingMultiplier: await billing.getMultiplier() };
  });

  app.patch<{ Body: { billingMultiplier?: number } }>(
    "/settings",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      try {
        return await billing.setMultiplier(
          Number(request.body?.billingMultiplier),
        );
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

  app.get<{ Querystring: { q?: string; limit?: string } }>(
    "/models",
    async (request, reply) => {
      if (!(await request.requireAdmin(reply))) return;
      return catalog.listModels(
        request.query.q,
        Number(request.query.limit ?? 100),
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
