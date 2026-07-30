import type { LocalMessage } from "@echoo/shared";
import { describe, expect, it } from "vitest";
import {
  getConversationPresenceLabel,
  getPrimePresencePhaseDuration,
  getRuntimeErrorText,
  isVisibleConversationMessage,
  sanitizeMessagePreview,
  sanitizeVoiceTranscript,
} from "./messagePresentation";

const runtimeErrorMessage: LocalMessage = {
  id: "msg_runtime_error",
  conversationId: "conv_1",
  role: "system",
  contentType: "system",
  content: {
    text: "openrouter chat completion failed: No endpoints available.",
  },
  status: "delivered",
  metadata: { kind: "prime_runtime_error" },
  createdAt: 1_234,
  updatedAt: 1_234,
  syncStatus: "synced",
};

describe("figure runtime error presentation", () => {
  it("extracts persisted runtime errors for realtime notification", () => {
    expect(getRuntimeErrorText(runtimeErrorMessage)).toBe(
      "openrouter chat completion failed: No endpoints available.",
    );
  });

  it("keeps persisted runtime errors out of conversation history", () => {
    expect(isVisibleConversationMessage(runtimeErrorMessage)).toBe(false);
  });

  it("also hides legacy slice errors that were saved as assistant messages", () => {
    expect(
      isVisibleConversationMessage({
        ...runtimeErrorMessage,
        role: "assistant",
        contentType: "text",
        metadata: { kind: "ai_error" },
      }),
    ).toBe(false);
  });
});

describe("conversation presence presentation", () => {
  it("shows typing while an unmuted figure turn is active", () => {
    expect(
      getConversationPresenceLabel({
        agentTypeLabel: "本初角色",
        isAgentActive: true,
        isAgentMuted: false,
      }),
    ).toBe("对方输入中…");
  });

  it("keeps mute ahead of active turn presentation", () => {
    expect(
      getConversationPresenceLabel({
        agentTypeLabel: "本初角色",
        isAgentActive: true,
        isAgentMuted: true,
      }),
    ).toBe("对方已开启勿扰");
  });

  it("keeps the configured random phase duration boundaries", () => {
    expect(getPrimePresencePhaseDuration("typing", 0)).toBe(1_800);
    expect(getPrimePresencePhaseDuration("typing", 1)).toBe(4_200);
    expect(getPrimePresencePhaseDuration("online", 0)).toBe(900);
    expect(getPrimePresencePhaseDuration("online", 1)).toBe(2_100);
  });
});

describe("media message presentation", () => {
  it("keeps video messages with a media URL in conversation history", () => {
    const videoMessage: LocalMessage = {
      id: "msg_video",
      conversationId: "conv_1",
      role: "user",
      contentType: "video",
      content: {
        mediaUrl: "/api/resources/res_video/file",
        resourceId: "res_video",
      },
      status: "sent",
      createdAt: 1_234,
      updatedAt: 1_234,
      syncStatus: "synced",
    };

    expect(isVisibleConversationMessage(videoMessage)).toBe(true);
  });

  it("keeps media-reference-only videos in conversation history", () => {
    const videoMessage: LocalMessage = {
      id: "msg_video_reference",
      conversationId: "conv_1",
      role: "user",
      contentType: "video",
      content: {
        media: {
          resourceId: "res_video",
          kind: "video",
          variants: ["original"],
        },
      },
      status: "sent",
      createdAt: 1_234,
      updatedAt: 1_234,
      syncStatus: "synced",
    };

    expect(isVisibleConversationMessage(videoMessage)).toBe(true);
  });
});

describe("message preview sanitization", () => {
  it("removes nested square-bracket directions and normalizes spacing", () => {
    expect(
      sanitizeMessagePreview("你好 [轻声地[停顿]说]   很高兴见到你【微笑】"),
    ).toBe("你好 很高兴见到你");
  });

  it("keeps voice transcripts on the same sanitization path", () => {
    expect(sanitizeVoiceTranscript("欢迎回来【脚步声】")).toBe(
      sanitizeMessagePreview("欢迎回来【脚步声】"),
    );
  });
});
