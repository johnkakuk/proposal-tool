import { expect, test, type Page } from "@playwright/test";
import { login, newTemplateProposal, publishFromEditor, unique } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await login(page);
});

const menuFor = (page: Page, name: string) => page.getByRole("button", { name: `Actions for ${name}`, exact: true });
const pick = async (page: Page, rowName: string, item: string) => {
  await menuFor(page, rowName).click();
  await page.getByRole("menu", { name: `Actions for ${rowName}` }).getByRole("menuitem", { name: item }).click();
};

test("proposal menu: rename, duplicate, copy link, download PDF, delete and restore", async ({ page }) => {
  const title = unique("Menu");
  await newTemplateProposal(page, title);
  const url = await publishFromEditor(page);
  await page.getByRole("link", { name: "Back to proposals" }).click();

  // Delete is red and set apart
  await menuFor(page, title).click();
  const menu = page.getByRole("menu", { name: `Actions for ${title}` });
  await expect(menu.getByRole("menuitem")).toHaveText(["Edit", "Rename", "Duplicate", "Copy link", "Download PDF", "Delete"]);
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toHaveClass(/text-red-600/);
  // Keyboard: focus starts on the first item; arrows move; Esc closes and returns focus
  await expect(menu.getByRole("menuitem", { name: "Edit" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(menuFor(page, title)).toBeFocused();

  // Copy link
  await pick(page, title, "Copy link");
  await expect(page.getByText("Link copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  // Download PDF (rendered by Browser Rendering)
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await pick(page, title, "Download PDF");
  expect((await download).suggestedFilename()).toMatch(new RegExp(`^Northwind .* - ${title} - v1\\.pdf$`));

  // Rename
  const renamed = `${title} (renamed)`;
  await pick(page, title, "Rename");
  const dialog = page.getByRole("dialog", { name: "Rename proposal" });
  await dialog.getByLabel("Title").fill(renamed);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: renamed, exact: true })).toBeVisible();

  // Duplicate
  await pick(page, renamed, "Duplicate");
  await expect(page.getByRole("link", { name: `${renamed} (copy)` })).toBeVisible();

  // Delete → archived; restore from the Archived filter
  await pick(page, renamed, "Delete");
  const confirm = page.getByRole("dialog", { name: `Delete “${renamed}”?` });
  await expect(confirm).toContainText("client link stops working");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: renamed, exact: true })).toBeHidden();
  await expect((await page.request.get(url.replace("/p/", "/api/public/proposals/"))).status()).toBe(404);

  await page.getByLabel("Filter by status").selectOption("archived");
  await menuFor(page, renamed).click();
  await expect(page.getByRole("menu", { name: `Actions for ${renamed}` }).getByRole("menuitem")).toHaveText(["Edit", "Rename", "Duplicate", "Copy link", "Download PDF", "Restore", "Delete permanently"]);
  await page.keyboard.press("Escape");
  await pick(page, renamed, "Restore");
  await expect(page.getByText(`Restored “${renamed}”`)).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("");
  await expect(page.getByRole("link", { name: renamed, exact: true })).toBeVisible();
  expect((await page.request.get(url.replace("/p/", "/api/public/proposals/"))).status()).toBe(200);

  // Permanent deletion: only from the archive
  const copy = `${renamed} (copy)`;
  await pick(page, copy, "Delete");
  await page.getByRole("dialog", { name: `Delete “${copy}”?` }).getByRole("button", { name: "Delete" }).click();
  await page.getByLabel("Filter by status").selectOption("archived");
  await pick(page, copy, "Delete permanently");
  const purge = page.getByRole("dialog", { name: `Permanently delete “${copy}”?` });
  await expect(purge).toContainText("can't be undone");
  await purge.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByText(`Permanently deleted “${copy}”`)).toBeVisible();
  await expect(page.getByRole("link", { name: copy, exact: true })).toBeHidden();
});

test("drafts can't copy a link or download a PDF yet", async ({ page }) => {
  const title = unique("Draft menu");
  await page.getByRole("button", { name: "+ New proposal" }).click();
  await page.getByRole("dialog", { name: "New proposal" }).getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Create proposal" }).click();
  await page.waitForURL(/\/app\/proposals\//);
  await page.getByRole("link", { name: "Back to proposals" }).click();
  await menuFor(page, title).click();
  const menu = page.getByRole("menu", { name: `Actions for ${title}` });
  await expect(menu.getByRole("menuitem", { name: "Copy link" })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Download PDF" })).toBeDisabled();
});

test("template menu: rename, duplicate, delete", async ({ page }) => {
  const name = unique("Tpl menu");
  await page.getByRole("link", { name: "Templates" }).click();
  await page.getByRole("button", { name: "+ New template" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create and edit" }).click();
  await page.waitForURL(/\/app\/templates\//);
  await page.getByRole("link", { name: "Back to templates" }).click();

  await pick(page, name, "Rename");
  await page.getByRole("dialog", { name: "Rename template" }).getByLabel("Name").fill(`${name} v2`);
  await page.getByRole("dialog", { name: "Rename template" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: `${name} v2`, exact: true })).toBeVisible();

  await pick(page, `${name} v2`, "Duplicate");
  await expect(page.getByRole("link", { name: `${name} v2 (copy)` })).toBeVisible();

  for (const n of [`${name} v2 (copy)`, `${name} v2`]) {
    await pick(page, n, "Delete");
    await page.getByRole("dialog", { name: `Delete “${n}”?` }).getByRole("button", { name: "Delete template" }).click();
    await expect(page.getByRole("link", { name: n, exact: true })).toBeHidden();
  }
});

test("client menu: rename, delete, and a clear error when they have proposals", async ({ page }) => {
  const name = unique("Client menu");
  await page.getByRole("link", { name: "Clients" }).click();
  await page.getByRole("button", { name: "+ New client" }).click();
  await page.getByLabel("Contact name").fill(name);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/app\/clients\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "← Clients" }).click();

  await pick(page, name, "Rename");
  await page.getByRole("dialog", { name: "Rename client" }).getByLabel("Contact name").fill(`${name} Jr`);
  await page.getByRole("dialog", { name: "Rename client" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: `${name} Jr` })).toBeVisible();

  await pick(page, `${name} Jr`, "Delete");
  await page.getByRole("dialog", { name: `Delete ${name} Jr?` }).getByRole("button", { name: "Delete client" }).click();
  await expect(page.getByRole("link", { name: `${name} Jr` })).toBeHidden();

  // A client with proposals can't be deleted; the dialog explains why.
  await page.goto("/app");
  const { company } = await newTemplateProposal(page, unique("Keeps client"));
  await page.goto("/app/clients");
  const busy = `Riley Chen, ${company}`;
  await pick(page, busy, "Delete");
  const dialog = page.getByRole("dialog", { name: "Delete Riley Chen?" });
  await dialog.getByRole("button", { name: "Delete client" }).click();
  await expect(dialog.getByRole("alert")).toContainText("This client has 1 proposal");
});
