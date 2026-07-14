import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeConfigDefaults } from "./runtime-config.defaults.js";
import {
  RuntimeConfigNotFoundError,
  RuntimeConfigService,
  RuntimeConfigValidationError,
} from "./runtime-config.service.js";
import type {
  StoredFigureRuntimeConfig,
  StoredUserRuntimeConfig,
} from "./runtime-config.types.js";

test("missing configs use safe defaults and ignore environment values", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModel = process.env.DEFAULT_TEXT_MODEL;
  process.env.OPENROUTER_API_KEY = "secret-from-env";
  process.env.DEFAULT_TEXT_MODEL = "environment-model";
  try {
    const repository = new MemoryRuntimeConfigRepository();
    const service = createService(repository);
    const view = await service.getUserConfig("user_1");

    assert.equal(view.sliceFigure.llm.apiKey.configured, false);
    assert.equal(view.sliceFigure.llm.model, "openai/gpt-4o-mini");
    assert.doesNotMatch(JSON.stringify(view), /secret-from-env/);
    assert.doesNotMatch(
      JSON.stringify(repository.userConfig),
      /environment-model/,
    );
  } finally {
    restore("OPENROUTER_API_KEY", previousKey);
    restore("DEFAULT_TEXT_MODEL", previousModel);
  }
});

test("new-user initialization never copies environment API keys", async () => {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousFishKey = process.env.FISH_AUDIO_API_KEY;
  process.env.OPENROUTER_API_KEY = "server-openrouter-secret";
  process.env.FISH_AUDIO_API_KEY = "server-fish-secret";
  try {
    const repository = new MemoryRuntimeConfigRepository();
    const service = createService(repository);
    await service.initializeUserConfig("user_1");

    assert.equal(repository.userConfig?.sliceFigure.llm.apiKey, "");
    assert.equal(repository.userConfig?.primeFigure.decisionModel.apiKey, "");
    assert.equal(
      repository.userConfig?.primeFigure.outputs.image.generator.apiKey,
      "",
    );
    assert.equal(
      repository.userConfig?.primeFigure.outputs.voice.tts.apiKey,
      "",
    );
    assert.doesNotMatch(
      JSON.stringify(repository.userConfig),
      /server-(openrouter|fish)-secret/,
    );
  } finally {
    restore("OPENROUTER_API_KEY", previousOpenRouterKey);
    restore("FISH_AUDIO_API_KEY", previousFishKey);
  }
});

test("prime v3 defaults keep wakeups disabled", () => {
  const prime = buildRuntimeConfigDefaults().primeFigure;
  assert.equal(prime.version, 3);
  assert.equal(prime.outputs.image.enabled, true);
  assert.equal(prime.outputs.voice.enabled, true);
  assert.equal(prime.outputs.image.guidanceLevel, "medium");
  assert.equal(prime.outputs.voice.guidanceLevel, "medium");
  assert.equal(prime.optimization.image.enabled, false);
  assert.equal(prime.optimization.voice.enabled, false);
  assert.equal(prime.understanding.visual.mode, "native");
  assert.equal(prime.understanding.audio.mode, "native");
  assert.deepEqual(prime.wakeups, {
    proactive: {
      enabled: false,
      interactionInvalidationWindowMinutes: 10,
    },
    passive: { enabled: false, milestonesMinutes: [15, 180, 1_440] },
  });
});

test("legacy prime v2 configs are normalized with disabled wakeups", async () => {
  const repository = new MemoryRuntimeConfigRepository();
  const legacy = buildRuntimeConfigDefaults();
  delete (legacy.primeFigure as any).wakeups;
  (legacy.primeFigure as any).version = 2;
  repository.userConfig = legacy;

  const view = await createService(repository).getUserConfig("user_1");

  assert.equal(view.primeFigure.version, 3);
  assert.equal(view.primeFigure.wakeups.proactive.enabled, false);
  assert.equal(view.primeFigure.wakeups.passive.enabled, false);
  assert.equal(repository.userConfig?.primeFigure.version, 3);
});

test("prime dependent model features cannot outlive their output capability", async () => {
  const repository = new MemoryRuntimeConfigRepository();
  repository.userConfig = buildRuntimeConfigDefaults();
  const service = createService(repository);
  await assert.rejects(
    service.updateUserConfig("user_1", {
      primeFigure: {
        outputs: { image: { enabled: false } },
        optimization: { image: { enabled: true } },
      },
    }),
    RuntimeConfigValidationError,
  );
});

test("passive wakeup milestones must be strictly increasing", async () => {
  const repository = new MemoryRuntimeConfigRepository();
  repository.userConfig = buildRuntimeConfigDefaults();
  await assert.rejects(
    createService(repository).updateUserConfig("user_1", {
      primeFigure: {
        wakeups: { passive: { milestonesMinutes: [15, 10, 1_440] } },
      },
    }),
    RuntimeConfigValidationError,
  );
});

