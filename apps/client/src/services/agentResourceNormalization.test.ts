import { describe, expect, it } from "vitest";
import type { Agent } from "@echoo/shared";
import { AgentsApi, type ApiClient } from "@echoo/api-client";

describe("agent resource normalization", () => {
  it("keeps legacy prime figures that do not have referenceImages", async () => {
    const legacyAgent = {
      id: "agent_legacy",
      ownerUserId: "user_1",
      type: "prime-figure",
      name: "Legacy",
      attributes: [],
      tags: [],
      introduction: "",
      isPublic: false,
      conversationId: "conv_legacy",
      createdAt: 1,
      updatedAt: 1,
      detail: {
        prologueHtml: "",
        linkedAgentIds: [],
        persona: "persona",
        background: "background",
        personality: "personality",
        responseStyle: "response style",
        decisionStyle: "",
        currentSituation: "",
        schedule: { segments: [] },
        itinerary: "",
        variableDefinitions: [],
      },
    } as unknown as Agent;
    const client = {
      get: async () => [legacyAgent],
      resolveServerPath: (path?: string) => path,
    } as unknown as ApiClient;

    const [normalized] = await new AgentsApi(client).listMyAgents();

    expect(normalized?.type).toBe("prime-figure");
    if (normalized?.type !== "prime-figure") throw new Error("wrong type");
    expect(normalized.detail.referenceImages).toEqual([]);
  });
});
