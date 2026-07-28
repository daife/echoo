import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parsePublicLinkTarget,
  publicLinkTargetForOrigins,
  publicLinkUrl,
  isSiteLinkForOrigins,
  syncPublicLinkTarget,
} from "./publicLinks";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("public links", () => {
  it("parses one valid public target", () => {
    expect(parsePublicLinkTarget("/?post=post_1")).toEqual({
      type: "post",
      id: "post_1",
    });
    expect(parsePublicLinkTarget("/?card=asset_1")).toEqual({
      type: "card",
      id: "asset_1",
    });
  });

  it("rejects ambiguous, repeated, empty, and malformed targets", () => {
    expect(parsePublicLinkTarget("/?post=post_1&card=asset_1")).toBeNull();
    expect(parsePublicLinkTarget("/?post=post_1&post=post_2")).toBeNull();
    expect(parsePublicLinkTarget("/?post=")).toBeNull();
    expect(parsePublicLinkTarget("/?post=asset_1")).toBeNull();
    expect(parsePublicLinkTarget("/?card=../asset_1")).toBeNull();
  });

  it("builds a clean canonical URL without source query data", () => {
    expect(
      publicLinkUrl(
        { type: "post", id: "post_1" },
        "https://echoo.example/app?verificationToken=secret#fragment",
      ),
    ).toBe("https://echoo.example/app/?post=post_1");
  });

  it("only treats canonical-origin targets as internal links", () => {
    expect(
      publicLinkTargetForOrigins(
        new URL("https://echoo.example/?card=asset_1"),
        ["https://echoo.example/app"],
      ),
    ).toEqual({ type: "card", id: "asset_1" });
    expect(
      publicLinkTargetForOrigins(
        new URL("https://outside.example/?card=asset_1"),
        ["https://echoo.example"],
      ),
    ).toBeNull();
  });

  it("treats every same-origin path as internal without matching similar hosts or ports", () => {
    const origins = ["https://echoo.example/app"];
    expect(
      isSiteLinkForOrigins(
        new URL("https://echoo.example/announcements/latest?from=app"),
        origins,
      ),
    ).toBe(true);
    expect(
      isSiteLinkForOrigins(new URL("https://outside.example/app"), origins),
    ).toBe(false);
    expect(
      isSiteLinkForOrigins(new URL("https://echoo.example.evil/app"), origins),
    ).toBe(false);
    expect(
      isSiteLinkForOrigins(new URL("https://echoo.example:8443/app"), origins),
    ).toBe(false);
  });

  it("synchronizes one target without disturbing unrelated app parameters", () => {
    let replaced = "";
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "https://echoo.example/?verificationToken=secret&post=post_old",
        },
        history: {
          state: { entry: 1 },
          replaceState: vi.fn((_state, _title, url) => {
            replaced = String(url);
          }),
        },
      },
    });

    syncPublicLinkTarget({ type: "card", id: "asset_1" });
    expect(replaced).toBe(
      "https://echoo.example/?verificationToken=secret&card=asset_1",
    );
  });
});
