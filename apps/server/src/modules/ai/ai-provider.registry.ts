import { OpenRouterProvider } from "./providers/openrouter.provider.js";
import type { StoredTextModelConfig } from "../runtime-config/runtime-config.types.js";

export class AiProviderRegistry {
  createProvider(config: StoredTextModelConfig) {
    return new OpenRouterProvider(config);
  }
}
