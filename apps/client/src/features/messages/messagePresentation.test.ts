import { describe, expect, it } from "vitest";
import {
  formatConversationTime,
  isVisibleConversationMessage,
  sanitizeVoiceTranscript,
  parsePrimeFigureHintCommand,
  shouldShowMessageTime,
} from "./messagePresentation";
import { estimateMp3DurationSeconds } from "@echoo/shared";
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
  it("reveals pending assistant text after its first delta", () => {
    expect(
      isVisibleConversationMessage(
        { ...baseMessage, content: { text: "partial" } },
        "prime-figure",
      ),
    ).toBe(true);
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

  it("shows a Prime voice placeholder while audio is streaming", () => {
    expect(
      isVisibleConversationMessage(
        {
          ...baseMessage,
          contentType: "voice",
          metadata: { audioStreaming: true },
        },
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

describe("Prime Figure hint commands", () => {
  it("extracts only the standalone /hint slash command", () => {
    expect(parsePrimeFigureHintCommand("/hint 必须回复三条消息")).toBe(
      "必须回复三条消息",
    );
    expect(parsePrimeFigureHintCommand(" /HINT\n使用语音 ")).toBe("使用语音");
    expect(parsePrimeFigureHintCommand("/hint")).toBe("");
    expect(parsePrimeFigureHintCommand("/hinted 普通消息")).toBeNull();
  });
});

describe("MP3 stream duration", () => {
  it("estimates duration from the complete frames received so far", () => {
    const frameLength = 417;
    const bytes = new Uint8Array(frameLength * 2 + 100);
    for (const offset of [0, frameLength]) {
      bytes.set([0xff, 0xfb, 0x90, 0x00], offset);
    }
    expect(estimateMp3DurationSeconds(bytes)).toBeCloseTo(
      (2 * 1152) / 44_100,
      5,
    );
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
