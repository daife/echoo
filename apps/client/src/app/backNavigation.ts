export type BackHandler = () => void | Promise<void>;

export const BACK_HANDLER_PRIORITY = {
  page: 0,
  prompt: 10,
  popover: 20,
  dialog: 100,
  fullscreen: 200,
} as const;

interface BackHandlerEntry {
  id: number;
  priority: number;
  handler: BackHandler;
}

export class BackHandlerRegistry {
  private nextId = 1;
  private readonly entries = new Map<number, BackHandlerEntry>();

  constructor(
    private readonly onError: (error: unknown) => void = (error) =>
      console.error("Android back handler failed", error),
  ) {}

  register(
    handler: BackHandler,
    priority: number = BACK_HANDLER_PRIORITY.page,
  ) {
    const id = this.nextId++;
    this.entries.set(id, { id, priority, handler });
    return () => this.entries.delete(id);
  }

  dispatch() {
    let selected: BackHandlerEntry | undefined;
    for (const entry of this.entries.values()) {
      if (
        !selected ||
        entry.priority > selected.priority ||
        (entry.priority === selected.priority && entry.id > selected.id)
      )
        selected = entry;
    }
    if (!selected) return false;
    try {
      void Promise.resolve(selected.handler()).catch(this.onError);
    } catch (error) {
      this.onError(error);
    }
    return true;
  }
}

export function dispatchBack(
  registry: BackHandlerRegistry,
  fallback: BackHandler,
  onError: (error: unknown) => void = (error) =>
    console.error("Android back fallback failed", error),
) {
  if (registry.dispatch()) return true;
  try {
    void Promise.resolve(fallback()).catch(onError);
  } catch (error) {
    onError(error);
  }
  return false;
}

export type AppView =
  | "home"
  | "messages"
  | "bindings"
  | "settings"
  | "explore"
  | "profile"
  | "create"
  | "public-editor"
  | "post-detail"
  | "character-detail"
  | "public-profile"
  | "auth";

export type AppBackAction =
  | "close-conversation"
  | "close-bindings"
  | "close-settings"
  | "close-secondary";

export function resolveAppBackAction(
  view: AppView,
  hasSelectedAgent: boolean,
): AppBackAction | null {
  if (view === "messages" && hasSelectedAgent) return "close-conversation";
  if (view === "bindings") return "close-bindings";
  if (view === "settings") return "close-settings";
  if (
    view === "create" ||
    view === "public-editor" ||
    view === "post-detail" ||
    view === "character-detail" ||
    view === "public-profile"
  )
    return "close-secondary";
  return null;
}
