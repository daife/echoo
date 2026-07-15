import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeConfigDefaults } from "./runtime-config.defaults.js";
import { RuntimeConfigService } from "./runtime-config.service.js";

test("returns mode metadata when the selected conversation config is invalid", async () => {
  const defaults = buildRuntimeConfigDefaults();
  const invalidCustom = structuredClone(defaults.primeFigure);
  invalidCustom.context.maximumMessages = 0;
  const repository = {
    findResolvedConversationConfig: async () => ({
      conversationType: "prime-figure",
      userConfig: defaults,
      mode: "custom",
      customConfig: invalidCustom,
    }),
    findConversationConfigSelection: async () => ({
      conversationType: "prime-figure",
      mode: "custom",
      hasCustomConfig: true,
    }),
    saveUserConfig: async () => undefined,
  };
  const service = new RuntimeConfigService(
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const response = await service.getConversationConfig("user", "conversation");

  assert.equal(response.mode, "custom");
  assert.equal(response.conversationType, "prime-figure");
  assert.equal(response.config, undefined);
  assert.match(response.validationError ?? "", /最大上下文消息数/);
});

test("can switch from an invalid custom config back to a valid global config", async () => {
  const defaults = buildRuntimeConfigDefaults();
  const invalidCustom = { version: 5 };
  let savedMode: "global" | "custom" | undefined;
  let savedCustom: unknown;
  const repository = {
    findUserConfig: async () => defaults,
    findConversationConfig: async () => ({
      mode: "custom" as const,
      customConfig: invalidCustom,
    }),
    saveConversationConfig: async (input: {
      mode: "global" | "custom";
      customConfig: unknown;
    }) => {
      savedMode = input.mode;
      savedCustom = input.customConfig;
    },
    saveUserConfig: async () => undefined,
  };
  const conversations = {
    findByIdForOwner: async () => ({ type: "prime-figure" }),
  };
  const primeStates = {
    clearDisabledWakeupsForConversation: async () => undefined,
  };
  const catalog = {
    validateFigureConfig: async () => [],
  };
  const service = new RuntimeConfigService(
    repository as never,
    conversations as never,
    primeStates as never,
    catalog as never,
    {} as never,
  );

  const response = await service.updateConversationConfig(
    "user",
    "conversation",
    { mode: "global" },
  );

  assert.equal(savedMode, "global");
  assert.equal(savedCustom, invalidCustom);
  assert.equal(response.mode, "global");
  assert.ok(response.config);
});

test("mode-only switches do not run catalog capability validation", async () => {
  const defaults = buildRuntimeConfigDefaults();
  let catalogCalls = 0;
  let savedMode: "global" | "custom" | undefined;
  const repository = {
    findUserConfig: async () => defaults,
    findConversationConfig: async () => ({
      mode: "global" as const,
      customConfig: null,
    }),
    saveConversationConfig: async (input: { mode: "global" | "custom" }) => {
      savedMode = input.mode;
    },
    saveUserConfig: async () => undefined,
  };
  const service = new RuntimeConfigService(
    repository as never,
    { findByIdForOwner: async () => ({ type: "prime-figure" }) } as never,
    { clearDisabledWakeupsForConversation: async () => undefined } as never,
    {
      validateFigureConfig: async () => {
        catalogCalls += 1;
        throw new Error("catalog rejected unchanged config");
      },
    } as never,
    {} as never,
  );

  const response = await service.updateConversationConfig(
    "user",
    "conversation",
    { mode: "custom" },
  );

  assert.equal(catalogCalls, 0);
  assert.equal(savedMode, "custom");
  assert.equal(response.mode, "custom");
  assert.ok(response.config);
});

test("configuration edits still run catalog capability validation", async () => {
  const defaults = buildRuntimeConfigDefaults();
  let saved = false;
  const repository = {
    findUserConfig: async () => defaults,
    findConversationConfig: async () => ({
      mode: "custom" as const,
      customConfig: defaults.primeFigure,
    }),
    saveConversationConfig: async () => {
      saved = true;
    },
    saveUserConfig: async () => undefined,
  };
  const service = new RuntimeConfigService(
    repository as never,
    { findByIdForOwner: async () => ({ type: "prime-figure" }) } as never,
    { clearDisabledWakeupsForConversation: async () => undefined } as never,
    {
      validateFigureConfig: async () => {
        throw new Error("catalog rejected edited config");
      },
    } as never,
    {} as never,
  );

  await assert.rejects(
    service.updateConversationConfig("user", "conversation", {
      mode: "custom",
      config: { typingCharsPerMinute: 321 },
    }),
    /catalog rejected edited config/,
  );
  assert.equal(saved, false);
});
