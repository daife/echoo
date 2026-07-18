import type { LocalMessage } from "@echoo/shared";
import { describe, expect, it } from "vitest";
import {
  shouldBufferCompletedAssistantMessage,
  shouldDisplayMessageDelta,
  shouldHidePrimePendingPlaceholder,
} from "./useConversationRealtime";

function message(
  overrides: Partial<LocalMessage> = {},
): LocalMessage {
  return {
    id: "message_1",
    conversationId: "conversation_1",
    role: "assistant",
    contentType: "text",
    content: { text: "" },
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
    syncStatus: "synced",
    ...overrides,
  };
}

describe("conversation realtime presentation policy", () => {
  it("hides only empty pending non-voice Prime messages", () => {
    expect(shouldHidePrimePendingPlaceholder(true, message())).toBe(true);
    expect(
      shouldHidePrimePendingPlaceholder(
        true,
        message({ content: { text: "完整消息" } }),
      ),
    ).toBe(false);
    expect(
      shouldHidePrimePendingPlaceholder(
        true,
        message({ contentType: "voice" }),
      ),
    ).toBe(false);
    expect(shouldHidePrimePendingPlaceholder(false, message())).toBe(false);
  });

  it("accepts visible deltas for Slice and Prime voice only", () => {
    expect(shouldDisplayMessageDelta(false, message())).toBe(true);
    expect(shouldDisplayMessageDelta(true, message())).toBe(false);
    expect(
      shouldDisplayMessageDelta(true, message({ contentType: "voice" })),
    ).toBe(true);
    expect(shouldDisplayMessageDelta(true, undefined)).toBe(false);
  });

  it("routes completed Slice assistant sync changes through the stream buffer", () => {
    expect(
      shouldBufferCompletedAssistantMessage(
        false,
        message({ status: "delivered" }),
      ),
    ).toBe(true);
    expect(
      shouldBufferCompletedAssistantMessage(
        true,
        message({ status: "delivered" }),
      ),
    ).toBe(false);
    expect(
      shouldBufferCompletedAssistantMessage(
        false,
        message({ role: "user", status: "delivered" }),
      ),
    ).toBe(false);
  });
});
