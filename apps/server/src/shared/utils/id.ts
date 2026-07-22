import { randomUUID } from "node:crypto";

export type EntityPrefix =
  | "user"
  | "agent"
  | "conv"
  | "msg"
  | "res"
  | "pmem"
  | "wake"
  | "asset"
  | "aver"
  | "inst"
  | "post"
  | "comment"
  | "pwe"
  | "pwr"
  | "pwh"
  | "pws"
  | "pwt";

export function createId(prefix: EntityPrefix) {
  return `${prefix}_${randomUUID()}`;
}
