import type { LocalMessage } from "@echoo/shared";
import { describe, expect, it } from "vitest";
import {
  getPrimeRuntimeErrorText,
  isVisibleConversationMessage,
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

describe("prime runtime error presentation", () => {
  it("extracts the persisted provider error for realtime notification", () => {
    expect(getPrimeRuntimeErrorText(runtimeErrorMessage)).toBe(
      "openrouter chat completion failed: No endpoints available.",
    );
  });

  it("keeps persisted runtime errors out of conversation history", () => {
    expect(isVisibleConversationMessage(runtimeErrorMessage)).toBe(false);
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
