import type { Brand } from "@bridger/shared";
import { describe, expect, it } from "vitest";
import { layout } from "../src/emails/layout";

const brand = (theme: Partial<Brand["theme"]>): Brand => ({
  theme: { colors: { primary: "#0F2A44", accent: "#E07A1F", background: "#FFFFFF", text: "#1B1F24" }, headingFont: "Inter", bodyFont: "Inter", ...theme },
  company: { name: "Bridger Digital" },
});
const input = { preheader: "p", heading: "h", bodyHtml: "", bodyText: "" };

describe("email header logo", () => {
  it("uses the light logo on the dark header band", () => {
    const { html } = layout({ ...input, brand: brand({ logoUrl: "https://x.test/dark.png", logoOnDarkUrl: "https://x.test/light.png" }) });
    expect(html).toContain('src="https://x.test/light.png"');
    expect(html).not.toContain("dark.png");
  });

  it("puts a dark-only logo on a white plate so it stays visible", () => {
    const { html } = layout({ ...input, brand: brand({ logoUrl: "https://x.test/dark.png" }) });
    expect(html).toMatch(/background:#FFFFFF;border-radius:6px;padding:6px 10px"><img src="https:\/\/x.test\/dark.png"/);
  });

  it("falls back to the company name", () => {
    expect(layout({ ...input, brand: brand({}) }).html).toContain(">Bridger Digital</span>");
  });
});
