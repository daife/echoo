import { describe, expect, it, vi } from "vitest";
import { WebAppNavigationRuntime } from "../runtimes/web/WebAppNavigationRuntime";
import {
  BACK_HANDLER_PRIORITY,
  BackHandlerRegistry,
  dispatchBack,
  resolveAppBackAction,
  type AppView,
} from "./backNavigation";

describe("Android back handler registry", () => {
  it("dispatches the highest-priority handler", () => {
    const registry = new BackHandlerRegistry();
    const calls: string[] = [];
    registry.register(() => {
      calls.push("page");
    }, BACK_HANDLER_PRIORITY.page);
    registry.register(
      () => {
        calls.push("dialog");
      },
      BACK_HANDLER_PRIORITY.dialog,
    );

    expect(registry.dispatch()).toBe(true);
    expect(calls).toEqual(["dialog"]);
  });

  it("uses the most recently registered handler within one priority", () => {
    const registry = new BackHandlerRegistry();
    const calls: string[] = [];
    registry.register(() => {
      calls.push("first");
    }, BACK_HANDLER_PRIORITY.dialog);
    const unregisterLatest = registry.register(
      () => {
        calls.push("latest");
      },
      BACK_HANDLER_PRIORITY.dialog,
    );

    registry.dispatch();
    unregisterLatest();
    registry.dispatch();

    expect(calls).toEqual(["latest", "first"]);
  });

  it("treats a busy no-op handler as consumed instead of falling through", () => {
    const registry = new BackHandlerRegistry();
    const fallback = vi.fn();
    registry.register(() => undefined, BACK_HANDLER_PRIORITY.dialog);

    expect(dispatchBack(registry, fallback)).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("runs the background fallback exactly once at the root", () => {
    const registry = new BackHandlerRegistry();
    const fallback = vi.fn();

    expect(dispatchBack(registry, fallback)).toBe(false);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

describe("app-level Android back actions", () => {
  const rootViews: AppView[] = [
    "home",
    "messages",
    "explore",
    "profile",
    "auth",
  ];

  it.each(rootViews)("treats %s as a root view", (view) => {
    expect(resolveAppBackAction(view, false)).toBeNull();
  });

  it("closes a selected conversation before leaving the messages root", () => {
    expect(resolveAppBackAction("messages", true)).toBe(
      "close-conversation",
    );
  });

  it.each([
    ["bindings", "close-bindings"],
    ["settings", "close-settings"],
    ["create", "close-secondary"],
    ["public-editor", "close-secondary"],
    ["post-detail", "close-secondary"],
    ["character-detail", "close-secondary"],
    ["public-profile", "close-secondary"],
  ] as const)("maps %s to %s", (view, action) => {
    expect(resolveAppBackAction(view, false)).toBe(action);
  });
});

describe("web app navigation runtime", () => {
  it("does not subscribe or mutate browser navigation", async () => {
    const runtime = new WebAppNavigationRuntime();
    const handler = vi.fn();
    const unlisten = await runtime.listenBackButton(handler);

    await runtime.moveToBackground();
    unlisten();

    expect(handler).not.toHaveBeenCalled();
  });
});
