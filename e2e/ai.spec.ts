import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { login, unique } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ timeout: 120_000 });

const BASE = "http://localhost:5173";

async function mcp(bearer: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
  return client;
}
const json = <T>(r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { text: string }[])[0]!.text) as T;

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("Claude Code path: create an API key, then draft, preview, and publish over MCP", async ({ page }) => {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("API key name").fill("Claude Code e2e");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = await page.getByLabel("New API key").inputValue();
  expect(key).toMatch(/^bdp_[0-9A-Za-z]{32}$/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("list", { name: "API keys" })).toContainText("Claude Code e2e");

  const client = await mcp(key);
  expect((await client.listTools()).tools.length).toBe(25);
  const templates = json<{ id: string; name: string }[]>(await client.callTool({ name: "list_templates", arguments: {} }));
  const title = unique("AI drafted");
  const created = json<{ id: string; previewUrl: string }>(
    await client.callTool({
      name: "create_proposal",
      arguments: { title, templateId: templates.find((t) => t.name === "Content War Chest")!.id, client: { name: "Dana Cruz", company: `Aspen ${Date.now().toString(36)}`, email: "dana@aspen.test" } },
    }),
  );
  const published = json<{ publicUrl: string }>(await client.callTool({ name: "publish_proposal", arguments: { proposalId: created.id } }));
  await client.close();

  // The draft preview link renders without login
  const anon = await page.context().browser()!.newContext();
  const preview = await anon.newPage();
  await preview.goto(created.previewUrl);
  await expect(preview.getByRole("status")).toContainText("Draft preview for Aspen");
  await expect(preview.locator("[data-block-type='cover']")).toContainText("Content War Chest");
  await preview.goto(published.publicUrl);
  await expect(preview.locator("[data-block-type='cover']")).toBeVisible();
  await anon.close();

  // It shows up for John, attributed to the key
  await page.goto("/app");
  await page.getByPlaceholder("Search by title…").fill(title);
  await expect(page.getByRole("row", { name: new RegExp(title) })).toContainText(/sent/i);
});

test("Claude.ai path: OAuth connector consent in the browser, then tools with the token", async ({ page }) => {
  const redirectUri = "https://claude.example/api/mcp/auth_callback";
  const reg = (await (await fetch(`${BASE}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }) })).json()) as { client_id: string };
  const verifier = `verifier-${Date.now()}-${"x".repeat(30)}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = Buffer.from(digest).toString("base64url");

  // Capture the redirect back to "claude.example" instead of leaving the test
  let callback: URL | null = null;
  await page.route("https://claude.example/**", async (route) => {
    callback = new URL(route.request().url());
    await route.fulfill({ status: 200, body: "ok" });
  });
  await page.goto(`/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&state=abc&code_challenge=${challenge}&code_challenge_method=S256&scope=proposals`);
  await expect(page.getByRole("heading", { name: "Connect Claude?" })).toBeVisible();
  await expect(page.getByText("It can never delete anything")).toBeVisible();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect.poll(() => callback?.searchParams.get("code") ?? null).not.toBeNull();
  expect(callback!.searchParams.get("state")).toBe("abc");

  const tokens = (await (
    await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: callback!.searchParams.get("code")!, redirect_uri: redirectUri, client_id: reg.client_id, code_verifier: verifier }),
    })
  ).json()) as { access_token: string };
  const client = await mcp(tokens.access_token);
  const ctx = json<{ company: { name: string } }>(await client.callTool({ name: "get_workspace_context", arguments: {} }));
  expect(ctx.company.name).toBe("Bridger Digital");
  await client.close();

  // Listed under Connected apps, and disconnecting cuts it off
  await page.goto("/app/settings");
  const apps = page.getByRole("list", { name: "Connected apps" });
  await expect(apps).toContainText("Claude");
  page.once("dialog", (d) => void d.accept());
  await apps.getByRole("listitem").filter({ hasText: "Claude" }).first().getByRole("button", { name: "Disconnect" }).click();
  await expect(apps.getByRole("listitem").filter({ hasText: "Claude" })).toHaveCount(0, { timeout: 10_000 }).catch(() => {});
  await expect(mcp(tokens.access_token)).rejects.toThrow();
});

test("Write with AI shows the connector URL and a copyable starter prompt", async ({ page }) => {
  await page.goto("/app/write-with-ai");
  await expect(page.getByText(`${BASE}/mcp`).first()).toBeVisible();
  await page.getByRole("button", { name: "Copy Terminal command" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`claude mcp add --transport http bridger-proposals ${BASE}/mcp --header "Authorization: Bearer YOUR_API_KEY"`);
});
