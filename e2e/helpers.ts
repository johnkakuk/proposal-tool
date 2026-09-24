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
  const para = page.locator("xpath=//div[contains(@class,'proposal-editor')]/p[following-sibling::*[1][descendant-or-self::*[@data-block-type='signature']]]");
  await para.click();
  await page.keyboard.press("End");
  if ((await para.textContent())?.trim()) await page.keyboard.press("Enter");
}

export async function slash(page: Page, query: string) {
  await page.keyboard.type(`/${query}`);
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();
  await page.keyboard.press("Enter");
}
