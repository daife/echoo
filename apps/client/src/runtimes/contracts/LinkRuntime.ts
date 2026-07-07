export interface AuthLinkParams {
  resetToken?: string;
  verificationToken?: string;
}

export interface LinkRuntime {
  getInitialAuthLinkParams(): Promise<AuthLinkParams>;
  clearAuthLinkParams(keys: Array<keyof AuthLinkParams>): Promise<void>;
}
