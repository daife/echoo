import { describe, expect, it } from "vitest";
import type { Conversation } from "@echoo/shared";
import {
  hasUnreadConversations,
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
