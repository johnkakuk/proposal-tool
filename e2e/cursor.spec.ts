import { expect, test, type Page } from "@playwright/test";
import { login, newTemplateProposal, publishFromEditor, unique } from "./helpers";

/**
 * Everything clickable shows a pointer cursor (Tailwind v4 defaults buttons to the arrow).
 * Scans enabled, visible interactive elements on the main screens.
 */
const CLICKABLE = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], select, summary, input[type="checkbox"], input[type="radio"]';
// Deliberate exceptions: drag handles use grab; non-interactive pricing cards use default.
const EXEMPT = (el: Element) => el.closest("[data-drag-handle]") !== null || (el.getAttribute("role") === "radio" && (el as HTMLButtonElement).disabled);

async function offenders(page: Page, screen: string) {
  const found = await page.evaluate(
    ([sel, exempt]) => {
      const isExempt = new Function("el", `return (${exempt})(el)`) as (el: Element) => boolean;
      return [...document.querySelectorAll(sel)]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const disabled = (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
          return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !disabled && !isExempt(el) && cs.cursor !== "pointer";
        })
        .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" → ${getComputedStyle(el).cursor}`);
    },
    [CLICKABLE, EXEMPT.toString()] as const,
  );
  expect(found, `${screen}:\n${found.join("\n")}`).toEqual([]);
}

test("clickable elements show a pointer cursor", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page);
  await offenders(page, "dashboard");
  await page.getByRole("button", { name: /^Actions for / }).first().click();
  await offenders(page, "proposal menu");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "+ New proposal" }).click();
  await offenders(page, "new proposal dialog");
  await page.keyboard.press("Escape");
  for (const [link, heading] of [["Templates", "Templates"], ["Clients", "Clients"], ["Settings", "Brand & company"]] as const) {
    await page.getByRole("link", { name: link, exact: true }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
    await offenders(page, link);
  }
  await page.goto("/app");
  await newTemplateProposal(page, unique("Cursor"));
  const cover = page.locator("[data-block-type='cover']").first();
  await cover.hover();
  await offenders(page, "editor");
  await cover.getByRole("button", { name: "Edit" }).click();
  await offenders(page, "editor with object form open");
  const url = await publishFromEditor(page);

  const pub = await (await browser.newContext()).newPage();
  await pub.goto(url);
  await pub.locator("[data-block-type='signature']").waitFor();
  await offenders(pub, "public proposal");
  await pub.getByRole("banner").getByRole("button", { name: "Accept proposal" }).click();
  await offenders(pub, "signing dialog");
});
