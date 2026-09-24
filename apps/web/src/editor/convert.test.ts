import { PricingSchema, ProposalContentSchema, blockRegistry, type Pricing, type ProposalContent } from "@bridger/shared";
import { describe, expect, it } from "vitest";
import { fromEditorDocument, toEditorDocument, type ObjectAttrs } from "./convert";

const pricing: Pricing = PricingSchema.parse({
  sections: [
    { id: "sec_a", title: "A", mode: "fixed", items: [{ id: "i1", name: "One", quantity: 1, unitPriceCents: 100, billing: "one_time" }] },
    { id: "sec_b", title: "B", mode: "optional", items: [] },
    { id: "sec_orphan", title: "Unplaced", mode: "fixed", items: [] },
  ],
});

const content: ProposalContent = ProposalContentSchema.parse({
  schemaVersion: 1,
  blocks: [
    { id: "cover00001", type: "cover", props: blockRegistry.cover.example },
    { id: "head000001", type: "heading", props: { text: "Our approach", level: 2 } },
    { id: "text000001", type: "text", props: { markdown: "We'll film **two days**.\n\n- 52 shorts\n- 12 edits\n\n> Worth it." } },
    { id: "price00001", type: "pricing", props: { pricingSectionIds: ["sec_a", "sec_b"], showTotals: true } },
    { id: "price00002", type: "pricing", props: { pricingSectionIds: ["sec_a"], showTotals: false } },
    { id: "hidden0001", type: "text", props: { markdown: "Internal note" }, hidden: true },
    { id: "sign000001", type: "signature", props: blockRegistry.signature.example },
  ],
});

describe("editor document conversion", () => {
  it("round-trips content and pricing exactly", () => {
    const { doc, unplacedSections } = toEditorDocument(content, pricing);
    const back = fromEditorDocument(doc, unplacedSections);
    expect(back.content).toEqual(content);
    expect(back.sections.map((s) => s.id)).toEqual(["sec_a", "sec_b", "sec_orphan"]);
    expect(back.sections).toEqual(pricing.sections);
  });

  it("gives each pricing section to the first table that shows it", () => {
    const { doc, unplacedSections } = toEditorDocument(content, pricing);
    const objects = doc.content!.filter((n) => n.type === "proposalObject").map((n) => n.attrs as ObjectAttrs);
    const tables = objects.filter((a) => a.blockType === "pricing");
    expect(tables[0]!.aux!.sections.map((s) => s.id)).toEqual(["sec_a", "sec_b"]);
    expect(tables[1]!.aux!.sections).toEqual([]);
    expect(unplacedSections.map((s) => s.id)).toEqual(["sec_orphan"]);
  });

  it("keeps hidden prose as an object so it stays hidden", () => {
    const { doc } = toEditorDocument(content, pricing);
    const hidden = doc.content!.find((n) => n.attrs?.blockId === "hidden0001")!;
    expect(hidden.type).toBe("proposalObject");
    expect((hidden.attrs as ObjectAttrs).hidden).toBe(true);
  });

  it("puts the text block's ID on the first node of its run", () => {
    const { doc } = toEditorDocument(content, pricing);
    const i = doc.content!.findIndex((n) => n.attrs?.blockId === "text000001");
    expect(doc.content![i]!.type).toBe("paragraph");
    expect(doc.content![i + 1]!.type).toBe("bulletList");
  });

  it("turns Markdown headings inside text into heading blocks, clamping levels to 1–3", () => {
    const c = ProposalContentSchema.parse({ schemaVersion: 1, blocks: [{ id: "t1", type: "text", props: { markdown: "Intro\n\n#### Deep heading\n\nMore" } }] });
    const { doc } = toEditorDocument(c, PricingSchema.parse({ sections: [] }));
    const out = fromEditorDocument(doc).content.blocks;
    expect(out.map((b) => b.type)).toEqual(["text", "heading", "text"]);
    expect(out[0]).toEqual({ id: "t1", type: "text", props: { markdown: "Intro" } });
    expect(out[1]!.props).toEqual({ text: "Deep heading", level: 3 });
  });

  it("drops empty paragraphs and headings, and assigns IDs to new prose", () => {
    const out = fromEditorDocument({
      type: "doc",
      content: [{ type: "paragraph" }, { type: "heading", attrs: { level: 2 } }, { type: "paragraph", content: [{ type: "text", text: "Fresh" }] }],
    }).content.blocks;
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("text");
    expect(out[0]!.id).toHaveLength(10);
  });

  it("produces documents that pass the shared schema", () => {
    const { doc, unplacedSections } = toEditorDocument(content, pricing);
    const back = fromEditorDocument(doc, unplacedSections);
    expect(ProposalContentSchema.safeParse(back.content).success).toBe(true);
    expect(PricingSchema.safeParse({ ...pricing, sections: back.sections }).success).toBe(true);
  });
});
