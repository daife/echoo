export interface FigureSystemPromptInput {
  systemPrompt: string;
  persona?: string;
  background?: string;
  personality?: string;
  responseStyle?: string;
  currentSituation?: string;
}

export interface FigurePromptContext {
  user?: { displayName: string } | null;
}

export const DEFAULT_SLICE_FIGURE_SYSTEM_PROMPT = `你的人设：
{{figure.persona}}

你的背景：
{{figure.background}}

你的性格：
{{figure.personality}}

严格遵守以下回复风格：
{{figure.responseStyle}}`;

export function buildFigureSystemPrompt(figure: FigureSystemPromptInput, context: FigurePromptContext = {}) {
  return resolvePromptPlaceholders(figure.systemPrompt, figure, context);
}

function resolvePromptPlaceholders(
  value: string | undefined,
  figure: FigureSystemPromptInput,
  context: FigurePromptContext,
) {
  const text = value?.trim() ?? "";
  if (!text) return "";

  const user = context.user;
  const replacements: Record<string, string> = {
    "user.name": user?.displayName ?? "",
    "figure.persona": figure.persona?.trim() ?? "",
    "figure.background": figure.background?.trim() ?? "",
    "figure.personality": figure.personality?.trim() ?? "",
    "figure.responseStyle": figure.responseStyle?.trim() ?? "",
    "figure.currentSituation": figure.currentSituation?.trim() ?? "",
  };

  return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (placeholder, key: string) => {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : placeholder;
  });
}
