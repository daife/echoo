import { z } from "zod";

export const publicAssetTypeSchema = z.enum([
  "slice-figure",
  "prime-figure",
  "prime-world",
]);

export const createPublicAssetDraftSchema = z.union([
  z.object({ type: publicAssetTypeSchema }).strict(),
  z
    .object({ importFromOriginalAgentId: z.string().trim().min(1).max(120) })
    .strict(),
]);

export const installPublicAssetSchema = z.object({
  applyRecommendedRuntimeConfig: z.boolean().default(false),
  worldProgressStrategy: z
    .enum(["preserve-compatible", "reset"])
    .optional(),
});

export const savePublicAssetRecommendationSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});
