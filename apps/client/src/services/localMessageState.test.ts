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
});
