import { expect, type Page } from "@playwright/test";

export async function login(page: Page) {
  await page.goto("/app/login");
  await page.getByLabel("Email").fill("owner@bridger.local");
  await page.getByLabel("Password").fill("bridger-dev-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Proposals" })).toBeVisible();
}

export const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

/** Waits until autosave has written everything. */
export async function expectSaved(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /Saved|Unsaved|Saving/ })).toHaveText("Saved", { timeout: 15_000 });
}

/** Puts the caret on a fresh line directly before the signature block. */
export async function focusBeforeSignature(page: Page) {
  await expect(page.locator(".proposal-editor [data-block-type='signature']")).toBeVisible();
  const para = page.locator("xpath=//div[contains(@class,'proposal-editor')]/p[following-sibling::*[1][descendant-or-self::*[@data-block-type='signature']]]");
  if ((await para.count()) === 0) {
    // Another object sits right before the signature: use its "Insert line below" button.
    const before = page.locator("xpath=//div[contains(@class,'proposal-editor')]/*[following-sibling::*[1][descendant-or-self::*[@data-block-type='signature']]]");
    await before.hover();
    await before.getByRole("button", { name: "Insert line below" }).click();
    return;
  }
  await para.click();
  await page.keyboard.press("End");
  if ((await para.textContent())?.trim()) await page.keyboard.press("Enter");
}

export async function slash(page: Page, query: string) {
  await page.keyboard.type(`/${query}`);
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
  await page.keyboard.press("Enter");
}

import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

/** Service-role client for test setup (e.g. forcing an expiry date). Local stack only. */
export function adminDb() {
  const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const s = JSON.parse(out.slice(out.indexOf("{"))) as { API_URL: string; SERVICE_ROLE_KEY: string };
  return createClient(s.API_URL, s.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** Creates a publishable proposal from the Content War Chest template with a new client. */
export async function newTemplateProposal(page: Page, title: string) {
  await page.getByRole("button", { name: "+ New proposal" }).click();
  await page.getByRole("button", { name: /From template/ }).click();
  await page.getByRole("radio", { name: /Content War Chest/ }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Client").selectOption({ label: "+ New client…" });
  const d = page.getByRole("dialog", { name: "New client" });
  await d.getByLabel("Contact name").fill("Riley Chen");
  await d.getByLabel("Company").fill(`Northwind ${Date.now().toString(36)}`);
  await d.getByLabel("Email").fill("riley@northwind.test");
  await d.getByRole("button", { name: "Create client" }).click();
  await page.getByRole("button", { name: "Create proposal" }).click();
  await page.waitForURL(/\/app\/proposals\//);
}

/** Publishes from the editor and returns the public link from the share dialog. */
export async function publishFromEditor(page: Page, label: "Publish" | "Update" = "Publish"): Promise<string> {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Your proposal is live" });
  await expect(dialog).toBeVisible();
  const url = await dialog.getByLabel("Proposal link").inputValue();
  await dialog.getByRole("button", { name: "Close" }).click();
  return url;
}
