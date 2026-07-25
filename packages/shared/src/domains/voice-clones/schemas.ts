import { z } from "zod";

export const createVoiceCloneSchema = z
  .object({
    name: z.string().trim().min(1, "音色名称不能为空。").max(80),
    description: z.string().trim().max(500).optional().default(""),
    sampleResourceId: z.string().trim().min(1).max(120),
    consentConfirmed: z.literal(true, {
      error: "请确认你拥有该声音或已获得明确授权。",
    }),
  })
  .strict();
