export interface RegisterBody {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface ForgotPasswordBody {
  email: string;
}

export interface ResetPasswordBody {
  token: string;
  password: string;
}

export interface VerifyEmailBody {
  token: string;
}
