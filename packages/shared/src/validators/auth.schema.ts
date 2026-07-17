import { z } from "zod";

export const emailSchema = z
  .string()
  .email("请输入有效的邮箱地址。")
  .trim()
  .toLowerCase();
export const passwordSchema = z
  .string()
  .min(8, "密码至少需要 8 个字符。")
  .max(128, "密码不能超过 128 个字符。");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z
    .string()
    .trim()
    .min(1, "显示名称不能为空。")
    .max(80, "显示名称不能超过 80 个字符。")
    .optional(),
});

const profileAvatarUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.literal("image/jpeg"),
  dataBase64: z.string().min(1),
});

export const updateUserProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "昵称不能为空。")
      .max(80, "昵称不能超过 80 个字符。")
      .optional(),
    signature: z
      .string()
      .trim()
      .max(160, "个性签名不能超过 160 个字符。")
      .optional(),
    avatar: profileAvatarUploadSchema.nullish(),
  })
  .strict()
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.signature !== undefined ||
      value.avatar !== undefined,
    { message: "请至少修改一项资料。" },
  );

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "密码不能为空。"),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16, "重置令牌无效。"),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(16, "验证令牌无效。"),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});
