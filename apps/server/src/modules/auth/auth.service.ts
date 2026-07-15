import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type AuthSession,
} from "@echoo/shared";
import type { FastifyInstance } from "fastify";
import { environment } from "../../infra/config/environment.js";
import { EmailService } from "./email.service.js";
import { PasswordService } from "./password.service.js";
import { accessTokenTtlMs, TokenService } from "./token.service.js";
import type {
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from "./auth.types.js";
import { toUserProfile, UserRepository } from "./user.repository.js";
import { RuntimeConfigService } from "../runtime-config/runtime-config.service.js";
import { BillingService } from "../billing/billing.service.js";

export class AuthService {
  private readonly tokenService: TokenService;
  private readonly passwordService = new PasswordService();
  private readonly emailService = new EmailService();

  constructor(
    app: FastifyInstance,
    private readonly users = new UserRepository(),
    private readonly runtimeConfigs = new RuntimeConfigService(),
    private readonly billing = new BillingService(),
  ) {
    this.tokenService = new TokenService(app);
  }

  async register(input: RegisterBody) {
    const body = registerSchema.parse(input);
    const existingUser = await this.users.findByEmail(body.email);
    if (existingUser?.emailVerifiedAt) {
      throw new AuthError("EMAIL_TAKEN", "该邮箱已注册。", 409);
    }

    const user =
      existingUser ??
      (await this.users.create({
        email: body.email,
        passwordHash: await this.passwordService.hash(body.password),
        displayName:
          body.displayName ?? body.email.split("@")[0] ?? "Echoo User",
      }));

    // Registration must never copy server-owned API keys into a user's config.
    // INSERT IGNORE preserves any config already created during an earlier attempt.
    await this.runtimeConfigs.initializeUserConfig(user.id);
    await this.billing.initializeAccount(user.id);

    const verificationToken = await this.users.createEmailVerificationToken(
      user.id,
    );
    const clientUrl = environment.clientUrl;
    const verificationUrl = `${clientUrl}/?verificationToken=${encodeURIComponent(verificationToken.token)}`;
    await this.emailService.sendVerificationEmail(
      toUserProfile(user),
      verificationUrl,
    );

    return {
      ok: true as const,
      ...(environment.production
        ? {}
        : { verificationToken: verificationToken.token }),
    };
  }

  async login(input: LoginBody): Promise<AuthSession> {
    const body = loginSchema.parse(input);
    const user = await this.users.findByEmail(body.email);
    if (
      !user ||
      !(await this.passwordService.verify(body.password, user.passwordHash))
    ) {
      throw new AuthError("INVALID_CREDENTIALS", "邮箱或密码不正确。", 401);
    }

    if (!user.emailVerifiedAt) {
      throw new AuthError("EMAIL_NOT_VERIFIED", "请先验证邮箱再登录。", 403);
    }

    return this.createSession(user.id);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AuthError("USER_NOT_FOUND", "用户不存在。", 404);
    }
    return toUserProfile(user);
  }

  async forgotPassword(input: ForgotPasswordBody) {
    const body = forgotPasswordSchema.parse(input);
    const user = await this.users.findByEmail(body.email);
    if (!user) return { ok: true as const };

    const resetToken = await this.users.createPasswordResetToken(user.id);
    const clientUrl = environment.clientUrl;
    const resetUrl = `${clientUrl}/?resetToken=${encodeURIComponent(resetToken.token)}`;
    await this.emailService.sendPasswordResetEmail(
      toUserProfile(user),
      resetUrl,
    );

    return {
      ok: true as const,
      ...(environment.production ? {} : { resetToken: resetToken.token }),
    };
  }

  async resetPassword(input: ResetPasswordBody) {
    const body = resetPasswordSchema.parse(input);
    const resetToken = await this.users.findPasswordResetToken(body.token);
    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt <= Date.now()
    ) {
      throw new AuthError(
        "RESET_TOKEN_INVALID",
        "该重置链接无效或已过期。",
        400,
      );
    }

    const passwordHash = await this.passwordService.hash(body.password);
    await this.users.updatePassword(resetToken.userId, passwordHash);
    await this.users.markPasswordResetTokenUsed(body.token);
    return { ok: true as const };
  }

  async verifyEmail(input: VerifyEmailBody) {
    const body = verifyEmailSchema.parse(input);
    const verificationToken = await this.users.findEmailVerificationToken(
      body.token,
    );
    if (
      !verificationToken ||
      verificationToken.usedAt ||
      verificationToken.expiresAt <= Date.now()
    ) {
      throw new AuthError(
        "VERIFICATION_TOKEN_INVALID",
        "该验证链接无效或已过期。",
        400,
      );
    }

    await this.users.markEmailVerified(verificationToken.userId);
    await this.users.markEmailVerificationTokenUsed(body.token);
    return { ok: true as const };
  }

  private async createSession(userId: string): Promise<AuthSession> {
    const user = await this.users.findById(userId);
    if (!user) throw new AuthError("USER_NOT_FOUND", "用户不存在。", 404);

    return {
      user: toUserProfile(user),
      tokens: {
        accessToken: this.tokenService.createAccessToken(userId),
        refreshToken: this.tokenService.createRefreshToken(userId),
        expiresAt: Date.now() + accessTokenTtlMs,
      },
    };
  }
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
