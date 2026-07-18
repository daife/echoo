import assert from "node:assert/strict";
import test from "node:test";
import { buildEnvironment } from "./environment.js";

const managedKeys = [
  "NODE_ENV",
  "JWT_SECRET",
  "MYSQL_URL",
  "RESOURCE_STORAGE_PROVIDER",
  "PLATFORM_OPENROUTER_API_KEY",
  "PLATFORM_DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "PUBLIC_SERVER_URL",
  "ZPAY_PID",
  "ZPAY_KEY",
  "ZPAY_CID",
  "ZPAY_BASE_URL",
] as const;

function withEnvironment(
  patch: Partial<Record<(typeof managedKeys)[number], string | undefined>>,
  callback: () => void,
) {
  const previous = Object.fromEntries(
    managedKeys.map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    callback();
  } finally {
    for (const key of managedKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production requires JWT and MySQL configuration", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      JWT_SECRET: undefined,
      MYSQL_URL: "mysql://user:pass@localhost/echoo",
      RESOURCE_STORAGE_PROVIDER: "local",
    },
    () => assert.throws(buildEnvironment, /JWT_SECRET/),
  );
});

test("legacy provider keys are not used", () => {
  withEnvironment(
    {
      NODE_ENV: "development",
      PLATFORM_OPENROUTER_API_KEY: undefined,
      OPENROUTER_API_KEY: "legacy-secret",
      RESOURCE_STORAGE_PROVIDER: "local",
    },
    () => assert.equal(buildEnvironment().platformOpenRouterApiKey, ""),
  );
});

test("reads the platform DeepSeek key from its dedicated environment variable", () => {
  withEnvironment(
    {
      NODE_ENV: "development",
      PLATFORM_DEEPSEEK_API_KEY: "deepseek-secret",
      RESOURCE_STORAGE_PROVIDER: "local",
    },
    () =>
      assert.equal(
        buildEnvironment().platformDeepSeekApiKey,
        "deepseek-secret",
      ),
  );
});

test("rejects a partially configured ZPAY integration", () => {
  withEnvironment(
    {
      RESOURCE_STORAGE_PROVIDER: "local",
      PUBLIC_SERVER_URL: "https://api.example.com",
      ZPAY_PID: "1001",
      ZPAY_KEY: undefined,
    },
    () => assert.throws(buildEnvironment, /ZPAY_KEY/),
  );
});

test("requires an HTTPS public callback origin in production", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      JWT_SECRET: "secret",
      MYSQL_URL: "mysql://user:pass@localhost/echoo",
      RESOURCE_STORAGE_PROVIDER: "local",
      PUBLIC_SERVER_URL: "http://api.example.com",
      ZPAY_PID: "1001",
      ZPAY_KEY: "merchant-key",
    },
    () => assert.throws(buildEnvironment, /HTTPS/),
  );
});
