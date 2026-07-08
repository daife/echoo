import type { AiProviderId, AiTextProvider } from "./ai-provider.interface.js";
import { OpenRouterProvider } from "./providers/openrouter.provider.js";
import { XaiProvider } from "./providers/xai.provider.js";

export class AiProviderRegistry {
  private readonly providers = new Map<AiProviderId, AiTextProvider>([
    ["openrouter", new OpenRouterProvider()],
    ["xai", new XaiProvider()]
  ]);

  getDefaultProvider() {
    return this.getProvider((process.env.DEFAULT_TEXT_PROVIDER as AiProviderId | undefined) ?? "openrouter");
  }

  getDefaultModel() {
    return process.env.DEFAULT_TEXT_MODEL ?? "openai/gpt-4o-mini";
  }

  getProvider(id: AiProviderId) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`AI provider is not registered: ${id}`);
    return provider;
  }
}
