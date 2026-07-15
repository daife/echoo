import assert from "node:assert/strict";
import test from "node:test";
import { buildEnvironment } from "./environment.js";

const managedKeys = [
  "NODE_ENV",
  "JWT_SECRET",
  "MYSQL_URL",
  "RESOURCE_STORAGE_PROVIDER",
  "PLATFORM_OPENROUTER_API_KEY",
  "OPENROUTER_API_KEY",
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
