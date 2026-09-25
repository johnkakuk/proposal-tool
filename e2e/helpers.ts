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
export async function newTemplateProposal(page: Page, title: string): Promise<{ company: string }> {
  await page.getByRole("button", { name: "+ New proposal" }).click();
  await page.getByRole("dialog", { name: "New proposal" }).getByRole("button", { name: /^From template/ }).click();
  await page.getByRole("radio", { name: /Content War Chest/ }).click();
  await page.getByRole("dialog", { name: "New proposal" }).getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("dialog", { name: "New proposal" }).getByLabel("Client", { exact: true }).selectOption({ label: "+ New client…" });
  const d = page.getByRole("dialog", { name: "New client" });
  await d.getByLabel("Contact name").fill("Riley Chen");
  const company = `Northwind ${Date.now().toString(36)}`;
  await d.getByLabel("Company").fill(company);
  await d.getByLabel("Email").fill("riley@northwind.test");
  await d.getByRole("button", { name: "Create client" }).click();
  await page.getByRole("button", { name: "Create proposal" }).click();
  await page.waitForURL(/\/app\/proposals\//);
  return { company };
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

const MAILPIT = "http://127.0.0.1:54324";

/** Reads the newest signing code sent to `email` from local Mailpit (like a real inbox). */
export async function latestOtp(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`);
    const list = (await res.json()) as { messages: { ID: string; Subject: string }[] };
    const msg = list.messages.find((m) => /is your code to sign/.test(m.Subject));
    if (msg) return /^(\d{6})/.exec(msg.Subject)![1]!;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No code emailed to ${email}`);
}

/** All subjects Mailpit received for an address. */
export async function mailSubjects(email: string): Promise<string[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=20`);
  return ((await res.json()) as { messages: { Subject: string }[] }).messages.map((m) => m.Subject);
}
