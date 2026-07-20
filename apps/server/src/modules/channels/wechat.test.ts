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
  const replacement = encrypted.startsWith("A") ? "B" : "A";
  assert.throws(() => decryptToken(`${replacement}${encrypted.slice(1)}`));
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
    assert.equal(
      (request?.headers as Record<string, string>).AuthorizationType,
      "ilink_bot_token",
    );
    assert.equal(
      (request?.headers as Record<string, string>)["iLink-App-Id"],
      "bot",
    );
    assert.match(
      (request?.headers as Record<string, string>)["X-WECHAT-UIN"],
      /^[A-Za-z0-9+/]+={0,2}$/,
    );
    const body = JSON.parse(String(request?.body));
    assert.equal(body.msg.to_user_id, "user-1");
    assert.equal(body.msg.item_list[0].text_item.text, "hello");
    assert.equal(body.base_info.channel_version, "0.1.0");
    assert.equal(body.base_info.bot_agent, "Echoo/0.1.0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wechat login renders the returned login content as a QR code image", async () => {
  const originalFetch = globalThis.fetch;
  const loginContent = "https://liteapp.weixin.qq.com/q/example?qrcode=token";
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return new Response(
      JSON.stringify({
        ret: 0,
        qrcode: "status-token",
        qrcode_img_content: loginContent,
      }),
    );
  };
  try {
    const result = await new WechatClient().startLogin(
      "https://weixin.example",
    );
    assert.match(result.qrcodeUrl ?? "", /^data:image\/png;base64,/);
    const image = Buffer.from(result.qrcodeUrl!.split(",", 2)[1], "base64");
    assert.deepEqual(
      image.subarray(0, 8),
      Buffer.from("89504e470d0a1a0a", "hex"),
    );
    assert.equal(request?.method, "POST");
    assert.equal(
      (request?.headers as Record<string, string>).AuthorizationType,
      "ilink_bot_token",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wechat polls QR status with GET and stores upstream login fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (calls.length === 1)
      return new Response(
        JSON.stringify({ qrcode: "status-token", qrcode_img_content: "https://q.example" }),
      );
    if (calls.length === 2)
      return new Response(
        JSON.stringify({ status: "scaned_but_redirect", redirect_host: "redirect.example" }),
      );
    return new Response(
      JSON.stringify({
        status: "confirmed",
        bot_token: "bot-token",
        ilink_bot_id: "bot-id",
        ilink_user_id: "wx-user",
        baseurl: "https://api.example",
      }),
    );
  };
  try {
    const client = new WechatClient();
    const login = await client.startLogin("https://weixin.example");
    assert.equal((await client.pollLogin(login.attemptId))?.status, "wait");
    const connected = await client.pollLogin(login.attemptId);
    assert.equal(calls[1].init?.method, "GET");
    assert.equal(calls[2].url, "https://redirect.example/ilink/bot/get_qrcode_status?qrcode=status-token");
    assert.equal(connected?.status, "connected");
    assert.deepEqual(connected?.account, {
      accountId: "bot-id",
      botToken: "bot-token",
      baseUrl: "https://api.example",
      externalUserId: "wx-user",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wechat getupdates includes authenticated upstream metadata and surfaces ret failures", async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return new Response(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: "next" }));
  };
  try {
    const response = await new WechatClient().getUpdates(
      { baseUrl: "https://weixin.example", botToken: "token" },
      "cursor",
    );
    assert.equal(response.get_updates_buf, "next");
    assert.equal(
      (request?.headers as Record<string, string>).Authorization,
      "Bearer token",
    );
    assert.equal(
      (request?.headers as Record<string, string>).AuthorizationType,
      "ilink_bot_token",
    );
    assert.deepEqual(JSON.parse(String(request?.body)), {
      get_updates_buf: "cursor",
      base_info: { channel_version: "0.1.0", bot_agent: "Echoo/0.1.0" },
    });
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ret: -1, errmsg: "invalid token" }));
    await assert.rejects(
      () =>
        new WechatClient().getUpdates(
          { baseUrl: "https://weixin.example", botToken: "token" },
          "cursor",
        ),
      /ret=-1: invalid token/,
    );
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
    const uploadBody = JSON.parse(String(calls[0].init?.body));
    const image = sendBody.msg.item_list[0].image_item;
    assert.equal(image.media.encrypt_query_param, "download-token");
    assert.equal(sendBody.msg.message_type, 2);
    assert.equal(sendBody.msg.message_state, 2);
    assert.equal(uploadBody.base_info.bot_agent, "Echoo/0.1.0");
    assert.equal(
      (calls[0].init?.headers as Record<string, string>).AuthorizationType,
      "ilink_bot_token",
    );
    const key = Buffer.from(
      Buffer.from(image.media.aes_key, "base64").toString("utf8"),
      "hex",
    );
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

test("wechat serializes concurrent deliveries for one conversation", async () => {
  const sent: string[] = [];
  const binding = {
    id: "binding-1",
    ownerUserId: "owner-1",
    conversationId: "conversation-1",
    account: { externalUserId: "wx-user" },
  };
  const service = new WechatService(
    {
      findByConversation: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return binding;
      },
      createDeliveryTask: async () => true,
      finishDelivery: async () => undefined,
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {
      sendText: async (_account: unknown, _to: string, text: string) => {
        sent.push(text);
      },
    } as any,
  );
  const first = {
    id: "msg_11111111-1111-4111-8111-111111111111",
    conversationId: "conversation-1",
    role: "assistant",
    contentType: "text",
    content: { text: "first" },
  };
  const second = {
    id: "msg_22222222-2222-4222-8222-222222222222",
    conversationId: "conversation-1",
    role: "assistant",
    contentType: "text",
    content: { text: "second" },
  };
  await Promise.all([
    service.deliver(first as any),
    service.deliver(second as any),
  ]);
  assert.deepEqual(sent, ["first", "second"]);
});

test("wechat only creates stable text or image messages from its bound user", async () => {
  const textMessages: any[] = [];
  const imageMessages: any[] = [];
  const logs: any[] = [];
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args);
  const service = new WechatService(
    {} as any,
    {} as any,
    {
      createUserTextMessage: async (input: any) => textMessages.push(input),
      createUserMediaMessage: async (input: any) => imageMessages.push(input),
    } as any,
    {} as any,
    {} as any,
    {
      downloadImage: async () => Buffer.from("89504e470d0a1a0a", "hex"),
    } as any,
  );
  const binding = {
    id: "binding-1",
    ownerUserId: "owner-1",
    conversationId: "conversation-1",
    account: { externalUserId: "wx-user" },
  };
  try {
    await (service as any).handleInbound(binding, {
      message_id: 9,
      from_user_id: "wx-user",
      item_list: [{ type: 1, text_item: { text: " hello " } }],
    });
    await (service as any).handleInbound(binding, {
      message_id: 9,
      from_user_id: "wx-user",
      item_list: [{ type: 1, text_item: { text: " hello " } }],
    });
    await (service as any).handleInbound(binding, {
      message_id: 10,
      from_user_id: "wx-user",
      item_list: [{ type: 2, image_item: { media: { full_url: "https://cdn.example/image" } } }],
    });
    await (service as any).handleInbound(binding, {
      message_id: 11,
      from_user_id: "other-user",
      item_list: [{ type: 1, text_item: { text: "blocked" } }],
    });
    await (service as any).handleInbound(binding, {
      message_id: 12,
      from_user_id: "wx-user",
      item_list: [{ type: 3 }],
    });
    assert.equal(textMessages.length, 2);
    assert.deepEqual(textMessages.map((input) => input.clientMessageId), [
      "wechat:9",
      "wechat:9",
    ]);
    assert.equal(imageMessages.length, 1);
    assert.equal(imageMessages[0].clientMessageId, "wechat:10");
    assert.equal(imageMessages[0].upload.fileName, "wechat-10.png");
    assert.equal(logs.length, 2);
  } finally {
    console.warn = originalWarn;
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
