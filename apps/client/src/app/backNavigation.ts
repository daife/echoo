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
  private readonly subscribers = new Set<() => void>();

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
    this.notifySubscribers();
    return () => {
      if (!this.entries.delete(id)) return;
      this.notifySubscribers();
    };
  }

  subscribe = (subscriber: () => void) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  getHandlerCount = () => this.entries.size;

  hasHandlers = () => this.entries.size > 0;

  private notifySubscribers() {
    for (const subscriber of this.subscribers) subscriber();
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
