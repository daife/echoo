import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRuntime } from "../contracts";
import { WebMessageRuntime } from "./WebMessageRuntime";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: URL) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  send(payload: string) {
    this.sent.push(payload);
  }
}

const auth: AuthRuntime = {
  saveTokens: vi.fn(async () => undefined),
  getAccessToken: vi.fn(async () => "access-token"),
  getRefreshToken: vi.fn(async () => null),
  clearTokens: vi.fn(async () => undefined),
};

describe("WebMessageRuntime reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reconnects after the server closes the socket", async () => {
    const runtime = new WebMessageRuntime(auth);
    await runtime.startRealtime();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(String(FakeWebSocket.instances[0]?.url)).toContain(
      "token=access-token",
    );

    FakeWebSocket.instances[0]?.open();
    FakeWebSocket.instances[0]?.close();
    await vi.advanceTimersByTimeAsync(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    await runtime.stopRealtime();
  });

  it("clears active conversations on disconnect and keeps handlers for the new socket", async () => {
    const runtime = new WebMessageRuntime(auth);
    const activity: boolean[] = [];
    runtime.onConversationAgentActivity((event) => {
      activity.push(event.active);
    });
    await runtime.startRealtime();
    const first = FakeWebSocket.instances[0];
    first?.open();
    first?.emit({
      type: "conversation.agent_activity",
      conversationId: "conversation_1",
      active: true,
      updatedAt: 1,
    });
    first?.close();
    expect(activity).toEqual([true, false]);

    await vi.advanceTimersByTimeAsync(500);
    const second = FakeWebSocket.instances[1];
    second?.open();
    second?.emit({
      type: "conversation.agent_activity",
      conversationId: "conversation_1",
      active: true,
      updatedAt: 2,
    });
    expect(activity).toEqual([true, false, true]);

    await runtime.stopRealtime();
  });

  it("does not reconnect after an intentional stop", async () => {
    const runtime = new WebMessageRuntime(auth);
    await runtime.startRealtime();
    FakeWebSocket.instances[0]?.open();
    await runtime.stopRealtime();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
