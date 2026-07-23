import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrimeWorldApi } from "@echoo/api-client";
import type { PrimeWorldRuntimeState } from "@echoo/shared";
import { PrimeWorldService } from "./PrimeWorldService";
import { primeWorldLocalCache } from "./primeWorldLocalCache";

const state: PrimeWorldRuntimeState = {
  schemaVersion: 1,
  variables: {},
  view: { revision: 1, root: { id: "text", type: "text", text: "cached" } },
  summaries: {},
  updatedAt: 1,
};

beforeEach(() => vi.restoreAllMocks());

describe("PrimeWorldService", () => {
  it("dispatches once without polling the run endpoint", async () => {
    const dispatch = vi.fn(async () => ({
      run: {
        id: "run_1",
        eventId: "event_1",
        conversationId: "conversation_1",
        definitionRevision: 1,
        status: "queued" as const,
        createdAt: 1,
      },
    }));
    const getRun = vi.fn();
    const service = new PrimeWorldService({
      dispatch,
      getRun,
    } as unknown as PrimeWorldApi);

    const run = await service.dispatch("conversation_1", {
      clientEventId: "client_1",
      type: "world.start",
    });

    expect(run.id).toBe("run_1");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(getRun).not.toHaveBeenCalled();
  });

  it("falls back to a cached terminal snapshot and marks it read-only", async () => {
    vi.spyOn(primeWorldLocalCache, "getSnapshot").mockResolvedValue({
      state,
      stateVersion: 4,
      run: {
        id: "run_1",
        eventId: "event_1",
        conversationId: "conversation_1",
        definitionRevision: 1,
        status: "running",
        createdAt: 1,
      },
    });
    const service = new PrimeWorldService({
      getSnapshot: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as PrimeWorldApi);
    service.configureSession("user_1");

    const snapshot = await service.getSnapshot("conversation_1");

    expect(snapshot.cached).toBe(true);
    expect(snapshot.run).toBeUndefined();
    expect(snapshot.state.view.root).toEqual(state.view.root);
  });
});
