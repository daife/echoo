import { describe, expect, it } from "vitest";
import {
  formatConversationTime,
  getOutgoingDeliveryState,
  getConversationPresenceLabel,
  getPrimePresencePhaseDuration,
  getPrimeRuntimeErrorText,
  isVisibleConversationMessage,
  sanitizeVoiceTranscript,
  parsePrimeFigureHintCommand,
  shouldShowMessageTime,
  shouldShowTimelineItemTime,
  shouldShowFigurePendingIndicator,
  splitFigureReply,
  tokenizeParentheticalText,
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
      isVisibleConversationMessage({
        ...baseMessage,
        content: { text: "partial" },
      }),
    ).toBe(true);
    expect(isVisibleConversationMessage(baseMessage)).toBe(false);
    expect(
      isVisibleConversationMessage({
        ...baseMessage,
        content: { text: "partial" },
      }),
    ).toBe(true);
  });

  it("requires completed media with a URL", () => {
    const image: LocalMessage = {
      ...baseMessage,
      contentType: "image",
      status: "delivered",
    };
    expect(isVisibleConversationMessage(image)).toBe(false);
    expect(
      isVisibleConversationMessage({
        ...image,
        content: { mediaUrl: "/api/resources/image" },
      }),
    ).toBe(true);
  });

  it("shows optimistic end-user media immediately from its blob URL", () => {
    expect(
      isVisibleConversationMessage({
        ...baseMessage,
        role: "user",
        contentType: "image",
        content: { mediaUrl: "blob:image-preview" },
        syncStatus: "pending",
      }),
    ).toBe(true);
  });

  it("shows a Prime voice placeholder while audio is streaming", () => {
    expect(
      isVisibleConversationMessage({
        ...baseMessage,
        contentType: "voice",
        metadata: { audioStreaming: true },
      }),
    ).toBe(true);
  });

  it("recognizes persisted Prime runtime errors", () => {
    const runtimeError: LocalMessage = {
      ...baseMessage,
      role: "system",
      contentType: "system",
      content: { text: "openrouter API key is not configured." },
      status: "delivered",
      metadata: { kind: "prime_runtime_error" },
    };
    expect(getPrimeRuntimeErrorText(runtimeError)).toBe(
      "openrouter API key is not configured.",
    );
    expect(
      getPrimeRuntimeErrorText({
        ...runtimeError,
        metadata: { kind: "memory_summary" },
      }),
    ).toBeNull();
  });
});

describe("conversation message delivery presentation", () => {
  it("shows delivery state only on end-user messages", () => {
    expect(
      getOutgoingDeliveryState({
        ...baseMessage,
        role: "user",
        syncStatus: "pending",
      }),
    ).toBe("sending");
    expect(
      getOutgoingDeliveryState({
        ...baseMessage,
        role: "user",
        status: "failed",
        syncStatus: "failed",
      }),
    ).toBe("failed");
    expect(getOutgoingDeliveryState(baseMessage)).toBeUndefined();
  });

  it("hides pending indicators on Prime Figure replies only", () => {
    expect(shouldShowFigurePendingIndicator(baseMessage, "prime-figure")).toBe(
      false,
    );
    expect(shouldShowFigurePendingIndicator(baseMessage, "slice-figure")).toBe(
      true,
    );
  });
});

describe("Slice Figure reply presentation", () => {
  it("splits sentence endings and newlines without splitting decimals", () => {
    expect(splitFigureReply("你好！真的？\n值是 3.14。 好...可以")).toEqual([
      "你好！",
      "真的？",
      "值是 3.14。",
      "好...",
      "可以",
    ]);
  });

  it("marks Chinese, English, nested and unfinished parentheses as muted", () => {
    expect(tokenizeParentheticalText("你好（轻声 (笑)）继续")).toEqual([
      { text: "你好", muted: false },
      { text: "（轻声 (笑)）", muted: true },
      { text: "继续", muted: false },
    ]);
    expect(tokenizeParentheticalText("普通（未完").at(-1)).toEqual({
      text: "（未完",
      muted: true,
    });
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

describe("conversation presence", () => {
  it("shows do-not-disturb before activity or online state", () => {
    expect(
      getConversationPresenceLabel({
        agentTypeLabel: "本初角色",
        isAgentActive: true,
        isAgentMuted: true,
      }),
    ).toBe("对方已开启勿扰");
    expect(
      getConversationPresenceLabel({
        agentTypeLabel: "本初角色",
        isAgentActive: true,
        isAgentMuted: false,
      }),
    ).toBe("对方输入中…");
  });

  it("uses a longer random typing beat and a shorter online beat", () => {
    expect(getPrimePresencePhaseDuration("typing", 0)).toBe(1_800);
    expect(getPrimePresencePhaseDuration("typing", 1)).toBe(4_200);
    expect(getPrimePresencePhaseDuration("online", 0)).toBe(900);
    expect(getPrimePresencePhaseDuration("online", 1)).toBe(2_100);
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

  it("does not show or reset time separators for timeline notices", () => {
    const timestamp = new Date(2026, 6, 12, 9, 5).getTime();
    const items = [
      { createdAt: timestamp, kind: "text" },
      { createdAt: timestamp + 240_000, kind: "runtime-error" },
      { createdAt: timestamp + 300_000, kind: "text" },
      { createdAt: timestamp + 360_000, kind: "memory-summary" },
    ];
    expect(shouldShowTimelineItemTime(items, 0)).toBe(true);
    expect(shouldShowTimelineItemTime(items, 1)).toBe(false);
    expect(shouldShowTimelineItemTime(items, 2)).toBe(true);
    expect(shouldShowTimelineItemTime(items, 3)).toBe(false);
  });
});
