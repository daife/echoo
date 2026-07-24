import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("./tauriInvoke", () => ({ tauriInvoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mocks.isPermissionGranted,
  requestPermission: mocks.requestPermission,
  sendNotification: mocks.sendNotification,
}));

import { TauriNotificationRuntime } from "./TauriNotificationRuntime";

describe("Tauri notification routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPermissionGranted.mockResolvedValue(true);
    mocks.invoke.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["message", "conversation:1"],
    ["activity", "activity"],
  ] as const)("routes Android %s notifications through keepalive", async (kind, id) => {
    vi.stubGlobal("navigator", { userAgent: "Echoo Android" });
    const runtime = new TauriNotificationRuntime();

    await runtime.showNotification({
      id,
      kind,
      title: "Echoo",
      body: "通知内容",
    });

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "plugin:keepalive|prepare_notifications",
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "plugin:keepalive|show_notification",
      { id, kind, title: "Echoo", body: "通知内容" },
    );
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(runtime.permissionRequestMode).toBe("automatic");
  });

  it("keeps desktop notifications on the Tauri notification plugin", async () => {
    vi.stubGlobal("navigator", { userAgent: "Echoo Desktop" });
    const runtime = new TauriNotificationRuntime();

    await runtime.showNotification({
      id: "activity",
      kind: "activity",
      title: "Echoo",
      body: "通知内容",
    });

    expect(mocks.sendNotification).toHaveBeenCalledWith({
      title: "Echoo",
      body: "通知内容",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(runtime.permissionRequestMode).toBe("manual");
  });

  it("opens the Android conversation notification settings", async () => {
    vi.stubGlobal("navigator", { userAgent: "Echoo Android" });
    const runtime = new TauriNotificationRuntime();

    await runtime.openSettings?.();

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "plugin:keepalive|prepare_notifications",
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "plugin:keepalive|open_notification_settings",
    );
  });
});
