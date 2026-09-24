import { expect, test } from "@playwright/test";
import { expectSaved, focusBeforeSignature, login, slash, unique } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("builds a complete proposal from blank, and it survives a reload", async ({ page }) => {
  const title = unique("Blank build");
  const company = unique("Peak Plumbing");

  await page.getByRole("button", { name: "+ New proposal" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Client").selectOption({ label: "+ New client…" });
  const clientDialog = page.getByRole("dialog", { name: "New client" });
  await clientDialog.getByLabel("Contact name").fill("Sam Rivera");
  await clientDialog.getByLabel("Company").fill(company);
  await clientDialog.getByLabel("Email").fill("sam@peak.test");
  await clientDialog.getByRole("button", { name: "Create client" }).click();
  await page.getByRole("button", { name: "Create proposal" }).click();
  await page.waitForURL(/\/app\/proposals\/[0-9a-f-]{36}$/);

  // The blank starter has a cover filled from the title and client.
  const cover = page.locator("[data-block-type='cover']");
  await expect(cover).toContainText(title);
  await expect(cover).toContainText(`Proposal for ${company}`);

  // Markdown shortcuts
  await focusBeforeSignature(page);
  await page.keyboard.type("## Our approach");
  await page.keyboard.press("Enter");
  await page.keyboard.type("We film for **two days** and deliver a year of content.");
  await page.keyboard.press("Enter");
  await expect(page.locator(".proposal-editor > h2", { hasText: "Our approach" })).toBeVisible();
  await expect(page.locator(".proposal-editor strong", { hasText: "two days" })).toBeVisible();

  // Pricing table via the slash menu
  await slash(page, "pricing");
  const pricing = page.locator("[data-block-type='pricing']");
  await pricing.getByLabel("Item name").fill("Shoot day");
  await pricing.getByLabel("Quantity").fill("2");
  await pricing.getByLabel("Unit price").fill("3,500");
  await pricing.getByRole("button", { name: "+ Add line item" }).click();
  await pricing.getByLabel("Item name").nth(1).fill("Editing");
  await pricing.getByLabel("Quantity").nth(1).fill("12.5");
  await pricing.getByLabel("Unit price").nth(1).fill("95");
  await expect(pricing.getByText("Section total:")).toBeVisible();
  await expect(pricing).toContainText("$8,187.50"); // 2 × 3,500 + 12.5 × 95
  await page.keyboard.press("Escape");
  await expect(pricing.getByRole("button", { name: "Edit" })).toBeAttached();

  // A timeline, filled in
  await focusBeforeSignature(page);
  await slash(page, "timeline");
  const timeline = page.locator("[data-block-type='timeline']");
  await timeline.getByRole("button", { name: "+ Add phase" }).click();
  await timeline.getByLabel("Phase", { exact: true }).fill("Shoot days");
  await timeline.getByLabel("Duration").fill("2 days");
  await page.keyboard.press("Escape");

  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toContainText("$8,187.50");
  await expect(sidebar).toContainText("Everything required is in place");
  await expectSaved(page);

  // Everything persisted
  await page.reload();
  await expect(page.locator(".proposal-editor > h2", { hasText: "Our approach" })).toBeVisible();
  await expect(page.locator("[data-block-type='pricing']")).toContainText("Shoot day");
  await expect(page.locator("[data-block-type='timeline']")).toContainText("Shoot days");
  await expect(page.getByRole("complementary")).toContainText("$8,187.50");

  // Client preview and mobile width
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("[data-block-type='pricing']:visible")).toContainText("$7,000.00");
  await expect(page.locator(".proposal-editor")).toBeHidden();
  await page.getByRole("button", { name: "mobile" }).click();
  await expect(page.locator("[data-device='mobile']")).toBeVisible();
  // The canvas animates its width; wait for it to settle.
  await expect.poll(async () => (await page.locator("[data-device='mobile']").boundingBox())!.width).toBeLessThanOrEqual(390);

  // The dashboard shows it with its value
  await page.getByRole("link", { name: "Back to proposals" }).click();
  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row).toContainText("$8,187.50");
  await expect(row).toContainText(company);
});

test("creates from a template and saves it back as a new template", async ({ page }) => {
  const title = unique("From template");
  await page.getByRole("button", { name: "+ New proposal" }).click();
  await page.getByRole("button", { name: /From template/ }).click();
  await page.getByRole("radio", { name: /Content War Chest/ }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create proposal" }).click();
  await page.waitForURL(/\/app\/proposals\//);

  await expect(page.locator("[data-block-type='cover']")).toContainText("Content War Chest");
  await expect(page.locator("[data-block-type='terms']")).toContainText("Deposit"); // default terms filled in
  await expect(page.getByRole("complementary")).toContainText("$8,000.00");

  // Change the default package and see totals follow
  await page.locator("[data-block-type='pricing']").dblclick();
  await page.locator("[data-block-type='pricing']").getByLabel("Selected by default").first().check();
  await expect(page.getByRole("complementary")).toContainText("$4,500.00");
  await page.keyboard.press("Escape");
  await expectSaved(page);

  const templateName = unique("Saved from proposal");
  await page.getByRole("button", { name: "⋯" }).click();
  await page.getByRole("menuitem", { name: "Save as template…" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as template" });
  await dialog.getByLabel("Template name").fill(templateName);
  await dialog.getByLabel("Category").fill("Content");
  await dialog.getByRole("button", { name: "Save template" }).click();

  await page.waitForURL(/\/app\/templates\//);
  await expect(page.getByLabel("Template name")).toHaveValue(templateName);
  await expect(page.getByRole("complementary")).toContainText("$4,500.00");

  await page.getByRole("link", { name: "Back to templates" }).click();
  await expect(page.getByRole("link", { name: templateName })).toBeVisible();
});

test("slash menu is keyboard navigable and keeps the signature unique", async ({ page }) => {
  await page.getByRole("button", { name: "+ New proposal" }).click();
  await page.getByLabel("Title").fill(unique("Slash"));
  await page.getByRole("button", { name: "Create proposal" }).click();
  await page.waitForURL(/\/app\/proposals\//);

  await focusBeforeSignature(page);
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Insert block" });
  await expect(menu).toBeVisible();
  const selected = () => menu.getByRole("option", { selected: true });
  await expect(selected()).toContainText("Text");
  await page.keyboard.press("ArrowDown");
  await expect(selected()).toContainText("Heading 1");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp"); // wraps to the last item
  await expect(selected()).not.toContainText("Text");

  await page.keyboard.type("sign");
  await expect(menu.getByRole("option", { name: /Signature/ })).toBeDisabled();
  await expect(menu).toContainText("Already in this proposal");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Filtering by keyword, then Enter inserts
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("/quote");
  await expect(menu.getByRole("option").first()).toContainText("Quote");
  await page.keyboard.press("Enter");
  await expect(page.locator(".proposal-editor > blockquote")).toBeVisible();
});

test("undo reverts edits, including object changes", async ({ page }) => {
  await page.getByRole("button", { name: "+ New proposal" }).click();
  await page.getByLabel("Title").fill(unique("Undo"));
  await page.getByRole("button", { name: "Create proposal" }).click();
  await page.waitForURL(/\/app\/proposals\//);

  await focusBeforeSignature(page);
  await slash(page, "divider");
  await expect(page.locator("[data-block-type='divider']")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-block-type='divider']")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator("[data-block-type='divider']")).toHaveCount(1);
});
