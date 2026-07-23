import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PRIME_WORLD_DELETE_CONFIRMATION,
  PrimeWorldDeleteButton,
  requestPrimeWorldConversationDeletion,
} from "./PrimeWorldPage";

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
