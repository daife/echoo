import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultPrimeWorldDetail, type Agent } from "@echoo/shared";
import type { PublicAssetDraft } from "@echoo/shared/public-assets";
import {
  PublicAssetForbiddenError,
  PublicAssetService,
} from "./public-asset.service.js";
import { isDeletablePublicAssetStatus } from "./public-asset.repository.js";
import { buildRuntimeConfigDefaults } from "../runtime-config/runtime-config.defaults.js";

const baseAgent: Agent = {
  id: "agent_personal",
  ownerUserId: "user_1",
  type: "slice-figure",
  name: "Mira",
  attributes: [],
  tags: [],
  introduction: "",
  isPublic: false,
  origin: { kind: "original" },
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

for (const [label, assetId] of [
  ["another creator's public character", "asset_other"],
  ["the owner's own public character", "asset_own"],
  ["a public character whose source is no longer available", "asset_deleted"],
] as const) {
  test(`a conversation installed from ${label} cannot seed a public asset`, async () => {
    const service = new PublicAssetService(
      {} as never,
      {
        findById: async () => ({
          ...baseAgent,
          origin: { kind: "public-asset", assetId },
        }),
      } as never,
      {} as never,
      {} as never,
    );

    await assert.rejects(
      service.createDraft("user_1", {
        importFromOriginalAgentId: baseAgent.id,
      }),
      PublicAssetForbiddenError,
    );
  });
}

test("one personal conversation can seed multiple independent public drafts", async () => {
  const drafts = new Map<string, PublicAssetDraft>();
  let sequence = 0;
  const assets = {
    createDraft: async (input: {
      snapshot: PublicAssetDraft["snapshot"];
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
  const service = new PublicAssetService(
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
    importFromOriginalAgentId: baseAgent.id,
  });
  const second = await service.createDraft("user_1", {
    importFromOriginalAgentId: baseAgent.id,
  });

  assert.notEqual(first.id, second.id);
  assert.equal(first.snapshot.name, baseAgent.name);
  assert.equal(
    second.snapshot.type === "slice-figure"
      ? second.snapshot.detail.persona
      : undefined,
    baseAgent.type === "slice-figure" ? baseAgent.detail.persona : undefined,
  );
});

test("new public drafts do not include a runtime recommendation by default", async () => {
  const recommendations: unknown[] = [];
  let draft: PublicAssetDraft | undefined;
  const assets = {
    createDraft: async (input: {
      snapshot: PublicAssetDraft["snapshot"];
      recommendedRuntimeConfig: unknown;
    }) => {
      recommendations.push(input.recommendedRuntimeConfig);
      draft = {
        id: `asset_${recommendations.length}`,
        author: { id: "user_1", displayName: "Creator" },
        status: "draft",
        snapshot: input.snapshot,
        hasUnpublishedChanges: true,
        createdAt: 1,
        updatedAt: 1,
      };
      return draft.id;
    },
    findDraftForAuthor: async () => draft ?? null,
  };
  const service = new PublicAssetService(
    assets as never,
    { findById: async () => baseAgent } as never,
    { findByPublicPath: async () => null } as never,
    {
      getPlatformFigureDefaults: async () => {
        throw new Error(
          "defaults should only be loaded after enabling recommendations",
        );
      },
    } as never,
  );

  await service.createDraft("user_1", { type: "slice-figure" });
  await service.createDraft("user_1", {
    importFromOriginalAgentId: baseAgent.id,
  });

  assert.deepEqual(recommendations, [null, null]);
});

test("unpublished drafts and unlisted assets are deletable", () => {
  assert.equal(isDeletablePublicAssetStatus("draft"), true);
  assert.equal(isDeletablePublicAssetStatus("unlisted"), true);
  assert.equal(isDeletablePublicAssetStatus("published"), false);
});

test("creates a runnable prime-world public draft from the default fixture", async () => {
  let draft: PublicAssetDraft | undefined;
  const assets = {
    createDraft: async (input: { snapshot: PublicAssetDraft["snapshot"] }) => {
      draft = {
        id: "asset_world",
        author: { id: "user_1", displayName: "Creator" },
        status: "draft",
        snapshot: input.snapshot,
        hasUnpublishedChanges: true,
        createdAt: 1,
        updatedAt: 1,
      };
      return draft.id;
    },
    findDraftForAuthor: async () => draft ?? null,
  };
  const service = new PublicAssetService(
    assets as never,
    {} as never,
    {} as never,
    {
      getPlatformFigureDefaults: async () =>
        buildRuntimeConfigDefaults().primeWorld,
    } as never,
  );
  const created = await service.createDraft("user_1", { type: "prime-world" });
  assert.equal(created.snapshot.type, "prime-world");
  if (created.snapshot.type === "prime-world") {
    assert.ok(created.snapshot.detail.workflow.nodes.length > 0);
    assert.ok(created.snapshot.detail.workflow.edges.length > 0);
    assert.deepEqual(created.snapshot.detail.workflow.editor.positions.start, {
      x: 40,
      y: 20,
    });
  }
});

test("applies a resource-bearing bundle to a prime-world public draft", async () => {
  const detail = createDefaultPrimeWorldDetail();
  const draft: PublicAssetDraft = {
    id: "asset_world",
    author: { id: "user_1", displayName: "Creator" },
    status: "draft",
    snapshot: {
      type: "prime-world",
      name: "旧世界",
      attributes: [],
      tags: [],
      introduction: "",
      detail,
    },
    hasUnpublishedChanges: true,
    createdAt: 1,
    updatedAt: 1,
  };
  const assets = {
    findDraftForAuthor: async () => draft,
    saveDraft: async (input: { snapshot: PublicAssetDraft["snapshot"] }) => {
      draft.snapshot = input.snapshot;
    },
  };
  const resources = {
    savePrimeWorldBundleResource: async () => ({
      id: "resource-saved",
      publicPath: "/resources/saved.png",
    }),
    findById: async () => ({
      id: "resource-saved",
      ownerUserId: "user_1",
      publicPath: "/resources/saved.png",
    }),
    deleteOwnedByPublicPath: async () => undefined,
  };
  const service = new PublicAssetService(
    assets as never,
    {} as never,
    resources as never,
    {} as never,
  );
  const importedDetail = createDefaultPrimeWorldDetail();
  importedDetail.presentation.startView.background = {
    resourceId: "bundle:resource-1",
  };
  const saved = await service.saveDraftBundle("user_1", draft.id, {
    format: "echoo-prime-world",
    formatVersion: 1,
    name: "新世界",
    attributes: [{ key: "时代", value: "未来" }],
    tags: ["冒险"],
    introduction: "bundle 世界",
    isPublic: false,
    detail: importedDetail,
    resources: [{
      key: "resource-1",
      usageKind: "world",
      mimeType: "image/png",
      fileName: "saved.png",
      dataBase64: "AA==",
    }],
  });
  assert.equal(saved.snapshot.name, "新世界");
  assert.deepEqual(saved.snapshot.tags, ["冒险"]);
  assert.equal(
    saved.snapshot.type === "prime-world"
      ? saved.snapshot.detail.presentation.startView.background?.resourceId
      : undefined,
    "resource-saved",
  );
});

test("rejects applying a world bundle to another public asset type", async () => {
  const service = new PublicAssetService(
    {
      findDraftForAuthor: async () => ({
        id: "asset_figure",
        snapshot: { type: "slice-figure" },
      }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(
    service.saveDraftBundle("user_1", "asset_figure", {}),
    PublicAssetForbiddenError,
  );
});
