/**
 * Integer-cent money helpers. Never do money math with floats: every value
 * here is an integer number of cents, and every division rounds half-up
 * (away from zero for the non-negative values we deal with) to a whole cent.
 */

/** Largest cents value we accept anywhere ($1B). Keeps products well inside BigInt-free range for display. */
export const MAX_CENTS = 100_000_000_000;

/**
 * round(a × b ÷ d), half-up, using BigInt so large intermediate products stay exact.
 * All inputs must be integers; a and b must be ≥ 0 and d > 0.
 */
export function mulDivRoundHalfUp(a: number, b: number, d: number): number {
  assertInt(a, "a");
  assertInt(b, "b");
  assertInt(d, "d");
  if (a < 0 || b < 0 || d <= 0) {
    throw new RangeError(`mulDivRoundHalfUp expects a,b ≥ 0 and d > 0 (got ${a}, ${b}, ${d})`);
  }
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(d);
  const q = num / den;
  const r = num % den;
  return Number(r * 2n >= den ? q + 1n : q);
}

/** Converts a decimal with at most 2 places (e.g. a quantity of 1.5 or a percent of 12.5) to integer hundredths. */
export function toHundredths(value: number): number {
  const scaled = Math.round(value * 100);
  if (Math.abs(value * 100 - scaled) > 1e-6) {
    throw new RangeError(`${value} has more than 2 decimal places`);
  }
  return scaled;
}

export function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) <= 1e-6;
}

/** Formats cents as a USD string, e.g. 150000 → "$1,500.00". Negative values get a real minus sign. */
export function formatCents(cents: number, currency = "USD"): string {
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rest = abs % 100;
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const body = `${symbol}${dollars.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
  return cents < 0 ? `−${body}` : body;
}

function assertInt(n: number, name: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${name} must be a safe integer (got ${n})`);
}
