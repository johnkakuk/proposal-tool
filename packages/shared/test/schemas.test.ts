import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  BlockSchema,
  CERTIFICATE_ID_RE,
  PricingSchema,
  ProposalContentSchema,
  SLUG_RE,
  blockRegistry,
  canonicalJson,
  checkPublishable,
  checkReferences,
  getBlockSchemaDocument,
  hashCanonical,
  newBlockId,
  newCertificateId,
  newSlug,
  sha256Hex,
  zodIssues,
  type Pricing,
  type ProposalContent,
} from "../src/index.js";

describe("block registry", () => {
  it("every block type's example and defaults parse", () => {
    for (const type of BLOCK_TYPES) {
      const def = blockRegistry[type];
      expect(() => BlockSchema.parse({ id: "b1", type, props: def.example }), `${type} example`).not.toThrow();
      expect(() => BlockSchema.parse({ id: "b1", type, props: def.defaultProps() }), `${type} defaults`).not.toThrow();
    }
  });

  it("covers all 18 v1 block types", () => {
    expect(BLOCK_TYPES).toHaveLength(18);
    expect(BLOCK_TYPES).toContain("signature");
  });

  it("rejects unknown block types and bad props with a readable path", () => {
    const content = { schemaVersion: 1, blocks: [{ id: "a", type: "cover", props: blockRegistry.cover.example }, { id: "b", type: "hero", props: {} }] };
    const r = ProposalContentSchema.safeParse(content);
    expect(r.success).toBe(false);
    if (!r.success) expect(zodIssues(r.error, content)[0]!.message).toMatch(/^Block 2 \(hero\): /);
  });

  it("rejects duplicate block IDs", () => {
    const r = ProposalContentSchema.safeParse({
      schemaVersion: 1,
      blocks: [
        { id: "same", type: "divider", props: {} },
        { id: "same", type: "divider", props: {} },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(/reuses id 'same' from block 1/);
  });

  it("exports JSON Schema for the MCP get_block_schema tool", () => {
    const doc = getBlockSchemaDocument();
    expect(doc.proposalContent).toHaveProperty("type", "object");
    expect(doc.pricing).toHaveProperty("type", "object");
    expect(doc.blockTypes).toHaveLength(18);
    expect(JSON.stringify(doc)).toContain("choose_one");
  });
});

describe("pricing schema", () => {
  const sec = (items: unknown[], mode = "fixed") => ({ sections: [{ id: "s", title: "S", mode, items }] });
  const it1 = { id: "i", name: "I", quantity: 1, unitPriceCents: 100, billing: "one_time" };

  it("rejects fractional cents", () => {
    expect(PricingSchema.safeParse(sec([{ ...it1, unitPriceCents: 10.5 }])).success).toBe(false);
  });
  it("rejects quantities with more than 2 decimals", () => {
    expect(PricingSchema.safeParse(sec([{ ...it1, quantity: 1.234 }])).success).toBe(false);
    expect(PricingSchema.safeParse(sec([{ ...it1, quantity: 1.23 }])).success).toBe(true);
  });
  it("validates discount ranges", () => {
    const d = (type: string, value: number) => PricingSchema.safeParse({ ...sec([it1]), discounts: [{ id: "d", label: "D", type, value }] }).success;
    expect(d("percent", 100)).toBe(true);
    expect(d("percent", 100.01)).toBe(false);
    expect(d("amount", 50.5)).toBe(false);
    expect(d("amount", -1)).toBe(false);
  });
  it("choose_one needs items and at most one default", () => {
    expect(PricingSchema.safeParse(sec([], "choose_one")).success).toBe(false);
    const two = [{ ...it1, id: "a", selectedByDefault: true }, { ...it1, id: "b", selectedByDefault: true }];
    expect(PricingSchema.safeParse(sec(two, "choose_one")).success).toBe(false);
  });
  it("rejects duplicate item and section IDs", () => {
    expect(PricingSchema.safeParse(sec([it1, it1])).success).toBe(false);
    const s = { id: "s", title: "S", mode: "fixed", items: [] };
    expect(PricingSchema.safeParse({ sections: [s, s] }).success).toBe(false);
  });
});

describe("publish validation", () => {
  const pricing: Pricing = PricingSchema.parse({
    sections: [{ id: "sec_a", title: "A", mode: "fixed", items: [{ id: "i", name: "Item", quantity: 1, unitPriceCents: 100, billing: "one_time" }] }],
  });
  const block = (id: string, type: keyof typeof blockRegistry, props?: object) =>
    ({ id, type, props: props ?? blockRegistry[type].example }) as ProposalContent["blocks"][number];
  const content = (...blocks: ProposalContent["blocks"]): ProposalContent => ProposalContentSchema.parse({ schemaVersion: 1, blocks });

  it("passes a valid proposal", () => {
    const c = content(block("c", "cover"), block("p", "pricing", { pricingSectionIds: ["sec_a"] }), block("s", "signature"), block("d", "divider"));
    expect(checkPublishable(c, pricing, { clientHasEmail: true })).toEqual([]);
  });

  it("names unknown pricing sections the way the model needs", () => {
    const c = content(block("c", "cover"), block("h", "heading"), block("p", "pricing", { pricingSectionIds: ["sec_retainer"] }));
    expect(checkReferences(c, pricing)[0]!.message).toBe("Block 3 (pricing) references unknown pricing section 'sec_retainer'. Known sections: 'sec_a'");
  });

  it("requires exactly one signature, last except dividers", () => {
    const none = content(block("c", "cover"));
    expect(checkPublishable(none, pricing, { clientHasEmail: true }).map((i) => i.message)).toContain(
      "A proposal needs exactly one visible signature block; found 0",
    );
    const notLast = content(block("s", "signature"), block("t", "text"));
    expect(checkPublishable(notLast, pricing, { clientHasEmail: true })[0]!.message).toMatch(/must be the last block/);
    const two = content(block("s", "signature"), block("s2", "signature"));
    expect(checkPublishable(two, pricing, { clientHasEmail: true })[0]!.message).toMatch(/found 2/);
  });

  it("flags missing client email, empty pricing, empty required props, and bad video hosts", () => {
    const c = content(block("c", "cover", { ...blockRegistry.cover.example, title: " " }), block("v", "video", { url: "https://evil.example/v" }), block("s", "signature"));
    const msgs = checkPublishable(c, PricingSchema.parse({ sections: [] }), { clientHasEmail: false }).map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        "The proposal's client needs an email address",
        "Add at least one pricing section",
        "Block 1 (cover) is missing required 'title'",
        "Block 2 (video) URL must be YouTube, Vimeo, or Loom",
      ]),
    );
  });

  it("ignores hidden blocks", () => {
    const hidden = { ...block("s2", "signature"), hidden: true };
    const c = content(block("s", "signature"), hidden);
    expect(checkPublishable(c, pricing, { clientHasEmail: true })).toEqual([]);
  });
});

