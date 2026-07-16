import { createHash } from "node:crypto";

export type ModelSessionRole =
  | "decision"
  | "visual"
  | "audio"
  | "image-generation"
  | "image-optimizer"
  | "voice-optimizer";

const SESSION_SUFFIX: Record<ModelSessionRole, string> = {
  decision: "d",
  visual: "v",
  audio: "a",
  "image-generation": "ig",
  "image-optimizer": "oi",
  "voice-optimizer": "ov",
};

export function modelSessionId(conversationId: string, role: ModelSessionRole) {
  const conversationKey = createHash("sha256")
    .update(conversationId)
    .digest("base64url")
    .slice(0, 16);
  return `pf-${conversationKey}-${SESSION_SUFFIX[role]}`;
}
