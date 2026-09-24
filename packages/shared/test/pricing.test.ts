import { describe, expect, it } from "vitest";
import {
  PricingError,
  PricingSchema,
  computePricing,
  lineSubtotalCents,
  mulDivRoundHalfUp,
  resolveSelections,
  splitDiscount,
  tryComputePricing,
  zeroCadences,
  type CadenceAmounts,
  type PricingInput,
} from "../src/index.js";

const pricing = (input: Partial<PricingInput> & Pick<PricingInput, "sections">) => PricingSchema.parse(input);

type ItemInput = PricingInput["sections"][number]["items"][number];
const item = (id: string, unitPriceCents: number, extra: Partial<ItemInput> = {}): ItemInput => ({
  id,
  name: id,
  quantity: 1,
  unitPriceCents,
  billing: "one_time",
  ...extra,
});

const cad = (partial: Partial<CadenceAmounts>): CadenceAmounts => ({ ...zeroCadences(), ...partial });

describe("rounding primitives", () => {
  it("rounds half up", () => {
    expect(mulDivRoundHalfUp(5, 1, 10)).toBe(1); // 0.5 → 1
    expect(mulDivRoundHalfUp(4, 1, 10)).toBe(0); // 0.4 → 0
    expect(mulDivRoundHalfUp(15, 1, 10)).toBe(2); // 1.5 → 2
    expect(mulDivRoundHalfUp(25, 1, 10)).toBe(3); // 2.5 → 3 (not banker's)
    expect(mulDivRoundHalfUp(0, 999, 7)).toBe(0);
  });

  it("stays exact for large products", () => {
    // $1B × 100,000.00 qty would overflow float precision without BigInt.
    expect(mulDivRoundHalfUp(100_000_000_000, 10_000_000, 100)).toBe(10_000_000_000_000_000);
    expect(mulDivRoundHalfUp(9_007_199_254_740_991, 3, 3)).toBe(9_007_199_254_740_991);
  });

  it("rejects floats and negatives", () => {
    expect(() => mulDivRoundHalfUp(1.5, 1, 1)).toThrow(RangeError);
    expect(() => mulDivRoundHalfUp(-1, 1, 1)).toThrow(RangeError);
    expect(() => mulDivRoundHalfUp(1, 1, 0)).toThrow(RangeError);
  });
});

describe("line subtotals and decimal quantities", () => {
  it.each([
    [1, 150_000, 150_000],
    [1.5, 12_345, 18_518], // 18517.5 → 18518
    [0.33, 100, 33],
    [2.25, 3_333, 7_499], // 7499.25 → 7499
    [1.15, 100, 115], // 1.15 * 100 is 114.99999999999999 in float math
    [0.01, 49, 0], // 0.49 → 0
    [0.01, 50, 1], // 0.5 → 1
    [0, 999_999, 0],
    [40.5, 17_500, 708_750],
  ])("qty %s × %s¢ = %s¢", (quantity, unitPriceCents, expected) => {
    expect(lineSubtotalCents({ quantity, unitPriceCents })).toBe(expected);
  });
});