describe("canonical hashing", () => {
  it("sha256 matches a known vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("canonicalizes per RFC 8785 (sorted keys, no whitespace)", () => {
    expect(canonicalJson({ b: 1, a: [1, "x", { d: null, c: true }] })).toBe('{"a":[1,"x",{"c":true,"d":null}],"b":1}');
    expect(canonicalJson({ n: 1e21, f: 0.1 })).toBe('{"f":0.1,"n":1e+21}');
  });
  it("hash is independent of key order", async () => {
    expect(await hashCanonical({ a: 1, b: { c: 2, d: 3 } })).toBe(await hashCanonical({ b: { d: 3, c: 2 }, a: 1 }));
    expect(await hashCanonical({ a: 1 })).not.toBe(await hashCanonical({ a: 2 }));
  });
});

describe("ids", () => {
  it("generates the documented formats", () => {
    expect(newBlockId()).toHaveLength(10);
    expect(newSlug()).toMatch(SLUG_RE);
    for (let i = 0; i < 200; i++) expect(newCertificateId()).toMatch(CERTIFICATE_ID_RE);
  });
});

describe("publish validation: pricing labels", () => {
  it("allows blank names in drafts but not at publish", () => {
    const pricing = PricingSchema.parse({
      sections: [{ id: "s", title: "", mode: "fixed", items: [{ id: "i", name: "", quantity: 1, unitPriceCents: 1, billing: "one_time" }], discounts: [{ id: "d", label: "", type: "percent", value: 5 }] }],
      discounts: [{ id: "pd", label: " ", type: "amount", value: 100 }],
    });
    const content = ProposalContentSchema.parse({ schemaVersion: 1, blocks: [{ id: "s", type: "signature", props: blockRegistry.signature.example }] });
    expect(checkPublishable(content, pricing, { clientHasEmail: true }).map((i) => i.message)).toEqual([
      "Pricing section #1 needs a title",
      "Item 1 in pricing section #1 needs a name",
      "Discount 1 in pricing section #1 needs a label",
      "Proposal discount 1 needs a label",
    ]);
  });
});

