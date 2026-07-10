import { OpenRouterProvider } from "./providers/openrouter.provider.js";

export class AiProviderRegistry {
  private readonly openRouter = new OpenRouterProvider();

  getDefaultProvider() {
    return this.openRouter;
  }

  getDefaultModel() {
    return process.env.DEFAULT_TEXT_MODEL ?? "openai/gpt-4o-mini";
  }
}
