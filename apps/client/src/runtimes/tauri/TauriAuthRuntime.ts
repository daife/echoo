import { WebAuthRuntime } from "../web/WebAuthRuntime";
import { tauriInvoke } from "./tauriInvoke";
import type { AuthTokens } from "@echoo/shared";

export class TauriAuthRuntime extends WebAuthRuntime {
  override async saveTokens(tokens: AuthTokens): Promise<void> {
    await super.saveTokens(tokens);
    await tauriInvoke("save_tokens_for_native", { tokens }).catch(() => undefined);
  }
}
