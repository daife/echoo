import type {
  AuthSession,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  UpdateUserProfileRequest,
  UserProfile,
  VerifyEmailRequest,
} from "@echoo/shared";
import type { ApiClient } from "./client";

export class AuthApi {
  constructor(private readonly client: ApiClient) {}

  register(body: RegisterRequest): Promise<RegisterResponse> {
    return this.client.post<RegisterResponse>("/auth/register", body);
  }

  login(body: LoginRequest): Promise<AuthSession> {
    return this.client.post<AuthSession>("/auth/login", body);
  }

  me(): Promise<UserProfile> {
    return this.client.get<UserProfile>("/auth/me");
  }

  updateProfile(body: UpdateUserProfileRequest): Promise<UserProfile> {
    return this.client.patch<UserProfile>("/auth/me", body);
  }

  forgotPassword(body: ForgotPasswordRequest): Promise<ForgotPasswordResponse> {
    return this.client.post<ForgotPasswordResponse>(
      "/auth/password/forgot",
      body,
    );
  }

  resetPassword(body: ResetPasswordRequest): Promise<{ ok: true }> {
    return this.client.post<{ ok: true }>("/auth/password/reset", body);
  }

  verifyEmail(body: VerifyEmailRequest): Promise<{ ok: true }> {
    return this.client.post<{ ok: true }>("/auth/email/verify", body);
  }
}
