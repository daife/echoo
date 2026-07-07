import type { RuntimeBundle } from "../factory/RuntimeBundle";
import { createWebRuntime } from "../web/createWebRuntime";

export function createMockRuntime(): RuntimeBundle {
  return createWebRuntime();
}
