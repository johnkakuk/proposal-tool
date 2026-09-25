import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login, newTemplateProposal, publishFromEditor, unique } from "./helpers";

/**
 * Accessibility pass (SPEC §14 Phase 8): no serious or critical WCAG 2.1 AA violations
 * on the main screens, including color contrast.
 */
test.describe.configure({ timeout: 120_000 });

async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")} → ${n.html.slice(0, 140)} :: ${(n.failureSummary ?? "").split("\n").slice(1, 2).join("")}`).join("\n  ")}`).join("\n");
  expect(serious, `${name}:\n${report}`).toEqual([]);
}

test("admin screens have no serious accessibility violations", async ({ page }) => {
  await page.goto("/app/login");
  await audit(page, "login");
  await login(page);
  await audit(page, "dashboard");
  await page.getByRole("link", { name: "Templates" }).click();
  await page.getByRole("heading", { name: "Templates" }).waitFor();
  await audit(page, "templates");
  await page.getByRole("link", { name: "Clients" }).click();
  await page.getByRole("heading", { name: "Clients" }).waitFor();
  await audit(page, "clients");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Brand & company" }).waitFor();
  await audit(page, "settings");
  await page.goto("/app");
  await newTemplateProposal(page, unique("A11y"));
  await page.locator("[data-block-type='cover']").waitFor();
  await audit(page, "editor");
});

test("client-facing pages have no serious accessibility violations", async ({ page, browser }) => {
  await login(page);
  await newTemplateProposal(page, unique("A11y public"));
  const url = await publishFromEditor(page);
  const client = await browser.newContext();
  const pub = await client.newPage();
  await pub.goto(url);
  await pub.locator("[data-block-type='signature']").waitFor();
  await audit(pub, "public viewer");
  await pub.getByRole("banner").getByRole("button", { name: "Accept proposal" }).click();
  await pub.getByRole("dialog", { name: "Review & accept" }).waitFor();
  await audit(pub, "signing dialog");
  await client.close();
});
