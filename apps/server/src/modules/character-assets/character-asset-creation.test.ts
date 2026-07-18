import assert from "node:assert/strict";
import test from "node:test";
import type { Agent, CharacterAssetDraft } from "@echoo/shared";
import {
  CharacterAssetForbiddenError,
  CharacterAssetService,
} from "./character-asset.service.js";
import { isDeletableCharacterAssetStatus } from "./character-asset.repository.js";

const baseAgent: Agent = {
  id: "agent_personal",
  ownerUserId: "user_1",
  type: "slice-figure",
  name: "Mira",
  attributes: [],
  tags: [],
  introduction: "",
  isPublic: false,
  canPublishAsPublicAsset: true,
  conversationId: "conv_1",
  createdAt: 1,
  updatedAt: 1,
  detail: {
    prologueHtml: "",
    currentSituation: "",
    openingLine: "",
    linkedAgentIds: [],
    persona: "persona",
    background: "background",
    personality: "personality",
    responseStyle: "response",
    systemPrompt: "system",
    memorySummaryPrompt: "memory",
  },
};

test("an agent installed from another creator cannot seed a public asset", async () => {
  const service = new CharacterAssetService(
    {} as never,
    {
      findById: async () => ({
        ...baseAgent,
        canPublishAsPublicAsset: false,
      }),
    } as never,
    {} as never,
    {} as never,
  );

  await assert.rejects(
    service.createDraft("user_1", { copyFromAgentId: baseAgent.id }),
    CharacterAssetForbiddenError,
  );
});

test("one personal conversation can seed multiple independent public drafts", async () => {
  const drafts = new Map<string, CharacterAssetDraft>();
  let sequence = 0;
  const assets = {
    createDraft: async (input: {
      snapshot: CharacterAssetDraft["snapshot"];
    }) => {
      const id = `asset_${++sequence}`;
      drafts.set(id, {
        id,
        author: { id: "user_1", displayName: "Creator" },
        status: "draft",
        snapshot: input.snapshot,
        hasUnpublishedChanges: true,
        createdAt: sequence,
        updatedAt: sequence,
      });
      return id;
    },
    findDraftForAuthor: async (_ownerUserId: string, assetId: string) =>
      drafts.get(assetId) ?? null,
  };
  const service = new CharacterAssetService(
    assets as never,
    { findById: async () => baseAgent } as never,
    { findByPublicPath: async () => null } as never,
    {
      getPlatformFigureDefaults: async () => ({
        version: 1,
        llm: { source: "custom" },
      }),
    } as never,
  );

  const first = await service.createDraft("user_1", {
    copyFromAgentId: baseAgent.id,
  });
  const second = await service.createDraft("user_1", {
    copyFromAgentId: baseAgent.id,
  });

  assert.notEqual(first.id, second.id);
  assert.equal(first.snapshot.name, baseAgent.name);
  assert.equal(second.snapshot.detail.persona, baseAgent.detail.persona);
});

test("unpublished drafts and unlisted assets are deletable", () => {
  assert.equal(isDeletableCharacterAssetStatus("draft"), true);
  assert.equal(isDeletableCharacterAssetStatus("unlisted"), true);
  assert.equal(isDeletableCharacterAssetStatus("published"), false);
});
