import { describe, expect, it } from "vitest";
import { decodeBinaryFrame } from "./WebMessageRuntime";

describe("binary realtime frames", () => {
  it("decodes the length-prefixed audio header without copying the payload", () => {
    const header = new TextEncoder().encode(
      JSON.stringify({
        type: "message.audio.chunk",
        messageId: "msg_1",
        conversationId: "conv_1",
        sequence: 4,
      }),
    );
    const bytes = new Uint8Array(4 + header.length + 3);
    new DataView(bytes.buffer).setUint32(0, header.length);
    bytes.set(header, 4);
    bytes.set([7, 8, 9], 4 + header.length);

    const decoded = decodeBinaryFrame(bytes.buffer);
    expect(decoded?.header.sequence).toBe(4);
    expect([...Array.from(decoded?.data ?? [])]).toEqual([7, 8, 9]);
  });

  it("rejects malformed header lengths", () => {
    const bytes = new Uint8Array(5);
    new DataView(bytes.buffer).setUint32(0, 99);
    expect(decodeBinaryFrame(bytes.buffer)).toBeNull();
  });
});
