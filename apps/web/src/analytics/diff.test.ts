import { PricingSchema, ProposalContentSchema } from "@bridger/shared";
import { describe, expect, it } from "vitest";
import { diffVersions } from "./diff";

const content = (blocks: unknown[]) => ProposalContentSchema.parse({ schemaVersion: 1, blocks });
const pricing = (price: number, extra: unknown[] = []) =>
  PricingSchema.parse({ sections: [{ id: "s", title: "Package", mode: "fixed", items: [{ id: "a", name: "Shoot", quantity: 1, unitPriceCents: price, billing: "one_time" }, ...extra] }] });

describe("diffVersions", () => {
  it("reports added, removed, changed, and moved blocks plus price changes", () => {
    const a = { content: content([{ id: "h1", type: "heading", props: { text: "Intro", level: 2 } }, { id: "t1", type: "text", props: { markdown: "Hello" } }, { id: "d1", type: "divider", props: {} }]), pricing: pricing(100_000) };
    const b = {
      content: content([{ id: "t1", type: "text", props: { markdown: "Hello there" } }, { id: "h1", type: "heading", props: { text: "Intro", level: 2 } }, { id: "c1", type: "cta", props: { heading: "Go", body: "", buttonLabel: "Accept" } }]),
      pricing: pricing(120_000, [{ id: "b", name: "Drone", quantity: 1, unitPriceCents: 5_000, billing: "one_time" }]),
    };
    const d = diffVersions(a, b);
    expect(d.blocks).toEqual(
      expect.arrayContaining([
        { kind: "added", label: "Call to action: Go" },
        { kind: "removed", label: "Divider" },
        { kind: "changed", label: "Text: Hello there" },
        { kind: "moved", label: "Heading: Intro" },
      ]),
    );
    expect(d.pricing).toEqual(expect.arrayContaining([{ kind: "added", label: "Drone (Package)", detail: "$50.00" }, { kind: "changed", label: "Shoot", detail: "$1,000.00 → $1,200.00" }]));
    expect(d.totals).toEqual({ before: "$1,000.00", after: "$1,250.00" });
  });

  it("is empty for identical versions", () => {
    const v = { content: content([{ id: "h1", type: "heading", props: { text: "Intro", level: 2 } }]), pricing: pricing(1) };
    expect(diffVersions(v, v)).toEqual({ blocks: [], pricing: [], totals: null });
  });
});
