import { expect, test } from "@playwright/test";
import { adminDb, expectSaved, focusBeforeSignature, login, newTemplateProposal, publishFromEditor, unique } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("a published link works in a private window, with live pricing", async ({ page, browser }) => {
  const title = unique("Live link");
  await newTemplateProposal(page, title);
  const url = await publishFromEditor(page);
  expect(url).toMatch(/\/p\/[A-Za-z0-9_-]{21}$/);
  await expect(page.getByRole("button", { name: "Published ✓" })).toBeDisabled();

  // A fresh context has no session: like a client opening the link.
  const client = await browser.newContext();
  const pub = await client.newPage();
  await pub.goto(url);
  await expect(pub.locator("[data-block-type='cover']")).toContainText("Content War Chest");
  await expect(pub).toHaveTitle(new RegExp(title));
  const total = pub.getByLabel("Current total");
  await expect(total).toContainText("$8,000.00");

  // Client picks the smaller package and an add-on; totals follow.
  await pub.getByRole("radio", { name: /Half Chest/ }).click();
  await expect(total).toContainText("$4,500.00");
  await pub.getByRole("checkbox", { name: "Add Drone footage" }).check();
  await expect(total).toContainText("$5,250.00");
  await pub.getByRole("checkbox", { name: "Add Posting management" }).check();
  await expect(total).toContainText("$1,250.00/mo");

  // The call-to-action button scrolls to the signature; the header's Accept opens signing.
  await pub.locator("[data-block-type='cta']").getByRole("button", { name: "Accept proposal" }).click();
  await expect(pub.locator("[data-block-type='signature']")).toBeInViewport();
  await pub.getByRole("banner").getByRole("button", { name: "Accept proposal" }).click();
  await expect(pub.getByRole("dialog", { name: "Review & accept" })).toBeVisible();
  await pub.keyboard.press("Escape");

  // The editor's forms never leak into the client view.
  await expect(pub.locator("[data-object-editor], [data-object-toolbar]")).toHaveCount(0);
  await client.close();
});

test("editing and republishing bumps the version on the same link", async ({ page, browser }) => {
  await newTemplateProposal(page, unique("Versions"));
  const url = await publishFromEditor(page);

  await focusBeforeSignature(page);
  await page.keyboard.type("A late addition to the proposal.");
  await expectSaved(page);
  await expect(page.getByText("Unpublished changes")).toBeVisible();

  const client = await browser.newContext();
  const pub = await client.newPage();
  await pub.goto(url);
  await expect(pub.locator("[data-block-type='cover']")).toBeVisible();
  await expect(pub.getByText("A late addition to the proposal.")).toHaveCount(0);

  const url2 = await publishFromEditor(page, "Update");
  expect(url2).toBe(url);
  await expect(page.getByText("Unpublished changes")).toBeHidden();
  await pub.reload();
  await expect(pub.getByText("A late addition to the proposal.")).toBeVisible();
  await client.close();
});

test("drafts are never visible publicly, and incomplete proposals can't be published", async ({ page, browser }) => {
  await page.getByRole("button", { name: "+ New proposal" }).click();
  await page.getByLabel("Title").fill(unique("Draft"));
  await page.getByRole("button", { name: "Create proposal" }).click();
  await page.waitForURL(/\/app\/proposals\//);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const issues = page.getByRole("dialog", { name: "Almost ready to publish" });
  await expect(issues).toContainText("The proposal's client needs an email address");
  await expect(issues).toContainText("Add at least one pricing section");
  await issues.getByRole("button", { name: "OK" }).click();

  const id = page.url().split("/").pop()!;
  const { data } = await adminDb().from("proposals").select("slug").eq("id", id).single();
  const client = await browser.newContext();
  const pub = await client.newPage();
  await pub.goto(`/p/${data!.slug}`);
  await expect(pub.getByRole("heading", { name: "This proposal isn't available" })).toBeVisible();
  await client.close();
});

test("expired proposals show a branded page with an extension request", async ({ page, browser }) => {
  await newTemplateProposal(page, unique("Expired"));
  const url = await publishFromEditor(page);
  const id = page.url().split("/").pop()!;
  await adminDb().from("proposals").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", id);

  const client = await browser.newContext();
  const pub = await client.newPage();
  await pub.goto(url);
  await expect(pub.getByText(/This proposal expired/)).toBeVisible();
  await expect(pub.locator("[data-block-type='pricing']")).toHaveCount(0);
  await pub.getByLabel("Message (optional)").fill("Can we have two more weeks?");
  await pub.getByRole("button", { name: "Request an extension" }).click();
  await expect(pub.getByRole("status")).toContainText("We've been notified");
  await client.close();

  const { data } = await adminDb().from("audit_events").select("event_type").eq("proposal_id", id).eq("event_type", "extension_requested");
  expect(data).toHaveLength(1);
});

test("print view has no header or interactive controls", async ({ page, browser }) => {
  await newTemplateProposal(page, unique("Print"));
  const url = await publishFromEditor(page);
  const client = await browser.newContext();
  const pub = await client.newPage();
  await pub.goto(`${url}?print=1`);
  await expect(pub.locator("[data-block-type='cover']")).toBeVisible();
  await expect(pub.getByLabel("Current total")).toHaveCount(0);
  await expect(pub.getByRole("button", { name: "Accept proposal" })).toHaveCount(0);
  await expect(pub.getByRole("radio", { name: /Half Chest/ })).toBeDisabled();
  await client.close();
});
