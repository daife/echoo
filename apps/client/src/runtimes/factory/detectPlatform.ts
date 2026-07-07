export type RuntimePlatform = "web" | "tauri";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function detectPlatform(): RuntimePlatform {
  return isTauri() ? "tauri" : "web";
}
