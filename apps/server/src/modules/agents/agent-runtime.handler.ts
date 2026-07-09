import type { Agent, AgentType, Message, UserProfile } from "@echoo/shared";
import type { ChatCompletionMessage } from "../ai/ai-provider.interface.js";

export interface AgentRuntimeHandler {
  readonly type: AgentType;
  buildChatMessages(agent: Agent, user: UserProfile | null, history: Message[]): ChatCompletionMessage[];
}

