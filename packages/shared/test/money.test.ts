import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, parseDollarsToCents } from "../src/index.js";

describe("parseDollarsToCents", () => {
  it.each([
    ["1500", 150_000],
    ["$1,500", 150_000],
    ["1500.5", 150_050],
    ["1500.05", 150_005],
    [" 0.10 ", 10],
    [".5", 50],
    ["19.99", 1_999], // 19.99 * 100 is 1998.9999999999998 in float math
    ["0", 0],
  ])("%j → %d", (input, cents) => expect(parseDollarsToCents(input)).toBe(cents));

  it.each(["", "abc", "1.234", "-5", "1.2.3", "$", "1e5"])("rejects %j", (input) => expect(parseDollarsToCents(input)).toBeNull());

  it("round-trips with centsToInput", () => {
    for (const c of [0, 1, 99, 100, 150_050, 123_456_789]) expect(parseDollarsToCents(centsToInput(c))).toBe(c);
  });

  it("formats with a real minus sign", () => {
    expect(formatCents(150_000)).toBe("$1,500.00");
    expect(formatCents(-50_000)).toBe("−$500.00");
  });
});
