import { expect, test } from "@playwright/test";
import { login, newTemplateProposal, publishFromEditor, unique } from "./helpers";

const MAILPIT = "http://127.0.0.1:54324";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("send the proposal to the client by email", async ({ page }) => {
  const title = unique("Emailed");
  await newTemplateProposal(page, title);
  await publishFromEditor(page);
  await page.getByRole("button", { name: "⋯" }).click();
  await page.getByRole("menuitem", { name: "Send email…" }).click();
  const dialog = page.getByRole("dialog", { name: "Email this proposal" });
  await expect(dialog).toContainText("riley@northwind.test");
  await dialog.getByLabel("Message").fill("Hi Riley,\n\nHere it is. Unique marker " + title);
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByRole("status")).toContainText("Sent to riley@northwind.test");

  const search = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"Proposal: ${title}"`)}`)).json();
  expect(search.messages).toHaveLength(1);
  const msg = await (await fetch(`${MAILPIT}/api/v1/message/${search.messages[0].ID}`)).json();
  expect(msg.To[0].Address).toBe("riley@northwind.test");
  expect(msg.ReplyTo[0].Address).toBe("owner@bridger.local");
  expect(msg.Text).toContain("Unique marker " + title);
  expect(msg.HTML).toMatch(/href="http:\/\/localhost:5173\/p\/[A-Za-z0-9_-]{21}"/);
});

test("notification settings toggle and persist", async ({ page }) => {
  await page.getByRole("link", { name: "Settings" }).click();
  const digest = page.getByRole("switch", { name: "Daily digest" });
  await expect(digest).toHaveAttribute("aria-checked", "false");
  await digest.click();
  await expect(digest).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "Daily digest" }).click();
  await expect(page.getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "false");
});
