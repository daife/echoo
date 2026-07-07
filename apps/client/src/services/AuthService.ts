import type { AuthTokens } from "@echoo/shared";
import type { AuthRuntime } from "../runtimes/contracts";

export class AuthService {
  constructor(private readonly auth: AuthRuntime) {}

  saveSession(tokens: AuthTokens) {
    return this.auth.saveTokens(tokens);
  }

  signOut() {
    return this.auth.clearTokens();
  }
}
