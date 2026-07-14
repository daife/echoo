import { createHash } from "node:crypto";

export type PrimeModelSession =
  | "decision"
  | "visual"
  | "audio"
  | "image-generation"
  | "image-optimizer"
  | "voice-optimizer";

const SESSION_SUFFIX: Record<PrimeModelSession, string> = {
  decision: "d",
  visual: "v",
  audio: "a",
  "image-generation": "ig",
  "image-optimizer": "oi",
  "voice-optimizer": "ov",
};

export function primeModelSessionId(
  conversationId: string,
  session: PrimeModelSession,
) {
  const conversationKey = createHash("sha256")
    .update(conversationId)
    .digest("base64url")
    .slice(0, 16);
  return `pf-${conversationKey}-${SESSION_SUFFIX[session]}`;
}
