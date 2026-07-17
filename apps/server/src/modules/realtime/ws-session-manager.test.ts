import assert from "node:assert/strict";
import test from "node:test";
import type { WebSocket } from "@fastify/websocket";
import { WsSessionManager } from "./ws-session-manager.js";

function socket(bufferedAmount = 0) {
  const sent: Array<string | Buffer> = [];
  const value = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount,
    send(payload: string | Buffer) {
      sent.push(payload);
    },
  };
  return { value: value as unknown as WebSocket, sent };
}

test("broadcasts only to sockets owned by the target user", () => {
  const sessions = new WsSessionManager();
  const firstDevice = socket();
  const secondDevice = socket();
  const otherUser = socket();
  sessions.add(firstDevice.value, "user-a");
  sessions.add(secondDevice.value, "user-a");
  sessions.add(otherUser.value, "user-b");

  sessions.broadcastToUser("user-a", { type: "test" });

  assert.equal(firstDevice.sent.length, 1);
  assert.equal(secondDevice.sent.length, 1);
  assert.equal(otherUser.sent.length, 0);
  assert.deepEqual(sessions.snapshot(), {
    activeSockets: 3,
    activeUsers: 2,
    sentBytes: 30,
    droppedBinaryFrames: 0,
  });
});

test("drops live binary audio under backpressure without affecting other devices", () => {
  const sessions = new WsSessionManager();
  const congested = socket(4 * 1024 * 1024);
  const healthy = socket();
  sessions.add(congested.value, "user-a");
  sessions.add(healthy.value, "user-a");

  sessions.broadcastBinaryToUser(
    "user-a",
    { type: "message.audio.chunk", sequence: 1 },
    Buffer.from([1, 2, 3]),
  );

  assert.equal(congested.sent.length, 0);
  assert.equal(healthy.sent.length, 1);
  assert.equal(sessions.snapshot().droppedBinaryFrames, 1);
});
