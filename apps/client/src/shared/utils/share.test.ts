import { afterEach, describe, expect, it, vi } from "vitest";
import { shareOrCopy } from "./share";

const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
});

describe("shareOrCopy", () => {
  it("uses system sharing when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share });
    await expect(
      shareOrCopy({ title: "动态", url: "https://echoo.example/?post=post_1" }),
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledOnce();
  });

  it("does not copy after the user cancels", async () => {
    const writeText = vi.fn();
    setNavigator({
      share: vi.fn().mockRejectedValue({ name: "AbortError" }),
      clipboard: { writeText },
    });
    await expect(
      shareOrCopy({ title: "动态", url: "https://echoo.example/?post=post_1" }),
    ).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies when sharing is unavailable or fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({
      share: vi.fn().mockRejectedValue(new Error("unavailable")),
      clipboard: { writeText },
    });
    await expect(
      shareOrCopy({
        title: "卡片",
        url: "https://echoo.example/?card=asset_1",
      }),
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(
      "https://echoo.example/?card=asset_1",
    );
  });

  it("falls back to a temporary textarea when clipboard permission fails", async () => {
    const remove = vi.fn();
    const select = vi.fn();
    const appendChild = vi.fn();
    const execCommand = vi.fn().mockReturnValue(true);
    setNavigator({
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: { appendChild },
        createElement: vi.fn().mockReturnValue({
          value: "",
          style: {},
          select,
          remove,
        }),
        execCommand,
      },
    });

    await expect(
      shareOrCopy({ title: "动态", url: "https://echoo.example/?post=post_1" }),
    ).resolves.toBe("copied");
    expect(appendChild).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(remove).toHaveBeenCalledOnce();
  });
});

function setNavigator(value: object) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
}
