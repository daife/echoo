import assert from "node:assert/strict";
import test from "node:test";
import type { PrimeFigureAgent } from "@echoo/shared";
import type {
  ResourceRecord,
  ResourceRepository,
} from "../../../resources/resource.repository.js";
import type { PrimeConversationMediaRepository } from "./prime-conversation-media.repository.js";
import { registerPrimeFigureResources } from "./prime-figure-runtime.service.js";

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
} as PrimeFigureAgent;

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
