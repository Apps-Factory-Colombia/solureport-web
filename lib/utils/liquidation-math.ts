export function calculateLiquidationAmount(baseValue: number, percentage: number): number {
  const base = Number(baseValue);
  const rate = Number(percentage);
  if (!Number.isFinite(base) || !Number.isFinite(rate) || base <= 0 || rate <= 0) return 0;
  return Math.round((base * rate / 100 + Number.EPSILON) * 100) / 100;
}

/**
 * Detect values written by the legacy path that calculated a participant's
 * amount from the activity's applied total instead of that line's base value.
 * We only normalize when the persisted value exactly matches that old formula.
 */
export function isLegacyAppliedValueCalculation(input: {
  storedAmount: number;
  baseValue: number;
  appliedValue: number;
  percentage: number;
}): boolean {
  const { storedAmount, baseValue, appliedValue, percentage } = input;
  const values = [storedAmount, baseValue, appliedValue, percentage].map(Number);
  if (!values.every(Number.isFinite)) return false;
  if (baseValue <= 0 || appliedValue <= 0 || percentage <= 0) return false;
  if (Math.abs(baseValue - appliedValue) <= 0.01) return false;

  return Math.abs(storedAmount - calculateLiquidationAmount(appliedValue, percentage)) <= 0.01;
}
