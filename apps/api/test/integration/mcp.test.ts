import type { ClientRow, ProposalDetail, TemplateSummary } from "@bridger/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeAll, describe, expect, it } from "vitest";
import { provider } from "../../src/index.js";
import type { Env } from "../../src/env.js";
import { adminDb, api, env, executionCtx, ownerToken } from "./helpers.js";

const run = Date.now().toString(36);
const E = env();
let call: ReturnType<typeof api>;
let token: string;
let ownerId: string;
let template: TemplateSummary;

/** The whole Worker (OAuth provider + app), in-process. */
const worker = (e: Env = E) => (input: string | URL | Request, init?: RequestInit) => provider.fetch(new Request(input, init), e, executionCtx);
const req = (path: string, init?: RequestInit, e: Env = E) => worker(e)(`http://localhost:5173${path}`, init);

async function mcpClient(bearer: string, e: Env = E) {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost:5173/mcp"), { fetch: worker(e), requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
  await client.connect(transport);
  return client;
}

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const text = (r: ToolResult) => (r.content as { text: string }[])[0]!.text;
const json = <T>(r: ToolResult) => JSON.parse(text(r)) as T;

beforeAll(async () => {
  token = await ownerToken();
  call = api(token);
  template = (await call<TemplateSummary[]>("GET", "/templates")).body.find((t) => t.name === "Content War Chest")!;
  ownerId = (await adminDb().from("settings").select("owner_id").limit(1).single()).data!.owner_id as string;
  await adminDb().from("settings").update({ ai_can_publish: true, ai_can_email_client: false }).eq("owner_id", ownerId);
});

describe("API keys", () => {
  it("are shown once, stored hashed, listed by prefix, and revocable (owner only)", async () => {
    const created = await call<{ id: string; key: string; key_prefix: string }>("POST", "/api-keys", { name: "Claude Code" });
    expect(created.status).toBe(201);
    expect(created.body.key).toMatch(/^bdp_[0-9A-Za-z]{32}$/);
    expect(created.body.key_prefix).toBe(created.body.key.slice(0, 8));
    const { data } = await adminDb().from("api_keys").select("key_hash").eq("id", created.body.id).single();
    expect(data!.key_hash).not.toContain(created.body.key.slice(4));

    // The key works on REST, but can't manage keys or delete anything
    const asKey = api(created.body.key);
    expect((await asKey("GET", "/proposals")).status).toBe(200);
    expect((await asKey("GET", "/api-keys")).status).toBe(403);
    const draft = (await call<ProposalDetail>("POST", "/proposals", { title: `Key draft ${run}` })).body;
    await call("POST", `/proposals/${draft.id}/archive`);
    expect((await asKey("DELETE", `/proposals/${draft.id}`)).status).toBe(403);

    expect((await call("DELETE", `/api-keys/${created.body.id}`)).status).toBe(204);
    expect((await asKey("GET", "/proposals")).status).toBe(401);
  });
});

