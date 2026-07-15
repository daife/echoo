import { describe, expect, it } from "vitest";
import { createPendingMediaMessage } from "./localMessageState";

describe("pending media messages", () => {
  it("keeps optimistic image dimensions outside the server content", () => {
    const message = createPendingMediaMessage({
      conversationId: "conversation_1",
      contentType: "image",
      mediaUrl: "blob:image",
      fileName: "image.jpg",
      width: 1_200,
      height: 800,
      clientMessageId: "client_image",
      now: 1234,
    });

    expect(message.localMediaDimensions).toEqual({
      width: 1_200,
      height: 800,
    });
    expect(message.content.media).toBeUndefined();
  });
});
