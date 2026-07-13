import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateStableContextStart,
  getFigureContextWindowConfig,
} from "../../../../infra/config/context-window-config.js";

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

test("figure context configuration uses defaults and accepts overrides", () => {
  const names = [
    "SLICE_FIGURE_CONTEXT_MIN_ROUNDS",
    "SLICE_FIGURE_CONTEXT_MAX_ROUNDS",
    "PRIME_FIGURE_CONTEXT_MIN_MESSAGES",
    "PRIME_FIGURE_CONTEXT_MAX_MESSAGES",
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));

  try {
    for (const name of names) delete process.env[name];
    assert.deepEqual(getFigureContextWindowConfig(), {
      sliceFigureRounds: { minimum: 100, maximum: 199 },
      primeFigureMessages: { minimum: 150, maximum: 249 },
    });

    process.env.SLICE_FIGURE_CONTEXT_MIN_ROUNDS = "80";
    process.env.SLICE_FIGURE_CONTEXT_MAX_ROUNDS = "179";
    process.env.PRIME_FIGURE_CONTEXT_MIN_MESSAGES = "120";
    process.env.PRIME_FIGURE_CONTEXT_MAX_MESSAGES = "219";
    assert.deepEqual(getFigureContextWindowConfig(), {
      sliceFigureRounds: { minimum: 80, maximum: 179 },
      primeFigureMessages: { minimum: 120, maximum: 219 },
    });
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("figure context configuration rejects invalid ranges", () => {
  const previousMinimum = process.env.PRIME_FIGURE_CONTEXT_MIN_MESSAGES;
  const previousMaximum = process.env.PRIME_FIGURE_CONTEXT_MAX_MESSAGES;
  try {
    process.env.PRIME_FIGURE_CONTEXT_MIN_MESSAGES = "250";
    process.env.PRIME_FIGURE_CONTEXT_MAX_MESSAGES = "249";
    assert.throws(
      () => getFigureContextWindowConfig(),
      /PRIME_FIGURE_CONTEXT_MAX_MESSAGES.*PRIME_FIGURE_CONTEXT_MIN_MESSAGES/,
    );
  } finally {
    restore("PRIME_FIGURE_CONTEXT_MIN_MESSAGES", previousMinimum);
    restore("PRIME_FIGURE_CONTEXT_MAX_MESSAGES", previousMaximum);
  }
});

test("figure context configuration rejects non-positive integers", () => {
  const previous = process.env.SLICE_FIGURE_CONTEXT_MIN_ROUNDS;
  try {
    process.env.SLICE_FIGURE_CONTEXT_MIN_ROUNDS = "0";
    assert.throws(
      () => getFigureContextWindowConfig(),
      /SLICE_FIGURE_CONTEXT_MIN_ROUNDS must be a positive integer/,
    );
  } finally {
    restore("SLICE_FIGURE_CONTEXT_MIN_ROUNDS", previous);
  }
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
