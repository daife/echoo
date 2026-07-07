import { z } from "zod";

export const emailSchema = z.string().email().trim().toLowerCase();
export const passwordSchema = z.string().min(8).max(128);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80).optional()
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1)
});

export const forgotPasswordSchema = z.object({
  email: emailSchema
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16),
  password: passwordSchema
});

export const verifyEmailSchema = z.object({
  token: z.string().min(16)
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number()
});
