import { ApiError } from "@echoo/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRuntime, StorageRuntime } from "../runtimes/contracts";
import { AuthService } from "./AuthService";

describe("AuthService session restoration", () => {
  let auth: AuthRuntime;
  let storage: StorageRuntime;
  let api: { me: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = {
      saveTokens: vi.fn(),
      getAccessToken: vi.fn(async () => "access-token"),
      getRefreshToken: vi.fn(async () => "refresh-token"),
      clearTokens: vi.fn(),
      expireSession: vi.fn(),
      hydrateTokens: vi.fn(),
    };
    storage = {
      getSetting: vi.fn(),
      setSetting: vi.fn(),
      removeSetting: vi.fn(),
    };
    api = { me: vi.fn() };
  });

  it("keeps the local session when startup fails for a non-auth reason", async () => {
    api.me.mockRejectedValue(new Error("network unavailable"));

    const result = await new AuthService(api as never, auth, storage)
      .loadCurrentUser();

    expect(result).toEqual({ user: null, sessionExpired: false });
    expect(auth.expireSession).not.toHaveBeenCalled();
    expect(storage.removeSetting).not.toHaveBeenCalled();
  });

  it("clears the session only after an explicit unauthorized response", async () => {
    api.me.mockRejectedValue(new ApiError("登录会话已失效。", 401));

    const result = await new AuthService(api as never, auth, storage)
      .loadCurrentUser();

    expect(result).toEqual({ user: null, sessionExpired: true });
    expect(auth.expireSession).toHaveBeenCalledOnce();
    expect(storage.removeSetting).toHaveBeenCalledWith("auth.currentUser");
  });

  it("hydrates native credentials before making the startup request", async () => {
    const user = { id: "user-1", email: "a@echoo.dev" };
    api.me.mockResolvedValue(user);

    const result = await new AuthService(api as never, auth, storage)
      .loadCurrentUser();

    expect(auth.hydrateTokens).toHaveBeenCalledBefore(api.me);
    expect(result).toEqual({ user, sessionExpired: false });
  });
});
