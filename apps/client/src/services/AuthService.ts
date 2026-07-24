import type {
  AuthSession,
  CaptchaChallenge,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterResponse,
  RegisterRequest,
  ResetPasswordRequest,
  UpdateUserProfileRequest,
  VerifyEmailRequest,
} from "@echoo/shared";
import type { AuthApi } from "@echoo/api-client";
import { ApiError } from "@echoo/api-client";
import type { AuthRuntime } from "../runtimes/contracts";
import type { StorageRuntime } from "../runtimes/contracts";

const currentUserKey = "auth.currentUser";

export class AuthService {
  constructor(
    private readonly api: AuthApi,
    private readonly auth: AuthRuntime,
    private readonly storage: StorageRuntime,
  ) {}

  register(body: RegisterRequest): Promise<RegisterResponse> {
    return this.api.register(body);
  }

  getCaptchaChallenge(): Promise<CaptchaChallenge> {
    return this.api.getCaptchaChallenge();
  }

  async login(body: LoginRequest) {
    return this.saveSession(await this.api.login(body));
  }

  forgotPassword(body: ForgotPasswordRequest) {
    return this.api.forgotPassword(body);
  }

  resetPassword(body: ResetPasswordRequest) {
    return this.api.resetPassword(body);
  }

  verifyEmail(body: VerifyEmailRequest) {
    return this.api.verifyEmail(body);
  }

  async loadCurrentUser(): Promise<{
    user: Awaited<ReturnType<AuthApi["me"]>> | null;
    sessionExpired: boolean;
  }> {
    await this.auth.hydrateTokens?.();
    const token = await this.auth.getAccessToken();
    const refreshToken = await this.auth.getRefreshToken();
    if (!token && !refreshToken) return { user: null, sessionExpired: false };

    try {
      const user = await this.api.me();
      await this.storage.setSetting(currentUserKey, user);
      return { user, sessionExpired: false };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await this.auth.expireSession();
        await this.storage.removeSetting(currentUserKey);
        return { user: null, sessionExpired: true };
      }
      return { user: null, sessionExpired: false };
    }
  }

  async updateProfile(body: UpdateUserProfileRequest) {
    const user = await this.api.updateProfile(body);
    await this.storage.setSetting(currentUserKey, user);
    return user;
  }

  async saveSession(session: AuthSession) {
    await this.auth.saveTokens(session.tokens);
    await this.storage.setSetting(currentUserKey, session.user);
    return session.user;
  }

  async signOut() {
    const refreshToken = await this.auth.getRefreshToken();
    if (refreshToken)
      await this.api.logout(refreshToken).catch(() => undefined);
    await this.auth.clearTokens();
    await this.storage.removeSetting(currentUserKey);
  }
}
