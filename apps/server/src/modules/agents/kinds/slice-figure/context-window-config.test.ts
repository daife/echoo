import assert from "node:assert/strict";
import test from "node:test";
import { calculateStableContextStart } from "../../../../infra/config/context-window-config.js";

test("stable context start keeps the configured minimum-to-maximum range", () => {
  const window = { minimum: 100, maximum: 199 };

  assert.equal(calculateStableContextStart(99, window), 0);
  assert.equal(calculateStableContextStart(100, window), 0);
  assert.equal(calculateStableContextStart(199, window), 0);
  assert.equal(calculateStableContextStart(200, window), 100);
  assert.equal(calculateStableContextStart(299, window), 100);
  assert.equal(calculateStableContextStart(300, window), 200);
});

test("stable context start supports a different minimum and maximum", () => {
  const window = { minimum: 150, maximum: 249 };

  assert.equal(calculateStableContextStart(249, window), 0);
  assert.equal(calculateStableContextStart(250, window), 100);
  assert.equal(calculateStableContextStart(349, window), 100);
  assert.equal(calculateStableContextStart(350, window), 200);
});
