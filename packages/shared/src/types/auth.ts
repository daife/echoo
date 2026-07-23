import type { AgentResourceUpload } from "./agent.js";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  signature: string;
  isAdmin: boolean;
  emailVerifiedAt?: number;
  createdAt: number;
}

export interface UpdateUserProfileRequest {
  displayName?: string;
  signature?: string;
  /** Upload to replace, null to remove, omitted to preserve. */
  avatar?: AgentResourceUpload | null;
}

export interface AuthSession {
  user: UserProfile;
  tokens: AuthTokens;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
}

export interface RegisterResponse {
  ok: true;
  verificationToken?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  captchaId: string;
  captchaAnswer: string;
}

export interface CaptchaChallenge {
  id: string;
  question: string;
}

export interface ForgotPasswordRequest {
  email: string;
  captchaId: string;
  captchaAnswer: string;
}

export interface ForgotPasswordResponse {
  ok: true;
  resetToken?: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface VerifyEmailRequest {
  token: string;
}
