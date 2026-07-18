export interface RegisterBody {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginBody {
  email: string;
  password: string;
  captchaId: string;
  captchaAnswer: string;
}

export interface ForgotPasswordBody {
  email: string;
  captchaId: string;
  captchaAnswer: string;
}

export interface ResetPasswordBody {
  token: string;
  password: string;
}

export interface VerifyEmailBody {
  token: string;
}

export type { UpdateUserProfileRequest as UpdateUserProfileBody } from "@echoo/shared";