describe("MCP over an API key (Claude Code)", () => {
  let key: string;
  beforeAll(async () => {
    key = (await call<{ key: string }>("POST", "/api-keys", { name: "Claude Code" })).body.key;
  });

  it("lists every §10.2 tool and no delete tools", async () => {
    const mcp = await mcpClient(key);
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "archive_proposal", "create_client", "create_proposal", "delete_block", "duplicate_proposal", "get_block_schema", "get_client", "get_preview_url",
        "get_proposal", "get_proposal_analytics", "get_template", "get_workspace_context", "insert_block", "list_clients", "list_proposals", "list_templates",
        "move_block", "publish_proposal", "replace_content", "save_as_template", "send_proposal_email", "set_pricing", "update_block", "update_client", "update_proposal_meta",
      ].sort(),
    );
    expect(names.filter((n) => /^delete_(proposal|client|template)/.test(n))).toEqual([]);
    await mcp.close();
  });

  it("creates from a template with custom pricing, previews, and publishes", async () => {
    const mcp = await mcpClient(key);
    const ctx = json<{ servicesCatalog: unknown[] }>(await mcp.callTool({ name: "get_workspace_context", arguments: {} }));
    expect(ctx.servicesCatalog.length).toBeGreaterThan(5);

    const created = json<{ id: string; previewUrl: string }>(
      await mcp.callTool({
        name: "create_proposal",
        arguments: { title: `AI proposal ${run}`, templateId: template.id, client: { name: "Casey Park", company: `Orchard ${run}`, email: `casey.${run}@orchard.test` } },
      }),
    );
    expect(created.previewUrl).toMatch(/\/preview\/[\w-]+\.[\w-]+\.[\w-]+$/);

    // Custom pricing on the template's sections
    const detail = json<ProposalDetail>(await mcp.callTool({ name: "get_proposal", arguments: { proposalId: created.id } }));
    const [pkg, addons] = detail.pricing.sections;
    const pricing = {
      sections: [
        { id: pkg!.id, title: "Package", mode: "choose_one", items: [{ id: "full", name: "Full Chest", quantity: 1, unitPriceCents: 750_000, billing: "one_time", selectedByDefault: true }] },
        { id: addons!.id, title: "Retainer", mode: "fixed", items: [{ id: "mgmt", name: "Posting management", quantity: 1, unitPriceCents: 100_000, billing: "monthly" }] },
      ],
      discounts: [{ id: "d1", label: "Returning client", type: "percent", value: 10, appliesTo: "one_time" }],
    };
    const totals = json<{ totals: { total: { one_time: number; monthly: number } } }>(await mcp.callTool({ name: "set_pricing", arguments: { proposalId: created.id, pricing } })).totals;
    expect(totals.total).toMatchObject({ one_time: 675_000, monthly: 100_000 });

    // Renaming section IDs with set_pricing alone breaks references: the error says what to do
    const renamed = { ...pricing, sections: pricing.sections.map((s, i) => ({ ...s, id: i ? "sec_retainer" : "sec_pkg" })) };
    const broken = await mcp.callTool({ name: "set_pricing", arguments: { proposalId: created.id, pricing: renamed } });
    expect(broken.isError).toBe(true);
    expect(text(broken)).toMatch(/Block \d+ \(pricing\) references unknown pricing section '.+'\. Known sections: 'sec_pkg', 'sec_retainer'/);
    // …and replace_content with both saves them together
    const content = structuredClone(detail.content);
    (content.blocks.find((b) => b.type === "pricing")!.props as { pricingSectionIds: string[] }).pricingSectionIds = ["sec_pkg", "sec_retainer"];
    expect((await mcp.callTool({ name: "replace_content", arguments: { proposalId: created.id, content, pricing: renamed } })).isError).toBeFalsy();

    const preview = json<{ url: string }>(await mcp.callTool({ name: "get_preview_url", arguments: { proposalId: created.id } }));
    const previewRes = await req(`/api/public/preview/${preview.url.split("/preview/")[1]}`);
    expect(previewRes.status).toBe(200);
    expect(JSON.stringify(await previewRes.json())).toContain("Full Chest");

    const published = json<{ published: boolean; publicUrl: string; version: number }>(await mcp.callTool({ name: "publish_proposal", arguments: { proposalId: created.id } }));
    expect(published).toMatchObject({ published: true, version: 1 });
    expect(published.publicUrl).toMatch(/\/p\/[A-Za-z0-9_-]{21}$/);

    const row = (await adminDb().from("proposals").select("created_via, created_via_client, status, total_one_time_cents").eq("id", created.id).single()).data!;
    expect(row).toMatchObject({ created_via: "template", created_via_client: "Claude Code", status: "sent", total_one_time_cents: 675_000 });
    const actors = (await adminDb().from("audit_events").select("actor, event_type").eq("proposal_id", created.id)).data!;
    expect(actors.every((a) => a.actor === "ai:Claude Code")).toBe(true);
    expect(actors.map((a) => a.event_type)).toEqual(expect.arrayContaining(["created", "edited", "published"]));
    await mcp.close();
  });

  it("returns errors a model can act on", async () => {
    const mcp = await mcpClient(key);
    const p = json<{ id: string; blocks: { id: string; type: string }[] }>(await mcp.callTool({ name: "create_proposal", arguments: { title: `Errors ${run}` } }));

    const unknown = await mcp.callTool({ name: "insert_block", arguments: { proposalId: p.id, block: { type: "hero", props: {} } } });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toMatch(/unknown block type 'hero'\. Valid types: cover, heading, text/);

    const badProps = await mcp.callTool({ name: "insert_block", arguments: { proposalId: p.id, block: { type: "heading", props: { level: 7 } } } });
    expect(badProps.isError).toBe(true);
    expect(text(badProps)).toMatch(/Block \d+ \(heading\)/);

    const missing = await mcp.callTool({ name: "update_block", arguments: { proposalId: p.id, blockId: "nope", props: {} } });
    expect(text(missing)).toMatch(/No block with id 'nope'\. Blocks: 1\. cover/);

    const refs = await mcp.callTool({ name: "insert_block", arguments: { proposalId: p.id, block: { type: "pricing", props: { pricingSectionIds: ["sec_retainer"] } } } });
    expect(text(refs)).toMatch(/Block \d+ \(pricing\) references unknown pricing section 'sec_retainer'/);

    const cents = await mcp.callTool({ name: "set_pricing", arguments: { proposalId: p.id, pricing: { sections: [{ id: "s", title: "S", mode: "fixed", items: [{ id: "i", name: "I", quantity: 1, unitPriceCents: 15.5, billing: "one_time" }] }] } } });
    expect(text(cents)).toMatch(/integer cents/);

    const notReady = await mcp.callTool({ name: "publish_proposal", arguments: { proposalId: p.id } });
    expect(text(notReady)).toMatch(/Fix these:\n- .*client needs an email/);

    // A good insert lands before the signature by default
    const ok = json<{ blockId: string; proposal: ProposalDetail }>(await mcp.callTool({ name: "insert_block", arguments: { proposalId: p.id, block: { type: "heading", props: { text: "Our approach" } } } }));
    const types = ok.proposal.content.blocks.map((b) => b.type);
    expect(types.at(-1)).toBe("signature");
    expect(types.at(-2)).toBe("heading");
    await mcp.close();
  });

  it("can't edit signed proposals, and respects the AI permission switches", async () => {
    const mcp = await mcpClient(key);
    const p = (await call<ProposalDetail>("POST", "/proposals", { title: `Locked ${run}` })).body;
    await adminDb().from("proposal_versions").insert({ owner_id: ownerId, proposal_id: p.id, version: 1, content: p.content, pricing: p.pricing, content_hash: "a".repeat(64), reason: "signed" });
    await adminDb().from("proposals").update({ status: "signed", signed_at: new Date().toISOString(), current_version: 1 }).eq("id", p.id);
    const locked = await mcp.callTool({ name: "update_block", arguments: { proposalId: p.id, blockId: p.content.blocks[0]!.id, props: { title: "x" } } });
    expect(locked.isError).toBe(true);
    expect(text(locked)).toMatch(/signed and locked/);

    await adminDb().from("settings").update({ ai_can_publish: false }).eq("owner_id", ownerId);
    try {
      const d = json<{ id: string }>(await mcp.callTool({ name: "create_proposal", arguments: { title: `No publish ${run}` } }));
      const r = await mcp.callTool({ name: "publish_proposal", arguments: { proposalId: d.id } });
      expect(text(r)).toMatch(/Publishing by AI is turned off/);
    } finally {
      await adminDb().from("settings").update({ ai_can_publish: true }).eq("owner_id", ownerId);
    }
    const email = await mcp.callTool({ name: "send_proposal_email", arguments: { proposalId: p.id } });
    expect(text(email)).toMatch(/Emailing clients by AI is turned off/);
    await mcp.close();
  });

  it("rejects missing or revoked credentials", async () => {
    const r = await req("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toMatch(/Bearer/);
    await expect(mcpClient("bdp_" + "x".repeat(32))).rejects.toThrow();
  });
});

