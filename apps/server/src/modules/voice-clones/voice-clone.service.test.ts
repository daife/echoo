import assert from "node:assert/strict";
import test from "node:test";
import { VoiceCloneQuotaError, VoiceCloneService } from "./voice-clone.service.js";

const storedClone = {
  id: "vclone_1",
  name: "旁白",
  description: "自然",
  referenceId: "voice_ref",
  state: "trained" as const,
  consentConfirmedAt: 1,
  createdAt: 1,
  updatedAt: 1,
};

test("creating a clone persists the Fish reference and always removes its sample", async () => {
  const calls: string[] = [];
  const service = new VoiceCloneService(
    {
      reserve: async () => ({ id: "vclone_1" }),
      complete: async (_id: string, referenceId: string, state: string) => {
        calls.push(`complete:${referenceId}:${state}`);
        return storedClone;
      },
      release: async () => undefined,
    } as never,
    {
      readForOwner: async () => ({
        record: {
          kind: "voice_clone_sample",
          status: "ready",
          mimeType: "audio/mpeg",
          durationSeconds: 30,
        },
        data: Buffer.from("sample"),
      }),
      deleteOrphanedResource: async (id: string) => {
        calls.push(`delete-sample:${id}`);
        return true;
      },
    } as never,
    {
      create: async () => ({ referenceId: "voice_ref", state: "trained" as const }),
      delete: async () => undefined,
    } as never,
  );

  assert.deepEqual(
    await service.create("user_1", {
      name: "旁白",
      description: "自然",
      sampleResourceId: "res_1",
      consentConfirmed: true,
    }),
    storedClone,
  );
  assert.deepEqual(calls, ["complete:voice_ref:trained", "delete-sample:res_1"]);
});

test("the five-clone quota rejects creation before calling Fish", async () => {
  let calledFish = false;
  const service = new VoiceCloneService(
    { reserve: async () => null } as never,
    {
      readForOwner: async () => ({
        record: {
          kind: "voice_clone_sample",
          status: "ready",
          mimeType: "audio/mpeg",
          durationSeconds: 30,
        },
        data: Buffer.from("sample"),
      }),
      deleteOrphanedResource: async () => true,
    } as never,
    {
      create: async () => {
        calledFish = true;
        return { referenceId: "unused", state: "trained" as const };
      },
    } as never,
  );

  await assert.rejects(
    service.create("user_1", {
      name: "旁白",
      sampleResourceId: "res_1",
      consentConfirmed: true,
    }),
    VoiceCloneQuotaError,
  );
  assert.equal(calledFish, false);
});

test("deleting a clone removes the upstream model before the local row", async () => {
  const calls: string[] = [];
  const service = new VoiceCloneService(
    {
      findForOwner: async () => storedClone,
      deleteForOwner: async () => {
        calls.push("local");
        return true;
      },
    } as never,
    {} as never,
    {
      delete: async (referenceId: string) => calls.push(`fish:${referenceId}`),
    } as never,
  );
  await service.delete("user_1", "vclone_1");
  assert.deepEqual(calls, ["fish:voice_ref", "local"]);
});
