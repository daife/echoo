import { buildFigureSystemPrompt } from "@echoo/shared";
import type { Agent, Message, UserProfile } from "@echoo/shared";
import type { ChatCompletionMessage } from "../../../ai/ai-provider.interface.js";
import type { AgentRuntimeHandler } from "../../agent-runtime.handler.js";

const CONTEXT_ROUND_STEP = 100;

export class SliceFigureRuntime implements AgentRuntimeHandler {
  readonly type = "slice-figure" as const;

  buildChatMessages(agent: Agent, user: UserProfile | null, history: Message[]): ChatCompletionMessage[] {
    if (agent.type !== this.type) throw new Error(`Slice Figure runtime received ${agent.type}.`);

    return [
      {
        role: "system",
        content: buildFigureSystemPrompt({ name: agent.name, ...agent.detail }, { user })
      },
      ...selectContextMessages(agent, history)
    ];
  }
}

function selectContextMessages(agent: Agent, history: Message[]): ChatCompletionMessage[] {
  const textHistory = history.filter((message) => {
    if (message.contentType !== "text") return false;
    if (message.status === "failed") return false;
    if (message.role !== "user" && message.role !== "assistant") return false;
    return Boolean(message.content.text?.trim());
  });

  const userRoundCount = textHistory.filter((message) => message.role === "user").length;
  const startRound = Math.floor(Math.max(0, userRoundCount - CONTEXT_ROUND_STEP) / CONTEXT_ROUND_STEP) * CONTEXT_ROUND_STEP;
  const hasPersistedOpeningLine = textHistory.some((message) => message.role === "assistant" && message.metadata?.kind === "opening_line");
  const selected: ChatCompletionMessage[] = [];

  if (agent.type !== "slice-figure") throw new Error(`Slice context selection received ${agent.type}.`);

  if (startRound === 0 && agent.detail.openingLine.trim() && !hasPersistedOpeningLine) {
    selected.push({ role: "assistant", content: agent.detail.openingLine.trim() });
  }

  let currentRound = 0;
  for (const message of textHistory) {
    if (message.role === "user") {
      currentRound += 1;
    }

    const shouldInclude = startRound === 0 || currentRound >= startRound;
    if (!shouldInclude) continue;

    selected.push({
      role: message.role,
      content: message.content.text?.trim() ?? ""
    });
  }

  return selected;
}
