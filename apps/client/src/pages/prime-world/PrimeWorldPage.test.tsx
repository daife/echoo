import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PRIME_WORLD_DELETE_CONFIRMATION,
  PRIME_WORLD_RESET_CONFIRMATION,
  PrimeWorldDeleteButton,
  isPrimeWorldStarted,
  requestPrimeWorldConversationDeletion,
  requestPrimeWorldConversationReset,
} from "./PrimeWorldPage";

describe("PrimeWorld lifecycle actions", () => {
  it("only treats a persisted or active world as started", () => {
    expect(isPrimeWorldStarted({})).toBe(false);
    expect(isPrimeWorldStarted({}, { status: "failed" })).toBe(false);
    expect(isPrimeWorldStarted({}, { status: "queued" })).toBe(true);
    expect(isPrimeWorldStarted({ startedAt: 123 })).toBe(true);
  });

  it("does not reset without destructive confirmation", async () => {
    const onReset = vi.fn();
    const onResettingChange = vi.fn();
    const onError = vi.fn();

    const runId = await requestPrimeWorldConversationReset({
      conversationId: "conversation_world",
      onReset,
      confirmReset: vi.fn(() => false),
      onResettingChange,
      onError,
    });

    expect(runId).toBeNull();
    expect(onReset).not.toHaveBeenCalled();
    expect(onResettingChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("starts the reset run after confirmation", async () => {
    const onReset = vi.fn().mockResolvedValue({ runId: "run_reset" });
    const onResettingChange = vi.fn();
    const onError = vi.fn();
    const confirmReset = vi.fn(() => true);

    const runId = await requestPrimeWorldConversationReset({
      conversationId: "conversation_world",
      onReset,
      confirmReset,
      onResettingChange,
      onError,
    });

    expect(runId).toBe("run_reset");
    expect(confirmReset).toHaveBeenCalledWith(PRIME_WORLD_RESET_CONFIRMATION);
    expect(onReset).toHaveBeenCalledWith("conversation_world");
    expect(onError).toHaveBeenCalledWith(null);
    expect(onResettingChange).toHaveBeenCalledWith(true);
  });

  it("restores the controls when resetting fails", async () => {
    const onResettingChange = vi.fn();
    const onError = vi.fn();

    const runId = await requestPrimeWorldConversationReset({
      conversationId: "conversation_world",
      onReset: vi.fn().mockRejectedValue(new Error("重置请求失败。")),
      confirmReset: () => true,
      onResettingChange,
      onError,
    });

    expect(runId).toBeNull();
    expect(onError).toHaveBeenLastCalledWith("重置请求失败。");
    expect(onResettingChange.mock.calls).toEqual([[true], [false]]);
  });
});

describe("PrimeWorld conversation deletion", () => {
  it("renders a labelled destructive action and disables it while deleting", () => {
    const html = renderToStaticMarkup(
      <PrimeWorldDeleteButton disabled onClick={vi.fn()} />,
    );

    expect(html).toContain('aria-label="删除会话"');
    expect(html).toContain('title="删除会话"');
    expect(html).toContain("disabled");
  });

  it("does nothing when permanent deletion is not confirmed", async () => {
    const onDelete = vi.fn();
    const onDeletingChange = vi.fn();
    const onError = vi.fn();
    const confirmDeletion = vi.fn(() => false);

    const deleted = await requestPrimeWorldConversationDeletion({
      conversationId: "conversation_world",
      onDelete,
      confirmDeletion,
      onDeletingChange,
      onError,
    });

    expect(deleted).toBe(false);
    expect(confirmDeletion).toHaveBeenCalledWith(
      PRIME_WORLD_DELETE_CONFIRMATION,
    );
    expect(onDelete).not.toHaveBeenCalled();
    expect(onDeletingChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("deletes the current conversation once after confirmation", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onDeletingChange = vi.fn();
    const onError = vi.fn();

    const deleted = await requestPrimeWorldConversationDeletion({
      conversationId: "conversation_world",
      onDelete,
      confirmDeletion: () => true,
      onDeletingChange,
      onError,
    });

    expect(deleted).toBe(true);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith("conversation_world");
    expect(onError).toHaveBeenCalledWith(null);
    expect(onDeletingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps the page active and reports deletion failures", async () => {
    const onDeletingChange = vi.fn();
    const onError = vi.fn();

    const deleted = await requestPrimeWorldConversationDeletion({
      conversationId: "conversation_world",
      onDelete: vi.fn().mockRejectedValue(new Error("网络不可用。")),
      confirmDeletion: () => true,
      onDeletingChange,
      onError,
    });

    expect(deleted).toBe(false);
    expect(onError).toHaveBeenLastCalledWith("网络不可用。");
    expect(onDeletingChange.mock.calls).toEqual([[true], [false]]);
  });
});
