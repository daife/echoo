import { describe, expect, it } from "vitest";
import {
  formatConversationTime,
  isVisibleConversationMessage,
  sanitizeVoiceTranscript,
  shouldShowMessageTime,
} from "./messagePresentation";
import type { LocalMessage } from "@echoo/shared";

const baseMessage: LocalMessage = {
  id: "msg_1",
  conversationId: "conversation_1",
  role: "assistant",
  contentType: "text",
  content: { text: "" },
  status: "pending",
  syncStatus: "synced",
  createdAt: 1,
  updatedAt: 1,
};

describe("conversation message visibility", () => {
  it("keeps Prime pending content hidden and reveals Slice after its first delta", () => {
    expect(
      isVisibleConversationMessage(
        { ...baseMessage, content: { text: "partial" } },
        "prime-figure",
      ),
    ).toBe(false);
    expect(isVisibleConversationMessage(baseMessage, "slice-figure")).toBe(
      false,
    );
    expect(
      isVisibleConversationMessage(
        { ...baseMessage, content: { text: "partial" } },
        "slice-figure",
      ),
    ).toBe(true);
  });

  it("requires completed media with a URL", () => {
    const image: LocalMessage = {
      ...baseMessage,
      contentType: "image",
      status: "delivered",
    };
    expect(isVisibleConversationMessage(image, "prime-figure")).toBe(false);
    expect(
      isVisibleConversationMessage(
        { ...image, content: { mediaUrl: "/api/resources/image" } },
        "prime-figure",
      ),
    ).toBe(true);
  });
});

describe("sanitizeVoiceTranscript", () => {
  it("removes bracketed performance tags, including nested tags", () => {
    expect(
      sanitizeVoiceTranscript(
        "[softly] 你好 【笑声】 世界 [nested [breath] tag]",
      ),
    ).toBe("你好 世界");
  });

  it("collapses whitespace and handles tag-only content", () => {
    expect(sanitizeVoiceTranscript("  你\n 好   ")).toBe("你 好");
    expect(sanitizeVoiceTranscript("[laughs] 【停顿】")).toBe("");
  });
});

describe("message time presentation", () => {
  const now = new Date(2026, 6, 12, 18, 0).getTime();

  it("uses contextual Chinese labels", () => {
    expect(
      formatConversationTime(new Date(2026, 6, 12, 9, 5).getTime(), now),
    ).toBe("09:05");
    expect(
      formatConversationTime(new Date(2026, 6, 11, 9, 5).getTime(), now),
    ).toBe("昨天 09:05");
    expect(
      formatConversationTime(new Date(2026, 5, 20, 9, 5).getTime(), now),
    ).toBe("6月20日 09:05");
    expect(
      formatConversationTime(new Date(2025, 11, 31, 9, 5).getTime(), now),
    ).toBe("2025年12月31日 09:05");
  });

  it("shows separators for the first message and five-minute gaps", () => {
    const timestamp = new Date(2026, 6, 12, 9, 5).getTime();
    expect(shouldShowMessageTime(timestamp)).toBe(true);
    expect(shouldShowMessageTime(timestamp + 299_999, timestamp)).toBe(false);
    expect(shouldShowMessageTime(timestamp + 300_000, timestamp)).toBe(true);
  });
});
