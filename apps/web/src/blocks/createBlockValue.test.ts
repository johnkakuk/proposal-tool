import { describe, expect, it } from "vitest";
import { createBlockValue } from ".";

describe("createBlockValue", () => {
  it("pre-fills a new Terms object with the workspace default terms", () => {
    expect(createBlockValue("terms", { defaultTerms: "1. 50% deposit." }).props).toEqual({ title: "Terms & Conditions", markdown: "1. 50% deposit." });
    expect(createBlockValue("terms", { defaultTerms: "{{default_terms}}" }).props.markdown).toBe("{{default_terms}}");
    expect(createBlockValue("terms").props.markdown).toBe("");
  });

  it("uses registry defaults for types without a create hook", () => {
    expect(createBlockValue("divider", { defaultTerms: "ignored" })).toEqual({ props: { style: "line" }, aux: null });
  });
});
