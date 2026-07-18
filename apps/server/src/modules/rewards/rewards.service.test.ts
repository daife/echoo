import assert from "node:assert/strict";
import test from "node:test";
import { calculatePromotionRewardMicroUsd } from "./rewards.service.js";

test("promotion reward applies only above the threshold", () => {
  assert.equal(calculatePromotionRewardMicroUsd(99, 100, 1_000, 1_000_000), 0);
  assert.equal(calculatePromotionRewardMicroUsd(100, 100, 1_000, 1_000_000), 0);
  assert.equal(calculatePromotionRewardMicroUsd(101, 100, 1_000, 1_000_000), 1_000);
});

test("promotion reward is capped and disabled by zero values", () => {
  assert.equal(
    calculatePromotionRewardMicroUsd(10_000, 100, 1_000, 250_000),
    250_000,
  );
  assert.equal(calculatePromotionRewardMicroUsd(1_000, 100, 0, 250_000), 0);
  assert.equal(calculatePromotionRewardMicroUsd(1_000, 100, 1_000, 0), 0);
});
