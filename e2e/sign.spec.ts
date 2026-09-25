import { expect, test, type Page } from "@playwright/test";
import { adminDb, latestOtp, login, mailSubjects, newTemplateProposal, publishFromEditor, unique } from "./helpers";

test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ page }) => {
  await login(page);
});

async function fillDetails(pub: Page, email: string) {
  const dialog = pub.getByRole("dialog", { name: "Review & accept" });
  await dialog.getByLabel("Full name").fill("Riley Chen");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Title").fill("Owner");
  return dialog;
}

test("publish → open → choose options → verify email → sign → locked, PDF exists, hash verifies", async ({ page, browser }) => {
  await newTemplateProposal(page, unique("Signing"));
  const url = await publishFromEditor(page);
  const proposalId = page.url().split("/").pop()!;
  const email = `riley.${Date.now().toString(36)}@northwind.test`;

  const client = await browser.newContext();
  const pub = await client.newPage();
  await pub.goto(url);
  await pub.getByRole("radio", { name: /Half Chest/ }).click();
  await pub.getByRole("checkbox", { name: "Add Drone footage" }).check();
  await expect(pub.getByLabel("Current total")).toContainText("$5,250.00");

  // Step 1: details + review of what they're accepting
  await pub.getByRole("banner").getByRole("button", { name: "Accept proposal" }).click();
  const details = await fillDetails(pub, email);
  await expect(details).toContainText("Half Chest: 1 shoot day");
  await expect(details).toContainText("Drone footage");
  await expect(details).toContainText("$5,250.00");
  await details.getByRole("button", { name: "Continue" }).click();

  // Step 2: the emailed code
  const verify = pub.getByRole("dialog", { name: "Verify your email" });
  await expect(verify).toContainText(email);
  await verify.getByLabel("Verification code").fill("000000");
  await verify.getByRole("button", { name: "Verify" }).click();
  await expect(verify.getByRole("alert")).toContainText(/isn't right/);
  await verify.getByLabel("Verification code").fill(await latestOtp(email));
  await verify.getByRole("button", { name: "Verify" }).click();

  // Step 3: signature + consent
  const sign = pub.getByRole("dialog", { name: "Sign" });
  await expect(sign.getByLabel("Type your full name")).toHaveValue("Riley Chen");
  await expect(sign.getByRole("button", { name: "Sign & Accept" })).toBeDisabled();
  await sign.getByRole("checkbox").check();
  await expect(sign).toContainText("I am authorized to accept this proposal on behalf of Northwind");
  await sign.getByRole("button", { name: "Sign & Accept" }).click();
  const done = pub.getByRole("dialog", { name: "Thank you!" });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Close", exact: true }).click();
  await expect(done).toBeHidden();
  await expect(pub.getByRole("button", { name: "Accept & sign" })).toHaveCount(0);

  // The page reflects the signature and the client's choices
  await pub.reload();
  await expect(pub.getByText("Signed", { exact: true })).toBeVisible();
  const sigBlock = pub.locator("[data-block-type='signature']");
  await expect(sigBlock).toContainText("Riley Chen");
  await expect(sigBlock).toContainText(/Certificate BDP-/);
  await expect(pub.getByLabel("Current total")).toContainText("$5,250.00");
  await expect(pub.getByRole("button", { name: "Accept & sign" })).toHaveCount(0);

  // The signed PDF gets rendered (Browser Rendering, locally) and stored with its hash
  await expect(pub.getByRole("link", { name: "Download PDF" })).toBeVisible({ timeout: 90_000 });
  const { data: sig } = await adminDb().from("signatures").select("pdf_path, pdf_hash, document_hash").eq("proposal_id", proposalId).single();
  expect(sig!.pdf_path).toMatch(/\.pdf$/);
  expect(sig!.pdf_hash).toMatch(/^[0-9a-f]{64}$/);
  const pdf = await pub.request.get(`/api/public/proposals/${url.split("/p/")[1]}/signed.pdf`);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(20_000);

  // Signed copy emailed to the signer
  await expect.poll(() => mailSubjects(email), { timeout: 30_000 }).toContainEqual(expect.stringMatching(/^Your signed copy/));

  // The hash verifies on the public certificate page
  await pub.getByRole("link", { name: /Certificate BDP-/ }).click();
  await expect(pub.getByRole("status")).toContainText("✓ Verified");
  await expect(pub.getByText(sig!.document_hash)).toBeVisible();
  await client.close();

  // The owner's editor is locked, with the signature details
  await page.reload();
  await expect(page.getByText(/Signed by Riley Chen/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Duplicate as new revision" })).toBeVisible();
  await expect(page.locator(".proposal-editor")).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("link", { name: "Signed PDF" })).toBeVisible();
});

test("signing a stale version returns 409 and asks the client to review", async ({ page, browser }) => {
  await newTemplateProposal(page, unique("Stale"));
  const url = await publishFromEditor(page);
  const email = `stale.${Date.now().toString(36)}@northwind.test`;

  const client = await browser.newContext();
  const pub = await client.newPage();
  await pub.goto(url);
  await pub.getByRole("banner").getByRole("button", { name: "Accept proposal" }).click();
  const details = await fillDetails(pub, email);
  await details.getByRole("button", { name: "Continue" }).click();
  const verify = pub.getByRole("dialog", { name: "Verify your email" });
  await verify.getByLabel("Verification code").fill(await latestOtp(email));
  await verify.getByRole("button", { name: "Verify" }).click();
  await expect(pub.getByRole("dialog", { name: "Sign" })).toBeVisible();

  // Meanwhile the owner changes the proposal and republishes.
  await page.locator("[data-block-type='cover']").hover();
  await page.locator("[data-block-type='cover']").getByRole("button", { name: "Insert line below" }).click();
  await page.keyboard.type("Added after the client opened it.");
  await publishFromEditor(page, "Update");

  const sign = pub.getByRole("dialog", { name: "Sign" });
  await sign.getByRole("checkbox").check();
  const response = pub.waitForResponse((r) => r.url().endsWith("/sign"));
  await sign.getByRole("button", { name: "Sign & Accept" }).click();
  expect((await response).status()).toBe(409);
  await expect(sign.getByRole("alert")).toContainText("This proposal was updated");
  await sign.getByRole("button", { name: "Load the latest version" }).click();
  await expect(pub.getByText("Added after the client opened it.")).toBeVisible();
  await client.close();
});

test("declining shows the declined page and updates the status", async ({ page, browser }) => {
  await newTemplateProposal(page, unique("Decline"));
  const url = await publishFromEditor(page);
  const client = await browser.newContext();
  const pub = await client.newPage();
  await pub.goto(url);
  await pub.getByRole("button", { name: "Decline this proposal" }).click();
  const dialog = pub.getByRole("dialog", { name: "Decline this proposal?" });
  await dialog.getByLabel("Reason (optional)").fill("Going another direction");
  await dialog.getByRole("button", { name: "Decline proposal" }).click();
  await expect(pub.getByText(/This proposal was declined/)).toBeVisible();
  await expect(pub.getByRole("link", { name: "Get in touch" })).toBeVisible();
  await client.close();
  await page.reload();
  await expect(page.getByText("declined", { exact: true })).toBeVisible();
});
