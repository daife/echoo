import assert from "node:assert/strict";
import test from "node:test";
import type {
  PrimeFigureAgent,
  PrimeFigureState,
  PrimeMessage,
} from "@echoo/shared";
import { buildRuntimeConfigDefaults } from "../../../runtime-config/runtime-config.defaults.js";
import type {
  ResourceRecord,
  ResourceRepository,
} from "../../../resources/resource.repository.js";
import type { PrimeConversationMediaRepository } from "./prime-conversation-media.repository.js";
import {
  buildPrimeChatMessages,
  registerPrimeFigureResources,
} from "./prime-figure-runtime.service.js";

const agent = {
  id: "agent_installed",
  ownerUserId: "user_installer",
  conversationId: "conv_installed",
  type: "prime-figure",
  coverResourcePath: "/api/resources/res_cover/file",
  detail: {
    referenceImages: [
      {
        resourceId: "res_reference",
        resourcePath: "/api/resources/res_reference/file",
        description: "参考图",
      },
    ],
    stickers: [
      {
        resourceId: "res_sticker",
        resourcePath: "/api/resources/res_sticker/file",
        description: "开心",
      },
      {
        resourceId: "res_missing",
        resourcePath: "/api/resources/res_missing/file",
        description: "已丢失",
      },
    ],
  },
} as unknown as PrimeFigureAgent;

test("installed figure resources are resolved through the agent binding", async () => {
  const calls: Array<{ agentId: string; usageKind?: string }> = [];
  const ensured: string[] = [];
  const resources = {
    findAgentResourceByPublicPath: async (
      _ownerUserId: string,
      agentId: string,
      _publicPath: string,
      usageKind?: string,
    ) => {
      calls.push({ agentId, usageKind });
      return resource("res_cover");
    },
    findAgentResourceById: async (
      _ownerUserId: string,
      agentId: string,
      resourceId: string,
      usageKind?: string,
    ) => {
      calls.push({ agentId, usageKind });
      return resourceId === "res_missing" ? null : resource(resourceId);
    },
  } as unknown as ResourceRepository;
  const conversationMedia = {
    ensure: async (input: { resourceId: string }) => {
      ensured.push(input.resourceId);
    },
  } as unknown as PrimeConversationMediaRepository;

  const stickers = await registerPrimeFigureResources({
    ownerUserId: "user_installer",
    agent,
    resources,
    conversationMedia,
  });

  assert.deepEqual(ensured, ["res_cover", "res_reference"]);
  assert.deepEqual(stickers, [
    {
      id: "res_sticker",
      description: "开心",
      resourceUrl: "/api/resources/res_sticker/file",
    },
  ]);
  assert.ok(calls.every((call) => call.agentId === agent.id));
  assert.deepEqual(
    calls.map((call) => call.usageKind),
    ["cover", "reference", "sticker", "sticker"],
  );
});

test("missing installed figure media is omitted without aborting chat setup", async () => {
  const resources = {
    findAgentResourceByPublicPath: async () => null,
    findAgentResourceById: async () => null,
  } as unknown as ResourceRepository;
  const conversationMedia = {
    ensure: async () => {
      assert.fail("unavailable resources must not be registered");
    },
  } as unknown as PrimeConversationMediaRepository;

  const stickers = await registerPrimeFigureResources({
    ownerUserId: "user_installer",
    agent,
    resources,
    conversationMedia,
  });

  assert.deepEqual(stickers, []);
});

test("described historical media does not require the backing resource", async () => {
  let ensureCalls = 0;
  const conversationMedia = {
    ensure: async () => {
      ensureCalls += 1;
      throw new Error(
        "deleted resource must not be read when text is available",
      );
    },
    findByResource: async (
      _ownerUserId: string,
      _conversationId: string,
      resourceId: string,
    ) =>
      resourceId === "res_deleted_stored_voice"
        ? { description: "仅保存在会话媒体中的语音转写" }
        : null,
    listAvailableImages: async () => [],
  } as unknown as PrimeConversationMediaRepository;
  const messages = [
    primeMessage("image", {
      type: "image",
      resourceId: "res_deleted_image",
      resourceUrl: "/api/resources/res_deleted_image/file",
      description: "一张已经完成描述的图片",
      referenceResourceUrls: [],
    }),
    primeMessage("video", {
      type: "video",
      resourceId: "res_deleted_video",
      resourceUrl: "/api/resources/res_deleted_video/file",
      description: "一段已经完成描述的视频",
    }),
    primeMessage("voice", {
      type: "voice",
      resourceId: "res_deleted_voice",
      resourceUrl: "/api/resources/res_deleted_voice/file",
      transcript: "一段已经转写的语音",
    }),
    primeMessage("voice", {
      type: "voice",
      resourceId: "res_deleted_stored_voice",
      resourceUrl: "/api/resources/res_deleted_stored_voice/file",
    }),
  ] as PrimeMessage[];

  const packet = await buildPrimeChatMessages(
    plainAgent,
    plainState,
    messages,
    "end_user_message",
    plainAgent.ownerUserId,
    {} as ResourceRepository,
    conversationMedia,
    0,
    undefined,
    buildRuntimeConfigDefaults().primeFigure,
  );

  assert.equal(ensureCalls, 0);
  assert.deepEqual(packet.pendingMedia, []);
  const content = JSON.stringify(packet.messages[1]?.content);
  assert.match(content, /一张已经完成描述的图片/);
  assert.match(content, /一段已经完成描述的视频/);
  assert.match(content, /一段已经转写的语音/);
  assert.match(content, /仅保存在会话媒体中的语音转写/);
});

function resource(id: string): ResourceRecord {
  return {
    id,
    ownerUserId: "user_author",
    kind: "prime_figure_reference",
    mimeType: "image/jpeg",
    originalFileName: `${id}.jpg`,
    storageProvider: "local",
    storageKey: `user_author/${id}/original.jpg`,
    publicPath: `/api/resources/${id}/file`,
    status: "ready",
    createdAt: 1,
  };
}

const plainAgent = {
  id: "agent_plain",
  ownerUserId: "user_plain",
  conversationId: "conv_plain",
  type: "prime-figure",
  name: "测试角色",
  detail: {
    prologueHtml: "",
    linkedAgentIds: [],
    persona: "测试人设",
    background: "测试背景",
    personality: "测试性格",
    responseStyle: "简洁",
    decisionStyle: "谨慎",
    currentSituation: "测试中",
    schedule: { segments: [] },
    itinerary: "",
    variableDefinitions: [],
    referenceImages: [],
    stickers: [],
    initialMood: "平静",
    initialRelationshipStatus: "朋友",
  },
} as unknown as PrimeFigureAgent;

const plainState: PrimeFigureState = {
  variables: {},
  memories: [],
  currentSituation: "测试中",
  schedule: { segments: [] },
  itinerary: "",
  mood: "平静",
  moodObservedAtMs: 0,
  relationshipStatus: "朋友",
  updatedAt: 0,
};

function primeMessage(
  messageType: "image" | "video" | "voice",
  content: PrimeMessage["content"],
): PrimeMessage {
  return {
    id: `msg_${messageType}`,
    sequence: 1,
    ownerUserId: plainAgent.ownerUserId,
    agentId: plainAgent.id,
    conversationId: plainAgent.conversationId,
    sender: "prime_figure",
    messageType,
    content,
    occurredAtMs: 1,
    occurredAtIso: new Date(1).toISOString(),
    createdAt: 1,
    updatedAt: 1,
  };
}
