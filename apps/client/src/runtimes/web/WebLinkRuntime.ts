import type { AuthLinkParams, LinkRuntime } from "../contracts";

export class WebLinkRuntime implements LinkRuntime {
  async getInitialAuthLinkParams(): Promise<AuthLinkParams> {
    const params = new URLSearchParams(window.location.search);
    return {
      resetToken: params.get("resetToken") ?? undefined,
      verificationToken: params.get("verificationToken") ?? undefined,
    };
  }

  async clearAuthLinkParams(keys: Array<keyof AuthLinkParams>): Promise<void> {
    const url = new URL(window.location.href);
    keys.forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, "", url);
  }
}