describe("modes and selections", () => {
  const p = pricing({
    sections: [
      { id: "fixed", title: "Core", mode: "fixed", items: [item("a", 1000), item("b", 2000)] },
      {
        id: "opt",
        title: "Add-ons",
        mode: "optional",
        items: [item("x", 500, { selectedByDefault: true }), item("y", 700), item("z", 900, { selectedByDefault: true })],
      },
      {
        id: "pkg",
        title: "Package",
        mode: "choose_one",
        items: [item("good", 10_000), item("better", 20_000, { selectedByDefault: true }), item("best", 30_000)],
      },
    ],
  });

  it("uses defaults when no selections are sent", () => {
    const r = computePricing(p);
    expect(r.selections).toEqual({ fixed: ["a", "b"], opt: ["x", "z"], pkg: ["better"] });
    expect(r.sections.map((s) => s.total.one_time)).toEqual([3000, 1400, 20_000]);
    expect(r.total.one_time).toBe(24_400);
  });

  it("fixed items are always selected, even if the client sends a subset", () => {
    const r = computePricing(p, { fixed: ["a"] });
    expect(r.selections.fixed).toEqual(["a", "b"]);
    expect(r.sections[0]!.total.one_time).toBe(3000);
  });

  it("optional: explicit selection replaces defaults; empty array selects nothing", () => {
    expect(computePricing(p, { opt: ["y"] }).sections[1]!.total.one_time).toBe(700);
    expect(computePricing(p, { opt: [] }).sections[1]!.total.one_time).toBe(0);
  });

  it("optional: normalizes order and duplicates", () => {
    expect(computePricing(p, { opt: ["z", "x", "z"] }).selections.opt).toEqual(["x", "z"]);
  });

  it("keeps unselected lines in the result without counting them", () => {
    const s = computePricing(p, { opt: ["y"] }).sections[1]!;
    expect(s.lines.map((l) => [l.itemId, l.selected, l.totalCents])).toEqual([
      ["x", false, 500],
      ["y", true, 700],
      ["z", false, 900],
    ]);
  });

  it("choose_one: explicit pick", () => {
    expect(computePricing(p, { pkg: ["best"] }).sections[2]!.total.one_time).toBe(30_000);
  });

  it("choose_one: falls back to the first item when none is flagged", () => {
    const q = pricing({ sections: [{ id: "pkg", title: "P", mode: "choose_one", items: [item("g", 1), item("b", 2)] }] });
    expect(computePricing(q).selections.pkg).toEqual(["g"]);
  });

  it("choose_one: rejects zero or multiple picks", () => {
    expect(() => computePricing(p, { pkg: [] })).toThrow(/exactly one/);
    expect(() => computePricing(p, { pkg: ["good", "best"] })).toThrow(/exactly one.*got 2/);
    // The same item twice is still one pick.
    expect(computePricing(p, { pkg: ["good", "good"] }).selections.pkg).toEqual(["good"]);
  });

  it("rejects unknown section and item IDs", () => {
    const bad = tryComputePricing(p, { nope: [], opt: ["ghost"], pkg: ["mystery"], fixed: ["phantom"] });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const messages = bad.issues.map((i) => i.message);
    expect(messages).toContain("Unknown pricing section 'nope'");
    expect(messages).toContain("Unknown item 'ghost' in pricing section 'opt'");
    expect(messages).toContain("Unknown item 'mystery' in pricing section 'pkg'");
    expect(messages).toContain("Unknown item 'phantom' in pricing section 'fixed'");
  });

  it("throws a PricingError carrying structured issues", () => {
    try {
      computePricing(p, { nope: [] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PricingError);
      expect((e as PricingError).issues[0]!.path).toBe("selections.nope");
    }
  });

  it("does not treat prototype keys as sections", () => {
    const { issues } = resolveSelections(p, JSON.parse('{"__proto__": ["x"]}'));
    expect(issues.map((i) => i.message)).toEqual(["Unknown pricing section '__proto__'"]);
  });
});

describe("billing cadences", () => {
  it("splits totals by cadence", () => {
    const r = computePricing(
      pricing({
        sections: [
          {
            id: "s",
            title: "S",
            mode: "fixed",
            items: [
              item("setup", 250_000),
              item("retainer", 150_000, { billing: "monthly" }),
              item("review", 90_000, { billing: "quarterly" }),
              item("hosting", 36_000, { billing: "yearly" }),
            ],
          },
        ],
      }),
    );
    expect(r.total).toEqual({ one_time: 250_000, monthly: 150_000, quarterly: 90_000, yearly: 36_000 });
  });
});

describe("line discounts", () => {
  const one = (i: ItemInput) => computePricing(pricing({ sections: [{ id: "s", title: "S", mode: "fixed", items: [i] }] })).sections[0]!;

  it("percent: rounds half up", () => {
    const l = one(item("a", 999, { discount: { id: "d", label: "12.5% off", type: "percent", value: 12.5 } })).lines[0]!;
    expect(l.discount!.amountCents).toBe(125); // 124.875
    expect(l.totalCents).toBe(874);
  });

  it("percent: 50% of 1¢ rounds up to 1¢", () => {
    const l = one(item("a", 1, { discount: { id: "d", label: "half", type: "percent", value: 50 } })).lines[0]!;
    expect(l.totalCents).toBe(0);
  });

  it("percent applies after the decimal-quantity subtotal is rounded", () => {
    const l = one(item("a", 12_345, { quantity: 1.5, discount: { id: "d", label: "10%", type: "percent", value: 10 } })).lines[0]!;
    expect(l.subtotalCents).toBe(18_518);
    expect(l.discount!.amountCents).toBe(1_852); // 1851.8
    expect(l.totalCents).toBe(16_666);
  });

  it("amount larger than the line never goes below zero", () => {
    const l = one(item("a", 5_000, { discount: { id: "d", label: "Comp", type: "amount", value: 9_999_999 } })).lines[0]!;
    expect(l.discount!.amountCents).toBe(5_000);
    expect(l.totalCents).toBe(0);
  });

  it("100% off is exactly zero", () => {
    const l = one(item("a", 12_347, { quantity: 3.33, discount: { id: "d", label: "Free", type: "percent", value: 100 } })).lines[0]!;
    expect(l.totalCents).toBe(0);
  });
});

describe("splitDiscount (section/proposal-level)", () => {
  it("percent applies to each targeted bucket separately", () => {
    const b = cad({ one_time: 10_001, monthly: 333, yearly: 5 });
    expect(splitDiscount(b, { type: "percent", value: 10, appliesTo: "all" })).toEqual(cad({ one_time: 1_000, monthly: 33, yearly: 1 }));
    expect(splitDiscount(b, { type: "percent", value: 10, appliesTo: "one_time" })).toEqual(cad({ one_time: 1_000 }));
    expect(splitDiscount(b, { type: "percent", value: 10, appliesTo: "recurring" })).toEqual(cad({ monthly: 33, yearly: 1 }));
  });

  it("amount targeting one cadence comes off that bucket only", () => {
    const b = cad({ one_time: 30_000, monthly: 10_000 });
    expect(splitDiscount(b, { type: "amount", value: 5_000, appliesTo: "one_time" })).toEqual(cad({ one_time: 5_000 }));
    expect(splitDiscount(b, { type: "amount", value: 5_000, appliesTo: "recurring" })).toEqual(cad({ monthly: 5_000 }));
  });

  it("amount targeting all is split in proportion to bucket size", () => {
    const b = cad({ one_time: 30_000, monthly: 10_000 });
    expect(splitDiscount(b, { type: "amount", value: 1_000, appliesTo: "all" })).toEqual(cad({ one_time: 750, monthly: 250 }));
  });

  it("puts the rounding remainder on the largest bucket", () => {
    // 101 × 100/500 = 20.2 → 20 each for the small buckets; largest takes 101 − 40 = 61.
    const b = cad({ one_time: 300, monthly: 100, yearly: 100 });
    expect(splitDiscount(b, { type: "amount", value: 101, appliesTo: "all" })).toEqual(cad({ one_time: 61, monthly: 20, yearly: 20 }));
    // Largest bucket isn't always one_time.
    const c = cad({ one_time: 100, monthly: 300, yearly: 100 });
    expect(splitDiscount(c, { type: "amount", value: 101, appliesTo: "all" })).toEqual(cad({ one_time: 20, monthly: 61, yearly: 20 }));
  });

  it("breaks ties for largest by cadence order", () => {
    const b = cad({ monthly: 100, yearly: 100 });
    // monthly is first in cadence order → it takes the remainder: yearly = round(1.5) = 2, monthly = 1.
    expect(splitDiscount(b, { type: "amount", value: 3, appliesTo: "recurring" })).toEqual(cad({ monthly: 1, yearly: 2 }));
  });

  it("caps an amount larger than the targeted total", () => {
    const b = cad({ one_time: 700, monthly: 300 });
    expect(splitDiscount(b, { type: "amount", value: 1_000_000, appliesTo: "all" })).toEqual(b);
    expect(splitDiscount(zeroCadences(), { type: "amount", value: 500, appliesTo: "all" })).toEqual(zeroCadences());
  });

  it("keeps every share inside its bucket when half-up rounding overshoots", () => {
    // 2¢ across four 1¢ buckets: each exact share is 0.5¢, which rounds up to 1¢ ×3 = 3¢ > 2¢.
    const b = cad({ one_time: 1, monthly: 1, quarterly: 1, yearly: 1 });
    const out = splitDiscount(b, { type: "amount", value: 2, appliesTo: "all" });
    expect(Object.values(out).reduce((a, x) => a + x, 0)).toBe(2);
    for (const k of Object.keys(b) as (keyof CadenceAmounts)[]) {
      expect(out[k]).toBeGreaterThanOrEqual(0);
      expect(out[k]).toBeLessThanOrEqual(b[k]);
    }
  });

  it("holds its invariants across many random inputs", () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % (max + 1);
    };
    for (let n = 0; n < 5_000; n++) {
      const scale = [3, 50, 10_000, 5_000_000][n % 4]!;
      const b = cad({ one_time: rand(scale), monthly: rand(scale), quarterly: rand(scale), yearly: rand(scale) });
      const appliesTo = (["all", "recurring", "one_time"] as const)[n % 3]!;
      const value = rand(scale * 3);
      const out = splitDiscount(b, { type: "amount", value, appliesTo });
      const targets = appliesTo === "all" ? (Object.keys(b) as (keyof CadenceAmounts)[]) : appliesTo === "one_time" ? (["one_time"] as const) : (["monthly", "quarterly", "yearly"] as const);
      const targetTotal = targets.reduce((a, k) => a + b[k], 0);
      expect(Object.values(out).reduce((a, x) => a + x, 0)).toBe(Math.min(value, targetTotal));
      for (const k of Object.keys(b) as (keyof CadenceAmounts)[]) {
        expect(Number.isInteger(out[k])).toBe(true);
        expect(out[k]).toBeGreaterThanOrEqual(0);
        expect(out[k]).toBeLessThanOrEqual((targets as readonly string[]).includes(k) ? b[k] : 0);
      }
    }
  });
});

