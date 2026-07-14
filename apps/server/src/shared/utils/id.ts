import { randomUUID } from "node:crypto";

export type EntityPrefix =
  "user" | "agent" | "conv" | "msg" | "res" | "pmem" | "wake";

export function createId(prefix: EntityPrefix) {
  return `${prefix}_${randomUUID()}`;
}
