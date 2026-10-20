import assert from "node:assert/strict";
import test from "node:test";
import { calculateLiquidationAmount, isLegacyAppliedValueCalculation } from "../../lib/utils/liquidation-math.ts";

test("liquidation percentages apply to the line base, not the activity applied value", () => {
  assert.equal(calculateLiquidationAmount(120_000, 40), 48_000);
  assert.equal(calculateLiquidationAmount(15_000, 50), 7_500);
  assert.equal(calculateLiquidationAmount(15_000, 100), 15_000);
});

test("rounds fractional currency to cents", () => {
  assert.equal(calculateLiquidationAmount(10_001, 33.33), 3_333.33);
});

test("recognizes only a stored value produced from the wrong applied total", () => {
  assert.equal(isLegacyAppliedValueCalculation({
    storedAmount: 96_000,
    baseValue: 120_000,
    appliedValue: 240_000,
    percentage: 40,
  }), true);
  assert.equal(isLegacyAppliedValueCalculation({
    storedAmount: 48_000,
    baseValue: 120_000,
    appliedValue: 240_000,
    percentage: 40,
  }), false);
  assert.equal(isLegacyAppliedValueCalculation({
    storedAmount: 48_000,
    baseValue: 120_000,
    appliedValue: 120_000,
    percentage: 40,
  }), false);
});