describe("stacked discounts", () => {
  const base = (sectionDiscounts: PricingInput["discounts"], proposalDiscounts: PricingInput["discounts"] = []) =>
    pricing({
      sections: [
        {
          id: "s",
          title: "S",
          mode: "fixed",
          items: [
            item("a", 100_000, { discount: { id: "ld", label: "Line 10%", type: "percent", value: 10 } }), // 90,000
            item("m", 20_000, { billing: "monthly" }),
          ],
          discounts: sectionDiscounts,
        },
      ],
      discounts: proposalDiscounts,
    });

  it("applies section discounts in order on the running buckets", () => {
    const r = computePricing(
      base([
        { id: "p", label: "10% off", type: "percent", value: 10, appliesTo: "all" }, // 9,000 + 2,000
        { id: "a", label: "$500 off", type: "amount", value: 50_000, appliesTo: "one_time" }, // on 81,000
      ]),
    );
    const s = r.sections[0]!;
    expect(s.subtotal).toEqual(cad({ one_time: 90_000, monthly: 20_000 }));
    expect(s.discounts.map((d) => d.amountCents)).toEqual([11_000, 50_000]);
    expect(s.total).toEqual(cad({ one_time: 31_000, monthly: 18_000 }));
  });

  it("order matters: amount then percent gives a different result", () => {
    const r = computePricing(
      base([
        { id: "a", label: "$500 off", type: "amount", value: 50_000, appliesTo: "one_time" }, // 40,000
        { id: "p", label: "10% off", type: "percent", value: 10, appliesTo: "all" }, // 4,000 + 2,000
      ]),
    );
    expect(r.sections[0]!.total).toEqual(cad({ one_time: 36_000, monthly: 18_000 }));
  });

  it("stacks line → section → proposal discounts, then tax", () => {
    const p = base(
      [{ id: "sp", label: "Section 5%", type: "percent", value: 5, appliesTo: "all" }], // 4,500 + 1,000
      [
        { id: "pa", label: "Returning client", type: "amount", value: 10_000, appliesTo: "all" }, // split 85,500 : 19,000
        { id: "pr", label: "Recurring 15%", type: "percent", value: 15, appliesTo: "recurring" },
      ],
    );
    const r = computePricing({ ...p, taxRatePct: 10.25 });
    expect(r.subtotal).toEqual(cad({ one_time: 85_500, monthly: 19_000 }));
    // 10,000 × 19,000 / 104,500 = 1818.18 → 1,818 monthly; one_time (largest) takes 8,182.
    expect(r.discounts[0]!.byCadence).toEqual(cad({ one_time: 8_182, monthly: 1_818 }));
    // 15% of 17,182 = 2577.3 → 2,577
    expect(r.discounts[1]!.byCadence).toEqual(cad({ monthly: 2_577 }));
    expect(r.totalBeforeTax).toEqual(cad({ one_time: 77_318, monthly: 14_605 }));
    // 10.25% of 77,318 = 7925.095 → 7,925; of 14,605 = 1497.0125 → 1,497
    expect(r.tax).toEqual({ ratePct: 10.25, byCadence: cad({ one_time: 7_925, monthly: 1_497 }) });
    expect(r.total).toEqual(cad({ one_time: 85_243, monthly: 16_102 }));
  });

  it("an amount discount larger than everything zeroes totals without going negative", () => {
    const r = computePricing(base([], [{ id: "big", label: "Everything free", type: "amount", value: 99_999_999, appliesTo: "all" }]));
    expect(r.total).toEqual(zeroCadences());
    expect(r.discounts[0]!.amountCents).toBe(110_000);
  });

  it("a later discount sees what earlier ones left (no double-counting past zero)", () => {
    const r = computePricing(
      base([
        { id: "a1", label: "A", type: "amount", value: 60_000, appliesTo: "one_time" },
        { id: "a2", label: "B", type: "amount", value: 60_000, appliesTo: "one_time" },
      ]),
    );
    expect(r.sections[0]!.discounts.map((d) => d.amountCents)).toEqual([60_000, 30_000]);
    expect(r.sections[0]!.total.one_time).toBe(0);
  });
});

