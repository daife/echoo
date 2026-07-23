import assert from "node:assert/strict";
import test from "node:test";
import { fogHarborLettersFixture } from "@echoo/shared";
import type { PublicAssetSnapshot } from "@echoo/shared/public-assets";
import { reconcileInstalledPrimeRuntimeState } from "./public-asset.repository.js";
import { assessWorldProgressCompatibility } from "./public-asset.service.js";

test("prime installation updates reset author-controlled runtime fields", () => {
  const snapshot: PublicAssetSnapshot = {
    type: "prime-figure",
    name: "新版角色",
    attributes: [],
    tags: [],
    introduction: "",
    detail: {
      prologueHtml: "",
      linkedAgentIds: [],
      persona: "新版人设",
      background: "新版背景",
      personality: "新版性格",
      responseStyle: "新版回复风格",
      decisionStyle: "",
      currentSituation: "新版情境",
      schedule: { segments: [] },
      itinerary: "新版行程",
      variableDefinitions: [
        {
          key: "affinity",
          label: "好感度",
          type: "number",
          description: "",
          defaultValue: 10,
        },
        {
          key: "note",
          label: "备注",
          type: "string",
          description: "",
        },
      ],
      referenceImages: [],
      stickers: [],
      initialMood: "平静",
      initialRelationshipStatus: "初识",
    },
  };
  const memories = [
    { id: "memory_1", content: "保留", eventAtMs: 1, recordedAtMs: 2 },
  ];

  const result = reconcileInstalledPrimeRuntimeState(
    {
      variables: { affinity: 99, removed: true },
      memories,
      currentSituation: "旧情境",
      schedule: { segments: [{ label: "旧日程" }] },
      itinerary: "旧行程",
      mood: "旧情绪",
      relationshipStatus: "旧关系",
      lastFigureActivityAtMs: 50,
    },
    snapshot,
    100,
  );

  assert.deepEqual(result.variables, { affinity: 10, note: null });
  assert.equal(result.currentSituation, "新版情境");
  assert.deepEqual(result.schedule, { segments: [] });
  assert.equal(result.itinerary, "新版行程");
  assert.equal(result.mood, "平静");
  assert.equal(result.relationshipStatus, "初识");
  assert.equal(result.moodObservedAtMs, 100);
  assert.equal(result.updatedAt, 100);
  assert.equal(result.memories, memories);
  assert.equal(result.lastFigureActivityAtMs, 50);
});

test("world progress compatibility requires a schema-compatible current state", () => {
  const snapshot: Extract<PublicAssetSnapshot, { type: "prime-world" }> = {
    type: "prime-world",
    name: "雾港来信",
    attributes: [],
    tags: [],
    introduction: "",
    detail: structuredClone(fogHarborLettersFixture),
  };

  assert.deepEqual(
    assessWorldProgressCompatibility(snapshot, {
      variables: structuredClone(fogHarborLettersFixture.initialState),
    }),
    { canPreserve: true },
  );
  assert.equal(
    assessWorldProgressCompatibility(snapshot, {
      variables: { story: { stageId: "unknown" } },
    }).canPreserve,
    false,
  );

  snapshot.detail.stateSchema = undefined;
  const noSchema = assessWorldProgressCompatibility(snapshot, {
    variables: structuredClone(fogHarborLettersFixture.initialState),
  });
  assert.equal(noSchema.canPreserve, false);
  assert.match(noSchema.reason ?? "", /没有声明状态结构/);
});
