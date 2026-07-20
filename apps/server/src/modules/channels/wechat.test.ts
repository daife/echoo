import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv } from "node:crypto";
import test from "node:test";
import { decryptToken, encryptToken } from "./channel-binding.repository.js";
import { WechatClient } from "./wechat.client.js";
import { WechatService } from "./wechat.service.js";

test("wechat bot tokens are encrypted with authenticated encryption", () => {
  const encrypted = encryptToken("secret-token");
  assert.notEqual(encrypted, "secret-token");
  assert.equal(decryptToken(encrypted), "secret-token");
  assert.throws(() => decryptToken(`${encrypted.slice(0, -1)}x`));
});

test("wechat text delivery uses the official sendmessage endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  let request: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    url = String(input);
    request = init;
    return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
  };
  try {
    await new WechatClient().sendText(
      { baseUrl: "https://weixin.example", botToken: "token" },
      "user-1",
      "hello",
    );
    assert.equal(url, "https://weixin.example/ilink/bot/sendmessage");
    assert.equal(
      (request?.headers as Record<string, string>).Authorization,
      "Bearer token",
    );
    const body = JSON.parse(String(request?.body));
    assert.equal(body.msg.to_user_id, "user-1");
    assert.equal(body.msg.item_list[0].text_item.text, "hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wechat image download decrypts AES-128-ECB CDN payloads", async () => {
  const originalFetch = globalThis.fetch;
  const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const plain = Buffer.from("image bytes");
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  globalThis.fetch = async () => new Response(encrypted);
  try {
    const result = await new WechatClient().downloadImage(
      { baseUrl: "https://weixin.example", botToken: "token" },
      {
        image_item: {
          media: {
            full_url: "https://cdn.example/image",
            aes_key: key.toString("base64"),
          },
        },
      },
    );
    assert.deepEqual(result, plain);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wechat image delivery encrypts, uploads and sends an image item", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/ilink/bot/getuploadurl"))
      return new Response(
        JSON.stringify({ upload_full_url: "https://cdn.example/upload" }),
      );
    if (url === "https://cdn.example/upload")
      return new Response(null, {
        status: 200,
        headers: { "x-encrypted-param": "download-token" },
      });
    return new Response(JSON.stringify({ ret: 0 }));
  };
  try {
    const plain = Buffer.from("outbound image bytes");
    await new WechatClient().sendImage(
      { baseUrl: "https://weixin.example", botToken: "token" },
      "user-1",
      plain,
    );
    assert.equal(calls.length, 3);
    const sendBody = JSON.parse(String(calls[2].init?.body));
    const image = sendBody.msg.item_list[0].image_item;
    assert.equal(image.media.encrypt_query_param, "download-token");
    const key = Buffer.from(image.media.aes_key, "base64");
    const decipher = createDecipheriv("aes-128-ecb", key, null);
    const uploaded = Buffer.from(calls[1].init?.body as Uint8Array);
    assert.deepEqual(
      Buffer.concat([decipher.update(uploaded), decipher.final()]),
      plain,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("delivery recovery claims failed tasks and schedules exponential retry", async () => {
  const finished: any[][] = [];
  const binding = {
    id: "binding-1",
    ownerUserId: "owner-1",
    conversationId: "conversation-1",
    account: {
      id: "account-1",
      accountId: "wx-1",
      ownerUserId: "owner-1",
      baseUrl: "https://weixin.example",
      botToken: "token",
      externalUserId: "wx-user",
      status: "connected",
    },
  };
  const bindings = {
    listDueDeliveries: async () => [
      {
        id: "task-1",
        binding_id: "binding-1",
        message_id: "message-1",
        attempts: 2,
      },
    ],
    claimDelivery: async () => true,
    findById: async () => binding,
    finishDelivery: async (...args: any[]) => finished.push(args),
  };
  const messages = {
    findByIdInConversation: async () => ({
      id: "message-1",
      conversationId: "conversation-1",
      role: "assistant",
      contentType: "text",
      content: { text: "hello" },
      status: "sent",
      createdAt: 1,
      updatedAt: 1,
    }),
  };
  const client = {
    sendText: async () => {
      throw new Error("network unavailable");
    },
  };
  const service = new WechatService(
    bindings as any,
    {} as any,
    {} as any,
    messages as any,
    {} as any,
    client as any,
  );
  const before = Date.now();
  await (service as any).processDeliveryBatch();
  assert.equal(finished.length, 1);
  assert.match(finished[0][2], /network unavailable/);
  assert.ok(finished[0][3] >= before + 20_000);
});
