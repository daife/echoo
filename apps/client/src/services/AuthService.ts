import type {
  AuthSession,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterResponse,
  RegisterRequest,
  ResetPasswordRequest,
  UpdateUserProfileRequest,
  VerifyEmailRequest,
} from "@echoo/shared";
import type { AuthApi } from "@echoo/api-client";
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

  async loadCurrentUser() {
    const token = await this.auth.getAccessToken();
    if (!token) return null;

    try {
      const user = await this.api.me();
      await this.storage.setSetting(currentUserKey, user);
      return user;
    } catch {
      await this.signOut();
      return null;
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
    await this.auth.clearTokens();
    await this.storage.removeSetting(currentUserKey);
  }
}
