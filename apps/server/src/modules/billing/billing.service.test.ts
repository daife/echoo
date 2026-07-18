import assert from "node:assert/strict";
import test from "node:test";
import type { PoolConnection } from "mysql2/promise";
import { BillingContext, type BillingRunContext } from "./billing-context.js";
import {
  BillingService,
  calculateCreatorRewardMicroUsd,
  InsufficientPlatformBalanceError,
} from "./billing.service.js";

class FakeSettings {
  reads = 0;
  async getBillingMultiplier() {
    this.reads += 1;
    return 2;
  }
}

class TestBillingService extends BillingService {
  balanceReads = 0;
  settlements: Array<{ multiplier: number; chargeMicroUsd: number }> = [];

  constructor(
    settings: FakeSettings,
    private readonly balance: number,
  ) {
    super(settings as never);
  }

  protected override async ensureAccount(
    _ownerUserId: string,
    _connection?: PoolConnection,
  ) {
    this.balanceReads += 1;
    return this.balance;
  }

  protected override async settleCharge(
    _context: BillingRunContext,
    _input: Parameters<BillingService["chargeUsage"]>[0],
    multiplier: number,
    chargeMicroUsd: number,
  ) {
    this.settlements.push({ multiplier, chargeMicroUsd });
  }
}

test("balance and multiplier are snapshotted once per run", async () => {
  const settings = new FakeSettings();
  const service = new TestBillingService(settings, 1);
  await BillingContext.run({ ownerUserId: "user_1" }, async () => {
    await service.assertPlatformBalance();
    await service.assertPlatformBalance();
    await service.chargeUsage({
      service: "openrouter",
      model: "paid",
      upstreamRequestId: "request_1",
      upstreamCostUsd: 0.25,
    });
    await service.chargeUsage({
      service: "fish_audio",
      model: "paid",
      upstreamRequestId: "request_2",
      upstreamCostUsd: 0.5,
    });
  });

  assert.equal(service.balanceReads, 1);
  assert.equal(settings.reads, 1);
  assert.deepEqual(service.settlements, [
    { multiplier: 2, chargeMicroUsd: 500_000 },
    { multiplier: 2, chargeMicroUsd: 1_000_000 },
  ]);
});

test("a new run is blocked when its balance snapshot is not positive", async () => {
  const service = new TestBillingService(new FakeSettings(), 0);
  await assert.rejects(
    BillingContext.run({ ownerUserId: "user_1" }, () =>
      service.assertPlatformBalance(),
    ),
    InsufficientPlatformBalanceError,
  );
});

test("zero-cost usage skips multiplier reads and settlement", async () => {
  const settings = new FakeSettings();
  const service = new TestBillingService(settings, 0);
  await BillingContext.run({ ownerUserId: "user_1" }, () =>
    service.chargeUsage({
      service: "fish_audio",
      model: "s2.1-pro-free",
      upstreamRequestId: "request_free",
      upstreamCostUsd: 0,
    }),
  );
  assert.equal(settings.reads, 0);
  assert.equal(service.settlements.length, 0);
});

test("creator reward is one percent rounded down to micro USD", () => {
  assert.equal(calculateCreatorRewardMicroUsd(99), 0);
  assert.equal(calculateCreatorRewardMicroUsd(100), 1);
  assert.equal(calculateCreatorRewardMicroUsd(123_456), 1_234);
  assert.equal(calculateCreatorRewardMicroUsd(0), 0);
});
