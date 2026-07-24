import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "@echoo/shared";
import type { NotificationRuntime } from "../../runtimes/contracts";
import {
  hasUnreadConversations,
  initializeNotificationPermission,
  upsertConversation,
} from "./useNotificationCenter";

const conversation = (id: string, unreadCount: number): Conversation => ({
  id,
  title: id,
  type: "slice-figure",
  unreadCount,
  createdAt: 1,
  updatedAt: 1,
});

describe("notification permission initialization", () => {
  it("requests Android permission once and enables background notifications", async () => {
    const storage = memoryStorage();
    const notification = notificationRuntime("automatic");
    notification.getPermissionState = vi.fn(async () => "prompt" as const);
    notification.requestPermission = vi.fn(async () => true);
    const setBackgroundNotificationsEnabled = vi.fn();

    await initializeNotificationPermission({
      notification,
      message: { setBackgroundNotificationsEnabled },
      storage,
    });
    notification.getPermissionState = vi.fn(async () => "granted" as const);
    await initializeNotificationPermission({
      notification,
      message: { setBackgroundNotificationsEnabled },
      storage,
    });

    expect(notification.requestPermission).toHaveBeenCalledOnce();
    expect(setBackgroundNotificationsEnabled).toHaveBeenNthCalledWith(1, true);
    expect(setBackgroundNotificationsEnabled).toHaveBeenNthCalledWith(2, true);
  });

  it("does not repeat a denied automatic request", async () => {
    const storage = memoryStorage();
    const notification = notificationRuntime("automatic");
    notification.getPermissionState = vi
      .fn<NotificationRuntime["getPermissionState"]>()
      .mockResolvedValueOnce("prompt")
      .mockResolvedValue("denied");
    notification.requestPermission = vi.fn(async () => false);
    const setBackgroundNotificationsEnabled = vi.fn();

    expect(
      await initializeNotificationPermission({
        notification,
        message: { setBackgroundNotificationsEnabled },
        storage,
      }),
    ).toBe("denied");
    expect(
      await initializeNotificationPermission({
        notification,
        message: { setBackgroundNotificationsEnabled },
        storage,
      }),
    ).toBe("denied");

    expect(notification.requestPermission).toHaveBeenCalledOnce();
    expect(setBackgroundNotificationsEnabled).toHaveBeenCalledWith(false);
  });

  it("leaves web and desktop permission prompts manual", async () => {
    const notification = notificationRuntime("manual");
    notification.getPermissionState = vi.fn(async () => "prompt" as const);
    const setBackgroundNotificationsEnabled = vi.fn();

    await initializeNotificationPermission({
      notification,
      message: { setBackgroundNotificationsEnabled },
      storage: memoryStorage(),
    });

    expect(notification.requestPermission).not.toHaveBeenCalled();
    expect(setBackgroundNotificationsEnabled).toHaveBeenCalledWith(false);
  });
});

function notificationRuntime(
  permissionRequestMode: NotificationRuntime["permissionRequestMode"],
): NotificationRuntime {
  return {
    permissionRequestMode,
    getPermissionState: vi.fn(async () => "prompt" as const),
    requestPermission: vi.fn(async () => false),
    showNotification: vi.fn(),
  };
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("notification conversation state", () => {
  it("derives the navigation dot from all conversation dots", () => {
    expect(
      hasUnreadConversations([conversation("a", 0), conversation("b", 1)]),
    ).toBe(true);
    expect(
      hasUnreadConversations([conversation("a", 0), conversation("b", 0)]),
    ).toBe(false);
  });

  it("replaces a consumed conversation without duplicating it", () => {
    const next = upsertConversation(
      [conversation("a", 2), conversation("b", 1)],
      conversation("a", 0),
    );
    expect(next.map((item) => [item.id, item.unreadCount])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });
});
