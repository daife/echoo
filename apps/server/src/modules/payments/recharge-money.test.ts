import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUsdToCnyRate } from "../platform-settings/platform-settings.service.js";
import {
  calculatePayAmountFen,
  formatFen,
  parseCnyToFen,
  parseRechargeUsd,
  parseUsdToCnyRateMicro,
} from "./recharge-money.js";

test("parses supported recharge amounts as integer micro USD", () => {
  assert.equal(parseRechargeUsd("0.1"), 100_000);
  assert.equal(parseRechargeUsd("0.10"), 100_000);
  assert.equal(parseRechargeUsd("1"), 1_000_000);
  assert.equal(parseRechargeUsd("10.25"), 10_250_000);
  assert.equal(parseRechargeUsd("1000.00"), 1_000_000_000);
});

test("rejects recharge amounts outside limits or with excess precision", () => {
  for (const value of ["0.09", "1000.01", "1.001", "-1", "1e2"])
    assert.throws(() => parseRechargeUsd(value));
});

test("normalizes and bounds USD to CNY rates", () => {
  assert.equal(normalizeUsdToCnyRate("07.200000"), "7.2");
  assert.equal(parseUsdToCnyRateMicro("7.234567"), 7_234_567);
  assert.throws(() => normalizeUsdToCnyRate("0.009999"));
  assert.throws(() => normalizeUsdToCnyRate("100.000001"));
});

test("rounds the locked RMB amount half up to fen", () => {
  assert.equal(
    calculatePayAmountFen(parseRechargeUsd("10"), 7_234_567),
    7_235,
  );
  assert.equal(calculatePayAmountFen(parseRechargeUsd("1"), 10_000), 1);
  assert.equal(formatFen(7_235), "72.35");
  assert.equal(parseCnyToFen("72.35"), 7_235);
});
