import { describe, expect, it } from "vitest";
import { decodeBinaryFrame, resolveWebSocketUrl } from "./WebMessageRuntime";

describe("web realtime URL", () => {
  it("resolves a relative socket path against an HTTPS page as WSS", () => {
    expect(
      resolveWebSocketUrl("/ws", "https://192.168.1.100:5173/messages"),
    ).toBe("wss://192.168.1.100:5173/ws");
  });

  it("keeps absolute WS addresses and upgrades HTTPS addresses", () => {
    expect(
      resolveWebSocketUrl("ws://localhost:8787/ws", "https://x.test"),
    ).toBe("ws://localhost:8787/ws");
    expect(resolveWebSocketUrl("https://echoo.test/ws", "http://x.test")).toBe(
      "wss://echoo.test/ws",
    );
  });
});

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
