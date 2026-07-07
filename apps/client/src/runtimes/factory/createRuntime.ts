import type { RuntimeBundle } from "./RuntimeBundle";
import { detectPlatform } from "./detectPlatform";
import { createTauriRuntime } from "../tauri/createTauriRuntime";
import { createWebRuntime } from "../web/createWebRuntime";

export async function createRuntime(): Promise<RuntimeBundle> {
  if (detectPlatform() === "tauri") {
    return createTauriRuntime();
  }

  return createWebRuntime();
}
