import assert from "node:assert/strict";
import test from "node:test";
import { buildPrimeFailureDiagnostics } from "./prime-figure-runtime.service.js";

test("keeps invalid model JSON available for administrator diagnostics", () => {
  const rawResponse = "```json\n{ invalid: true, }\n```";
  assert.deepEqual(
    buildPrimeFailureDiagnostics({
      rawResponse,
      providerId: "openrouter",
      model: "example/model",
    }),
    {
      providerId: "openrouter",
      model: "example/model",
      rawResponse,
      rawResponseTruncated: false,
      rawResponseLength: rawResponse.length,
    },
  );
});

test("marks oversized model output as truncated", () => {
  const diagnostics = buildPrimeFailureDiagnostics({
    rawResponse: "x".repeat(70_000),
    providerId: "openrouter",
    model: "example/model",
  });

  assert.equal(diagnostics.rawResponse.length, 65_536);
  assert.equal(diagnostics.rawResponseTruncated, true);
  assert.equal(diagnostics.rawResponseLength, 70_000);
});