describe("OAuth 2.1 with dynamic client registration (Claude.ai / ChatGPT connectors)", () => {
  it("discovers, registers, gets John's consent, exchanges a PKCE code, and calls tools", async () => {
    const meta = await (await req("/.well-known/oauth-authorization-server")).json() as Record<string, string>;
    expect(meta.registration_endpoint).toMatch(/\/oauth\/register$/);
    expect(meta.token_endpoint).toMatch(/\/oauth\/token$/);

    const reg = await (await req("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" }) })).json() as { client_id: string };
    expect(reg.client_id).toBeTruthy();

    const verifier = "v".repeat(20) + run.padEnd(30, "x");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const auth = await req(
      `/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}&state=xyz&code_challenge=${challenge}&code_challenge_method=S256&scope=proposals`,
      { redirect: "manual" },
    );
    expect(auth.status).toBe(302);
    const consentId = auth.headers.get("Location")!.match(/\/app\/connect\/([\w-]+)$/)![1]!;

    // John sees who's asking, then approves (an API key can't approve)
    const owner = (path: string, init: RequestInit = {}) => req(`/api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    expect(await (await owner(`/oauth/consent/${consentId}`)).json()).toMatchObject({ clientName: "Claude", redirectHost: "claude.ai" });
    const approved = await (await owner(`/oauth/consent/${consentId}`, { method: "POST", body: JSON.stringify({ approve: true }) })).json() as { redirectTo: string };
    const redirect = new URL(approved.redirectTo);
    expect(redirect.searchParams.get("state")).toBe("xyz");
    const code = redirect.searchParams.get("code")!;

    const tokenRes = await req("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/api/mcp/auth_callback", client_id: reg.client_id, code_verifier: verifier }),
    });
    const tokens = await tokenRes.json() as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toBeTruthy();

    const mcp = await mcpClient(tokens.access_token);
    const p = json<{ id: string }>(await mcp.callTool({ name: "create_proposal", arguments: { title: `OAuth ${run}`, templateId: template.id } }));
    const { data } = await adminDb().from("audit_events").select("actor").eq("proposal_id", p.id).eq("event_type", "created").single();
    expect(data!.actor).toBe("ai:Claude");
    await mcp.close();

    // The same token works on REST (ChatGPT Actions)
    expect((await req("/api/v1/proposals", { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status).toBe(200);

    // John can see and revoke the connection
    const connections = await (await owner("/connections")).json() as { grantId: string; clientName: string }[];
    const claude = connections.find((c) => c.clientName === "Claude")!;
    expect(claude).toBeTruthy();
    expect((await owner(`/connections/${claude.grantId}`, { method: "DELETE" })).status).toBe(204);
    await expect(mcpClient(tokens.access_token)).rejects.toThrow();
  });

  it("denying sends the client back with access_denied", async () => {
    const reg = await (await req("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_method: "none" }) })).json() as { client_id: string };
    const auth = await req(`/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("https://chatgpt.com/connector_platform_oauth_redirect")}&state=s1&code_challenge=${"a".repeat(43)}&code_challenge_method=S256`, { redirect: "manual" });
    const consentId = auth.headers.get("Location")!.split("/").pop()!;
    const r = await (await req(`/api/v1/oauth/consent/${consentId}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ approve: false }) })).json() as { redirectTo: string };
    expect(new URL(r.redirectTo).searchParams.get("error")).toBe("access_denied");
    expect(new URL(r.redirectTo).searchParams.get("state")).toBe("s1");
  });
});
