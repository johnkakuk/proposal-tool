import { devices, expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { adminDb, login, newTemplateProposal, publishFromEditor, unique } from "./helpers";

test.describe.configure({ timeout: 120_000 });

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** A browser that looks like a real client (automation markers removed). */
async function clientPage(browser: Browser, opts: BrowserContextOptions = {}): Promise<Page> {
  const ctx = await browser.newContext({ userAgent: CHROME_UA, viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  return ctx.newPage();
}

async function sessionsFor(proposalId: string) {
  const { data } = await adminDb().from("view_sessions").select("id, is_owner, is_bot, device, active_ms").eq("proposal_id", proposalId);
  return data ?? [];
}

/** Clicks (or taps) at a position given as a fraction of a block's box. */
async function hitBlock(page: Page, blockType: string, fx: number, fy: number, tap = false) {
  const box = (await page.locator(`[data-block-type='${blockType}']`).first().boundingBox())!;
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  if (tap) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("a bounce of 3 seconds or less doesn't create a session", async ({ page, browser }) => {
  await newTemplateProposal(page, unique("Bounce"));
  const url = await publishFromEditor(page);
  const id = page.url().split("/").pop()!.split("?")[0]!;
  const client = await clientPage(browser);
  await client.goto(url);
  await client.waitForTimeout(2_000);
  await client.context().close();
  await page.waitForTimeout(2_500);
  expect(await sessionsFor(id)).toEqual([]);
});

test("owner and bot visits never count; a real reader does", async ({ page, browser }) => {
  await newTemplateProposal(page, unique("Counting"));
  const url = await publishFromEditor(page);
  const id = page.url().split("/").pop()!.split("?")[0]!;

  // Owner: the signed-in admin opening the client link in the same browser
  const owner = await page.context().newPage();
  await owner.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  await owner.goto(url);
  await owner.mouse.move(400, 400);
  await owner.waitForTimeout(6_000);
  await owner.close();

  // A link-preview bot that runs JavaScript
  const bot = await clientPage(browser, { userAgent: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" });
  await bot.goto(url);
  await bot.waitForTimeout(6_000);
  await bot.context().close();

  // A real reader: reads, scrolls, and stays past 5 s of active time
  const reader = await clientPage(browser);
  await reader.goto(url);
  for (let i = 0; i < 8; i++) {
    await reader.mouse.move(300 + i * 40, 300 + i * 20);
    await reader.mouse.wheel(0, 250);
    await reader.waitForTimeout(1_000);
  }
  await expect.poll(async () => (await sessionsFor(id)).find((s) => !s.is_bot && !s.is_owner)?.active_ms ?? 0, { timeout: 30_000 }).toBeGreaterThan(4_000);
  await reader.context().close();

  const sessions = await sessionsFor(id);
  expect(sessions.filter((s) => s.is_owner)).toHaveLength(0); // the tracker never even starts for the owner
  expect(sessions.filter((s) => s.is_bot)).toHaveLength(1);
  expect(sessions.filter((s) => !s.is_bot && !s.is_owner)).toHaveLength(1);

  // Analytics and the dashboard count only the reader
  await page.reload();
  await page.getByRole("button", { name: "Analytics" }).click();
  const drawer = page.getByRole("complementary", { name: "Analytics" });
  await expect(drawer).toContainText("1 unique viewer");
  await drawer.getByRole("tab", { name: "Sections" }).click();
  await expect(drawer.getByRole("list", { name: "Average visible time per section" })).toContainText("Cover: Content War Chest");
  await page.getByRole("link", { name: "Back to proposals" }).click();
  const title = await page.getByRole("link", { name: /^Counting / }).first().textContent();
  const row = page.getByRole("row", { name: new RegExp(title!) });
  await expect(row).toContainText(/viewed/i);
  await expect(row.getByRole("cell").nth(4)).toHaveText("1"); // Views column
});

test("the heatmap puts clicks in the right spots on desktop and mobile", async ({ page, browser }) => {
  await newTemplateProposal(page, unique("Heatmap"));
  const url = await publishFromEditor(page);
  const id = page.url().split("/").pop()!.split("?")[0]!;

  const desktop = await clientPage(browser);
  await desktop.goto(url);
  await desktop.waitForTimeout(3_500); // session starts after 3 s visible
  await hitBlock(desktop, "cover", 0.25, 0.5);
  await hitBlock(desktop, "cover", 0.26, 0.52);

  const mobile = await clientPage(browser, { ...devices["iPhone 13"], userAgent: IPHONE_UA });
  await mobile.goto(url);
  await mobile.waitForTimeout(3_500);
  await hitBlock(mobile, "cover", 0.75, 0.5, true);

  // Both flush within ~15 s (mouse movement on the way to a click is recorded too, as "move")
  await expect
    .poll(async () => (await adminDb().from("heatmap_points").select("id", { count: "exact", head: true }).eq("proposal_id", id).in("kind", ["click", "tap"])).count, { timeout: 30_000 })
    .toBe(3);
  await desktop.context().close();
  await mobile.context().close();

  const { data: points } = await adminDb().from("heatmap_points").select("kind, device, x_pct, y_pct").eq("proposal_id", id).in("kind", ["click", "tap"]).order("device");
  const d = points!.filter((p) => p.device === "desktop");
  const m = points!.filter((p) => p.device === "mobile");
  expect(d.every((p) => p.kind === "click" && Math.abs(p.x_pct - 0.255) < 0.02 && Math.abs(p.y_pct - 0.51) < 0.03)).toBe(true);
  expect(m).toHaveLength(1);
  expect(m[0]!.kind).toBe("tap");
  expect(Math.abs(m[0]!.x_pct - 0.75) < 0.02 && Math.abs(m[0]!.y_pct - 0.5) < 0.03).toBe(true);

  // The owner's heatmap view draws them
  await page.reload();
  await page.getByRole("button", { name: "Analytics" }).click();
  const drawer = page.getByRole("complementary", { name: "Analytics" });
  await drawer.getByRole("tab", { name: "Heatmap" }).click();
  const canvas = page.getByTestId("heatmap-canvas");
  await expect(canvas).toHaveAttribute("data-cells", /^[12]$/); // two nearby desktop clicks: one or two grid cells
  await drawer.getByLabel("Heatmap device").selectOption("mobile");
  await expect(canvas).toHaveAttribute("data-cells", "1");
  await expect(page.getByTestId("version-canvas")).toHaveClass(/max-w-\[390px\]/);
});
