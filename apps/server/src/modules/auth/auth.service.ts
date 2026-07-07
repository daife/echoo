import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type AuthSession
} from "@echoo/shared";
import type { FastifyInstance } from "fastify";
import { EmailService } from "./email.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import type { ForgotPasswordBody, LoginBody, RegisterBody, ResetPasswordBody, VerifyEmailBody } from "./auth.types.js";
import { toUserProfile, UserRepository } from "./user.repository.js";

export class AuthService {
  private readonly tokenService: TokenService;
  private readonly passwordService = new PasswordService();
  private readonly emailService = new EmailService();

  constructor(
    app: FastifyInstance,
    private readonly users = new UserRepository()
  ) {
    this.tokenService = new TokenService(app);
  }

  async register(input: RegisterBody) {
    const body = registerSchema.parse(input);
    const existingUser = this.users.findByEmail(body.email);
    if (existingUser?.emailVerifiedAt) {
      throw new AuthError("EMAIL_TAKEN", "This email is already registered.", 409);
    }

    const user =
      existingUser ??
      this.users.create({
        email: body.email,
        passwordHash: await this.passwordService.hash(body.password),
        displayName: body.displayName ?? body.email.split("@")[0] ?? "Echoo User"
      });

    const verificationToken = this.users.createEmailVerificationToken(user.id);
    const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
    const verificationUrl = `${clientUrl}/?verificationToken=${encodeURIComponent(verificationToken.token)}`;
    await this.emailService.sendVerificationEmail(toUserProfile(user), verificationUrl);

    return {
      ok: true as const,
      ...(process.env.NODE_ENV === "production" ? {} : { verificationToken: verificationToken.token })
    };
  }

  async login(input: LoginBody): Promise<AuthSession> {
    const body = loginSchema.parse(input);
    const user = this.users.findByEmail(body.email);
    if (!user || !(await this.passwordService.verify(body.password, user.passwordHash))) {
      throw new AuthError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
    }

    if (!user.emailVerifiedAt) {
      throw new AuthError("EMAIL_NOT_VERIFIED", "Please verify your email before signing in.", 403);
    }

    return this.createSession(user.id);
  }

  async me(userId: string) {
    const user = this.users.findById(userId);
    if (!user) {
      throw new AuthError("USER_NOT_FOUND", "User does not exist.", 404);
    }
    return toUserProfile(user);
  }

  async forgotPassword(input: ForgotPasswordBody) {
    const body = forgotPasswordSchema.parse(input);
    const user = this.users.findByEmail(body.email);
    if (!user) return { ok: true as const };

    const resetToken = this.users.createPasswordResetToken(user.id);
    const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
    const resetUrl = `${clientUrl}/?resetToken=${encodeURIComponent(resetToken.token)}`;
    await this.emailService.sendPasswordResetEmail(toUserProfile(user), resetUrl);

    return {
      ok: true as const,
      ...(process.env.NODE_ENV === "production" ? {} : { resetToken: resetToken.token })
    };
  }

  async resetPassword(input: ResetPasswordBody) {
    const body = resetPasswordSchema.parse(input);
    const resetToken = this.users.findPasswordResetToken(body.token);
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= Date.now()) {
      throw new AuthError("RESET_TOKEN_INVALID", "This reset link is invalid or expired.", 400);
    }

    const passwordHash = await this.passwordService.hash(body.password);
    this.users.updatePassword(resetToken.userId, passwordHash);
    this.users.markPasswordResetTokenUsed(body.token);
    return { ok: true as const };
  }

  async verifyEmail(input: VerifyEmailBody) {
    const body = verifyEmailSchema.parse(input);
    const verificationToken = this.users.findEmailVerificationToken(body.token);
    if (!verificationToken || verificationToken.usedAt || verificationToken.expiresAt <= Date.now()) {
      throw new AuthError("VERIFICATION_TOKEN_INVALID", "This verification link is invalid or expired.", 400);
    }

    this.users.markEmailVerified(verificationToken.userId);
    this.users.markEmailVerificationTokenUsed(body.token);
    return { ok: true as const };
  }

  private createSession(userId: string): AuthSession {
    const user = this.users.findById(userId);
    if (!user) throw new AuthError("USER_NOT_FOUND", "User does not exist.", 404);

    return {
      user: toUserProfile(user),
      tokens: {
        accessToken: this.tokenService.createAccessToken(userId),
        refreshToken: this.tokenService.createRefreshToken(userId),
        expiresAt: Date.now() + 15 * 60 * 1000
      }
    };
  }
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}
