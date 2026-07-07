import type { AuthRuntime } from "../../runtimes/contracts";

export async function initAuth(auth: AuthRuntime) {
  return auth.getAccessToken();
}