describe("signing helpers", () => {
  it("builds the exact consent text from the spec", async () => {
    const { consentText } = await import("../src/index.js");
    expect(consentText("Acme Roofing")).toBe(
      "By checking this box and clicking 'Sign & Accept', I agree that my electronic signature is the legal equivalent of my handwritten signature, that I am authorized to accept this proposal on behalf of Acme Roofing, and that I consent to conducting this transaction and receiving related records electronically. I can download a copy of this proposal and my signature at any time.",
    );
  });
  it("masks emails", async () => {
    const { maskEmail } = await import("../src/index.js");
    expect(maskEmail("jane.doe@acme.com")).toBe("j*****e@acme.com");
    expect(maskEmail("jo@x.io")).toBe("j*@x.io");
  });
});

describe("bot detection", () => {
  it("flags crawlers, previewers, scanners, and headless browsers; lets real browsers through", async () => {
    const { isBotUserAgent } = await import("../src/index.js");
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "facebookexternalhit/1.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (compatible; Microsoft Office/16.0; Windows NT 10.0)",
      "curl/8.4.0",
      "",
    ])
      expect(isBotUserAgent(ua), ua).toBe(true);
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    ])
      expect(isBotUserAgent(ua), ua).toBe(false);
  });
});

describe("theme contrast", () => {
  it("computes WCAG contrast ratios", async () => {
    const { contrastRatio } = await import("../src/index.js");
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#E07A1F")).toBeCloseTo(3.01, 1);
  });

  it("derives legible text for any brand palette, leaving passing colors alone", async () => {
    const { contrastRatio, readableOn, textOn, themeToCssVars } = await import("../src/index.js");
    expect(textOn("#0F2A44")).toBe("#FFFFFF");
    expect(textOn("#E07A1F")).toBe("#111827"); // white on this orange is only 3:1
    expect(readableOn("#0F2A44", "#FFFFFF")).toBe("#0F2A44"); // already passes
    const darkened = readableOn("#E07A1F", "#FFFFFF");
    expect(contrastRatio(darkened, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    for (const [primary, accent, background] of [
      ["#0F2A44", "#E07A1F", "#FFFFFF"],
      ["#FFD60A", "#00FFFF", "#FFFFFF"],
      ["#111111", "#333333", "#000000"],
      ["#7C3AED", "#F59E0B", "#FAFAF9"],
    ] as const) {
      const v = themeToCssVars({ colors: { primary, accent, background, text: "#777777" }, headingFont: "Inter", bodyFont: "Inter" });
      expect(contrastRatio(v["--color-on-primary"]!, primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v["--color-on-accent"]!, accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v["--color-accent-text"]!, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v["--color-text"]!, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v["--color-primary-text"]!, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v["--color-muted"]!, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("pickLogo", () => {
  it("uses the light logo on dark surfaces and the main logo on light ones", async () => {
    const { pickLogo } = await import("../src/index.js");
    const both = { logoUrl: "https://x.test/dark.png", logoOnDarkUrl: "https://x.test/light.png" };
    expect(pickLogo(both, "#0F2A44")).toEqual({ url: "https://x.test/light.png" });
    expect(pickLogo(both, "#FFFFFF")).toEqual({ url: "https://x.test/dark.png" });
  });

  it("falls back to the other version on a contrasting plate, or nothing", async () => {
    const { pickLogo } = await import("../src/index.js");
    expect(pickLogo({ logoUrl: "https://x.test/dark.png" }, "#0F2A44")).toEqual({ url: "https://x.test/dark.png", plate: "#FFFFFF" });
    expect(pickLogo({ logoOnDarkUrl: "https://x.test/light.png" }, "#FAFAF9")).toEqual({ url: "https://x.test/light.png", plate: "#111827" });
    expect(pickLogo({}, "#FFFFFF")).toBeNull();
    expect(pickLogo(null, "#FFFFFF")).toBeNull();
  });
});