describe("tax", () => {
  it("is off when unset or zero", () => {
    const p = pricing({ sections: [{ id: "s", title: "S", mode: "fixed", items: [item("a", 999)] }] });
    expect(computePricing(p).tax).toBeNull();
    expect(computePricing({ ...p, taxRatePct: 0 }).tax).toBeNull();
    expect(computePricing(p).total).toEqual(computePricing(p).totalBeforeTax);
  });
});

describe("a realistic proposal", () => {
  it("Content War Chest with a package choice, add-ons, and a returning-client discount", () => {
    const p = pricing({
      sections: [
        {
          id: "sec_pkg",
          title: "Package",
          mode: "choose_one",
          items: [
            item("item_1day", 450_000, { name: "1-day shoot" }),
            item("item_2day", 800_000, { name: "2-day shoot", selectedByDefault: true }),
          ],
        },
        {
          id: "sec_addons",
          title: "Add-ons",
          mode: "optional",
          items: [
            item("item_drone", 75_000, { name: "Drone" }),
            item("item_edit", 9_500, { name: "Extra editing", quantity: 12.5, unitLabel: "hr" }),
            item("item_mgmt", 125_000, { name: "Posting management", billing: "monthly" }),
          ],
        },
      ],
      discounts: [{ id: "disc_return", label: "Returning client discount", type: "amount", value: 50_000, appliesTo: "one_time" }],
    });
    const r = computePricing(p, { sec_pkg: ["item_2day"], sec_addons: ["item_edit", "item_mgmt"] });
    expect(r.sections[1]!.lines[1]!.totalCents).toBe(118_750);
    expect(r.subtotal).toEqual(cad({ one_time: 918_750, monthly: 125_000 }));
    expect(r.total).toEqual(cad({ one_time: 868_750, monthly: 125_000 }));
  });
});
