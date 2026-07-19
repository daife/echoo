import type { LocalMessage } from "@echoo/shared";
import { describe, expect, it } from "vitest";
import {
  createClientMessageId,
  createPendingMediaMessage,
  createPendingTextMessage,
  mergeIncomingMessage,
} from "./localMessageState";

describe("client message ids", () => {
  it("uses randomUUID when the secure-context API is available", () => {
    expect(
      createClientMessageId({ randomUUID: () => "uuid_1" }),
    ).toBe("client_uuid_1");
  });

  it("creates unique fallback ids when randomUUID is unavailable over LAN HTTP", () => {
    const first = createClientMessageId({
      randomUUID: null,
      now: 1_234,
      random: 0.5,
    });
    const second = createClientMessageId({
      randomUUID: null,
      now: 1_234,
      random: 0.5,
    });

    expect(first).toMatch(/^client_[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$/);
    expect(second).not.toBe(first);
    expect(first.length).toBeLessThanOrEqual(96);
  });

  it("falls back when a WebView exposes randomUUID but rejects the call", () => {
    expect(
      createClientMessageId({
        randomUUID: () => {
          throw new DOMException("Secure context required");
        },
        now: 1_234,
        random: 0.5,
      }),
    ).toMatch(/^client_[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$/);
  });

  it("creates pending text messages without requiring randomUUID", () => {
    const message = createPendingTextMessage({
      conversationId: "conversation_1",
      text: "hello",
      now: 1_234,
    });

    expect(message.id).toMatch(/^client_/);
    expect(message.clientMessageId).toBe(message.id);
  });
});

describe("pending media messages", () => {
  it("creates optimistic images without layout metadata", () => {
    const message = createPendingMediaMessage({
      conversationId: "conversation_1",
      contentType: "image",
      mediaUrl: "blob:image",
      fileName: "image.jpg",
      clientMessageId: "client_image",
      now: 1234,
    });

    expect("localMediaDimensions" in message).toBe(false);
    expect(message.content.media).toBeUndefined();
  });

  it("creates optimistic video messages with the local preview URL", () => {
    const message = createPendingMediaMessage({
      conversationId: "conversation_1",
      contentType: "video",
      mediaUrl: "blob:video",
      fileName: "clip.mp4",
      clientMessageId: "client_video",
      now: 1234,
    });

    expect(message.contentType).toBe("video");
    expect(message.content.mediaUrl).toBe("blob:video");
    expect(message.metadata).toBeUndefined();
  });
});

describe("incoming voice message merging", () => {
  const voiceMessage = (
    overrides: Partial<LocalMessage> = {},
  ): LocalMessage => ({
    id: "voice_1",
    conversationId: "conversation_1",
    role: "assistant",
    contentType: "voice",
    content: { text: "语音内容" },
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
    syncStatus: "synced",
    ...overrides,
  });

  it("keeps local streaming state when a pending server snapshot arrives", () => {
    const existing = voiceMessage({
      content: { text: "语音内容", mediaUrl: "/streamed.mp3" },
      metadata: {
        audioStreaming: true,
        liveAudioDurationSeconds: 1.25,
      },
      updatedAt: 3,
    });
    const incoming = voiceMessage({
      content: { text: "语音内容" },
      metadata: { kind: "prime_figure" },
      updatedAt: 2,
    });

    const [merged] = mergeIncomingMessage([existing], incoming);

    expect(merged?.metadata).toMatchObject({
      kind: "prime_figure",
      audioStreaming: true,
      liveAudioDurationSeconds: 1.25,
    });
    expect(merged?.content.mediaUrl).toBe("/streamed.mp3");
    expect(merged?.updatedAt).toBe(3);
  });

  it("accepts the final server state after streaming completes", () => {
    const existing = voiceMessage({
      metadata: { audioStreaming: true, liveAudioDurationSeconds: 1.25 },
    });
    const completed = voiceMessage({
      status: "delivered",
      content: { text: "语音内容", mediaUrl: "/final.mp3" },
      metadata: { durationSeconds: 2 },
      updatedAt: 4,
    });

    const [merged] = mergeIncomingMessage([existing], completed);

    expect(merged).toEqual(completed);
    expect(merged?.metadata?.audioStreaming).toBeUndefined();
  });
});
