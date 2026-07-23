import { Brain, CirclesThreePlus, Sparkle } from "@phosphor-icons/react";
import type { AgentType } from "@echoo/shared";

export const createOptions = [
  {
    type: "prime-figure",
    label: "本初角色",
    title: "创建本初角色",
    description:
      "持续人格、长期的记忆和情绪、日程感知、支持语音、图片、表情包、转账、主动消息等。适合高度拟人。",
    icon: Brain,
  },
  {
    type: "slice-figure",
    label: "切片角色",
    title: "创建切片角色",
    description: "配置简单，自由度高，中长期消息记忆。适合新手与自创玩法。",
    icon: CirclesThreePlus,
  },
  {
    type: "prime-world",
    label: "本初世界",
    title: "创建本初世界",
    description: "世界状态、规则推进和多主体事件会走完全独立的创建与运行时流程。",
    icon: Sparkle,
  },
] satisfies Array<{
  type: AgentType;
  label: string;
  title: string;
  description: string;
  icon: typeof Brain;
}>;
