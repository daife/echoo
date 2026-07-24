import type { AuthTokens } from "@echoo/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRuntime } from "../contracts";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  realtimeStart: vi.fn(),
  realtimeStop: vi.fn(),
  getSyncCursor: vi.fn(async () => 17),
}));

vi.mock("./tauriInvoke", () => ({ tauriInvoke: mocks.invoke }));
vi.mock("../web/WebMessageRuntime", () => ({
  WebMessageRuntime: class {
    startRealtime = mocks.realtimeStart;
    stopRealtime = mocks.realtimeStop;
    getSyncCursor = mocks.getSyncCursor;
  },
}));

import { TauriMessageRuntime } from "./TauriMessageRuntime";

describe("Android realtime ownership", () => {
  let hidden = false;
  let visibilityHandler: (() => void) | undefined;
  let tokens: AuthTokens;
  let auth: AuthRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    hidden = false;
    visibilityHandler = undefined;
    tokens = {
      accessToken: jwtWithExpiry(2_000_000_000),
      refreshToken: "refresh-token",
      expiresAt: 2_000_000_000_000,
    };
    auth = {
      saveTokens: vi.fn(async (next) => {
        tokens = next;
      }),
      getAccessToken: vi.fn(async () => tokens.accessToken),
      getRefreshToken: vi.fn(async () => tokens.refreshToken),
      clearTokens: vi.fn(),
      expireSession: vi.fn(),
    };
    vi.stubGlobal("navigator", { userAgent: "Echoo Android" });
    vi.stubGlobal("document", {
      get hidden() {
        return hidden;
      },
      addEventListener: vi.fn(
        (name: string, handler: () => void) => {
          if (name === "visibilitychange") visibilityHandler = handler;
        },
      ),
      removeEventListener: vi.fn(),
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "plugin:keepalive|handoff") return tokens;
      return undefined;
    });
  });

  it("resumes a previously enabled service whenever the signed-in app starts", async () => {
    const runtime = new TauriMessageRuntime(auth);

    await runtime.startRealtime();

    expect(mocks.realtimeStart).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "plugin:keepalive|start",
      expect.objectContaining({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        cursor: 17,
        ensureService: true,
        activateSocket: false,
        resumeOnly: true,
      }),
    );
  });

  it("persists enablement after notification permission is granted", async () => {
    const runtime = new TauriMessageRuntime(auth);
    await runtime.startRealtime();
    mocks.invoke.mockClear();

    await runtime.setBackgroundNotificationsEnabled(true);

    expect(mocks.invoke).toHaveBeenCalledWith(
      "plugin:keepalive|start",
      expect.objectContaining({
        ensureService: true,
        activateSocket: false,
        resumeOnly: false,
      }),
    );
  });

  it("moves the socket to the running native service when the app is hidden", async () => {
    const runtime = new TauriMessageRuntime(auth);
    await runtime.startRealtime();
    await runtime.setBackgroundNotificationsEnabled(true);
    mocks.invoke.mockClear();
    mocks.realtimeStop.mockClear();

    hidden = true;
    visibilityHandler?.();

    await vi.waitFor(() => expect(mocks.realtimeStop).toHaveBeenCalledOnce());
    expect(mocks.invoke).toHaveBeenCalledWith(
      "plugin:keepalive|start",
      expect.objectContaining({
        ensureService: false,
        activateSocket: true,
        resumeOnly: false,
      }),
    );
  });

  it("keeps the UI cursor behind the native notification cursor for foreground catch-up", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "plugin:keepalive|handoff")
        return { ...tokens, cursor: 99 };
      return undefined;
    });
    const runtime = new TauriMessageRuntime(auth);

    await runtime.startRealtime();

    expect(mocks.realtimeStart).toHaveBeenCalledOnce();
    expect(mocks.getSyncCursor).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "plugin:keepalive|start",
      expect.objectContaining({
        cursor: 17,
        ensureService: true,
        activateSocket: false,
      }),
    );
  });
});

function jwtWithExpiry(exp: number) {
  const header = btoa(JSON.stringify({ alg: "none" }));
  const payload = btoa(JSON.stringify({ exp }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.signature`;
}
