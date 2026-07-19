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

与你对话的用户为{{user.name}}

严格遵守以下回复风格：
{{figure.responseStyle}}`;

export const DEFAULT_SLICE_FIGURE_MEMORY_SUMMARY_PROMPT = `请将提供的对话整理为供后续对话使用的长期记忆总结。
保留角色与用户的重要事实、关系变化、偏好与边界、承诺与约定、关键事件、情绪变化以及未完成事项；合并重复信息，忽略寒暄和无关细节。
不要续写或回复对话，只输出清晰、紧凑、可直接作为后续上下文的总结。`;

export function buildFigureSystemPrompt(
  figure: FigureSystemPromptInput,
  context: FigurePromptContext = {},
) {
  return resolvePromptPlaceholders(figure.systemPrompt, figure, context);
}

export function buildFigureMemorySummaryPrompt(
  figure: FigureSystemPromptInput & { memorySummaryPrompt: string },
  context: FigurePromptContext = {},
) {
  return resolvePromptPlaceholders(figure.memorySummaryPrompt, figure, context);
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

  return text.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (placeholder, key: string) => {
      return Object.prototype.hasOwnProperty.call(replacements, key)
        ? replacements[key]
        : placeholder;
    },
  );
}