test("disabling global wakeups clears only the disabled capability state", async () => {
  const repository = new MemoryRuntimeConfigRepository();
  repository.userConfig = buildRuntimeConfigDefaults();
  repository.userConfig.primeFigure.wakeups.proactive.enabled = true;
  repository.userConfig.primeFigure.wakeups.passive.enabled = true;
  const calls: unknown[] = [];
  const service = createService(repository, {
    async clearDisabledWakeupsForOwner(input: unknown) {
      calls.push(input);
    },
    async clearDisabledWakeupsForConversation() {},
  });

  await service.updateUserConfig("user_1", {
    primeFigure: { wakeups: { proactive: { enabled: false } } },
  });

  assert.deepEqual(calls, [
    { ownerUserId: "user_1", proactive: true, passive: false },
  ]);
});

test("secret patches retain, replace, and clear without exposing raw values", async () => {
  const repository = new MemoryRuntimeConfigRepository();
  repository.userConfig = buildRuntimeConfigDefaults();
  repository.userConfig.sliceFigure.llm.apiKey = "initial-secret";
  const service = createService(repository);

  await service.updateUserConfig("user_1", {
    sliceFigure: { llm: { model: "next-model" } },
  });
  assert.equal(repository.userConfig.sliceFigure.llm.apiKey, "initial-secret");

  const replaced = await service.updateUserConfig("user_1", {
    sliceFigure: { llm: { apiKey: "replacement-key" } },
  });
  assert.equal(repository.userConfig.sliceFigure.llm.apiKey, "replacement-key");
  assert.equal(replaced.sliceFigure.llm.apiKey.masked, "••••-key");

  const cleared = await service.updateUserConfig("user_1", {
    sliceFigure: { llm: { apiKey: null } },
  });
  assert.equal(repository.userConfig.sliceFigure.llm.apiKey, "");
  assert.deepEqual(cleared.sliceFigure.llm.apiKey, { configured: false });
});

test("global mode follows live user config while custom mode remains isolated", async () => {
  const repository = new MemoryRuntimeConfigRepository();
  repository.userConfig = buildRuntimeConfigDefaults();
  repository.userConfig.sliceFigure.llm.model = "global-a";
  const service = createService(repository);

  assert.equal(
    (await service.getConversationConfig("user_1", "conversation_1")).mode,
    "global",
  );
  const custom = await service.updateConversationConfig(
    "user_1",
    "conversation_1",
    { mode: "custom" },
  );
  assert.equal((custom.config as any).llm.model, "global-a");

  await service.updateUserConfig("user_1", {
    sliceFigure: { llm: { model: "global-b" } },
  });
  assert.equal(
    (
      (await service.getConversationConfig("user_1", "conversation_1"))
        .config as any
    ).llm.model,
    "global-a",
  );

  await service.updateConversationConfig("user_1", "conversation_1", {
    mode: "custom",
    config: { llm: { model: "custom-c" } },
  });
  assert.equal(
    (
      await service.updateConversationConfig("user_1", "conversation_1", {
        mode: "global",
      })
    ).config &&
      (
        (await service.getConversationConfig("user_1", "conversation_1"))
          .config as any
      ).llm.model,
    "global-b",
  );
  assert.equal(
    (
      await service.updateConversationConfig("user_1", "conversation_1", {
        mode: "custom",
      })
    ).config &&
      (
        (await service.getConversationConfig("user_1", "conversation_1"))
          .config as any
      ).llm.model,
    "custom-c",
  );
});

test("conversation config access is owner-scoped", async () => {
  const repository = new MemoryRuntimeConfigRepository();
  repository.userConfig = buildRuntimeConfigDefaults();
  const service = createService(repository);
  await assert.rejects(
    service.getConversationConfig("user_2", "conversation_1"),
    RuntimeConfigNotFoundError,
  );
});

class MemoryRuntimeConfigRepository {
  userConfig: StoredUserRuntimeConfig | null = null;
  conversation: {
    mode: "global" | "custom";
    customConfig: StoredFigureRuntimeConfig | null;
  } | null = null;

  async findUserConfig() {
    return this.userConfig ? structuredClone(this.userConfig) : null;
  }
  async insertUserConfigIfAbsent(
    _owner: string,
    config: StoredUserRuntimeConfig,
  ) {
    this.userConfig ??= structuredClone(config);
  }
  async saveUserConfig(_owner: string, config: StoredUserRuntimeConfig) {
    this.userConfig = structuredClone(config);
  }
  async findConversationConfig() {
    return this.conversation ? structuredClone(this.conversation) : null;
  }
  async saveConversationConfig(input: {
    mode: "global" | "custom";
    customConfig: StoredFigureRuntimeConfig | null;
  }) {
    this.conversation = {
      mode: input.mode,
      customConfig: input.customConfig
        ? structuredClone(input.customConfig)
        : null,
    };
  }
}

function createService(
  repository: MemoryRuntimeConfigRepository,
  primeStates?: object,
) {
  return new RuntimeConfigService(
    repository as never,
    {
      async findByIdForOwner(ownerUserId: string, conversationId: string) {
        return ownerUserId === "user_1" && conversationId === "conversation_1"
          ? { id: conversationId, type: "slice-figure" }
          : null;
      },
    } as never,
    primeStates as never,
  );
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
