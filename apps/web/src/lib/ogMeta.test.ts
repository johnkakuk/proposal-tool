import { describe, expect, it } from "vitest";
import { ogTags } from "./ogMeta";

describe("ogTags", () => {
  it("builds OG and Twitter tags", () => {
    const html = ogTags({ title: "Content War Chest", description: "Proposal for Acme from Bridger Digital", imageUrl: "https://x.test/cover.jpg" }, "https://proposals.bridgerdigital.com/p/abc");
    expect(html).toContain('<meta property="og:title" content="Content War Chest">');
    expect(html).toContain('<meta property="og:image" content="https://x.test/cover.jpg">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it("escapes user content so a title can't inject markup", () => {
    const html = ogTags({ title: `"><script>alert(1)</script>`, description: "a & b", imageUrl: null }, "https://x/p/1");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(html).toContain("a &amp; b");
    expect(html).not.toContain("og:image");
  });
});
