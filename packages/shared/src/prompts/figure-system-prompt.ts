import type { UserProfile } from "../types/auth";

export interface FigureSystemPromptInput {
  name: string;
  persona?: string;
  background?: string;
  personality?: string;
  responseStyle?: string;
  currentSituation?: string;
}

export interface FigurePromptContext {
  user?: Pick<UserProfile, "id" | "email" | "displayName"> | null;
}

export function buildFigureSystemPrompt(figure: FigureSystemPromptInput, context: FigurePromptContext = {}) {
  const name = resolvePromptPlaceholders(figure.name, context) || "未命名 Figure";
  const currentSituation = resolvePromptPlaceholders(figure.currentSituation, context);

  return [
    `你是“${name}”。`,
    "",
    "当前情景：",
    currentSituation || "未设定。",
    "",
    "你的人设：",
    resolvePromptPlaceholders(figure.persona, context) || "未设定。",
    "",
    "你的背景：",
    resolvePromptPlaceholders(figure.background, context) || "未设定。",
    "",
    "你的性格：",
    resolvePromptPlaceholders(figure.personality, context) || "未设定。",
    "",
    "严格遵守以下回复风格：",
    resolvePromptPlaceholders(figure.responseStyle, context) || "自然、简洁、有情绪感知力。",
    "",
    "请始终以这个身份与用户自然对话，不要跳出角色。"
  ].join("\n");
}

function resolvePromptPlaceholders(value: string | undefined, context: FigurePromptContext) {
  const text = value?.trim() ?? "";
  if (!text) return "";

  const user = context.user;
  const replacements: Record<string, string> = {
    "user.id": user?.id ?? "",
    "user.email": user?.email ?? "",
    "user.displayName": user?.displayName ?? "",
    "user.name": user?.displayName ?? ""
  };

  return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (placeholder, key: string) => {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : placeholder;
  });
}
