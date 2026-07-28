import assert from "node:assert/strict";
import test from "node:test";
import type { Agent } from "@echoo/shared";
import { collectAgentResourceReferences } from "./agent.repository.js";

test("legacy figure definitions provide every durable resource reference", () => {
  const references = collectAgentResourceReferences({
    id: "agent_legacy",
    ownerUserId: "user_installer",
    conversationId: "conv_legacy",
    type: "prime-figure",
    avatarResourcePath: "/api/resources/res_avatar/file",
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
          description: "表情",
        },
      ],
    },
  } as Agent);

  assert.deepEqual(references, [
    {
      resourcePath: "/api/resources/res_avatar/file",
      usageKind: "avatar",
    },
    {
      resourcePath: "/api/resources/res_cover/file",
      usageKind: "cover",
    },
    { resourceId: "res_reference", usageKind: "reference" },
    { resourceId: "res_sticker", usageKind: "sticker" },
  ]);
});
