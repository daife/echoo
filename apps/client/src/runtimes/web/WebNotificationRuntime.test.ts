import { afterEach, describe, expect, it, vi } from "vitest";
import { WebNotificationRuntime } from "./WebNotificationRuntime";

describe("WebNotificationRuntime", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the browser default permission to prompt", async () => {
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: vi.fn(),
    });
    await expect(
      new WebNotificationRuntime().getPermissionState(),
    ).resolves.toBe("prompt");
  });

  it("does not create a notification without permission", async () => {
    const constructor = vi.fn();
    Object.assign(constructor, {
      permission: "denied",
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("Notification", constructor);
    await new WebNotificationRuntime().showNotification({
      id: "activity",
      kind: "activity",
      title: "Echoo",
      body: "你有一条新的动态待查看",
    });
    expect(constructor).not.toHaveBeenCalled();
  });
});
