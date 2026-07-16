import { describe, expect, it } from "vitest";
import { createPendingMediaMessage } from "./localMessageState";

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
