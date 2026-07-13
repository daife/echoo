import { describe, expect, it } from "vitest";
import type { PrimeFigureEditSnapshot } from "@echoo/shared";
import { primeFormToUpdate, primeSnapshotToForm } from "./MessagesPage";

describe("prime figure edit form adapters", () => {
  it("prefills mutable fields from the latest runtime state", () => {
    const snapshot = {
      agent: {
        id: "agent_1",
        ownerUserId: "user_1",
        type: "prime-figure",
        name: "Mira",
        attributes: [],
        tags: [],
        introduction: "",
        isPublic: false,
        conversationId: "conv_1",
        createdAt: 1,
        updatedAt: 2,
        detail: {
          prologueHtml: "",
          linkedAgentIds: [],
          persona: "人设",
          background: "背景",
          personality: "性格",
          responseStyle: "风格",
          decisionStyle: "决策",
          currentSituation: "最新处境",
          schedule: { segments: [] },
          itinerary: "最新行程",
          variableDefinitions: [
            {
              key: "trust",
              label: "信任",
              type: "number",
              description: "信任程度",
              defaultValue: 10,
            },
          ],
          referenceImages: [
            {
              resourceId: "res_1",
              resourcePath: "https://example.com/res_1",
              description: "日常外观",
            },
          ],
        },
      },
      state: {
        variables: { trust: 83 },
        mood: "开心",
        relationshipStatus: "稳定",
      },
    } satisfies PrimeFigureEditSnapshot;

    const form = primeSnapshotToForm(snapshot);
    expect(form.variableDefinitions?.[0]?.defaultValue).toBe(83);
    expect(form.initialMood).toBe("开心");
    expect(form.initialRelationshipStatus).toBe("稳定");
    expect(form.currentSituation).toBe("最新处境");
    expect(form.referenceImages).toEqual([
      { resourceId: "res_1", description: "日常外观" },
    ]);
  });

  it("maps the shared form back to explicit current-state update fields", () => {
    const update = primeFormToUpdate({
      type: "prime-figure",
      name: "Mira",
      isPublic: false,
      persona: "人设",
      background: "背景",
      personality: "性格",
      responseStyle: "风格",
      variableDefinitions: [
        {
          key: "trust",
          label: "信任",
          type: "number",
          description: "信任程度",
          defaultValue: 91,
        },
      ],
      initialMood: "专注",
      initialRelationshipStatus: "亲密",
    });

    expect(update.currentVariables).toEqual({ trust: 91 });
    expect(update.currentMood).toBe("专注");
    expect(update.currentRelationshipStatus).toBe("亲密");
  });
});
