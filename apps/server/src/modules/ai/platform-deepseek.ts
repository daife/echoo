export const PLATFORM_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export function isPlatformDeepSeekRoute(endpoint: {
  source: "platform" | "custom";
  routingProvider?: string;
}) {
  return (
    endpoint.source === "platform" &&
    endpoint.routingProvider?.trim().toLowerCase() === "deepseek"
  );
}

export function toOfficialDeepSeekModelId(model: string) {
  return model.startsWith("deepseek/")
    ? model.slice("deepseek/".length)
    : model;
}
