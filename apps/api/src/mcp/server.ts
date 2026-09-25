import {
  ClientInputSchema,
  ClientPatchSchema,
  CreateProposalSchema,
  DuplicateProposalSchema,
  InsertBlockSchema,
  ListProposalsQuerySchema,
  MoveBlockSchema,
  PricingSchema,
  ProposalContentSchema,
  SaveAsTemplateSchema,
  SendProposalEmailSchema,
  UpdateBlockSchema,
  UpdateProposalMetaSchema,
  getBlockSchemaDocument,
  zodIssues,
} from "@bridger/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { serviceClient } from "../lib/supabase.js";
import * as analytics from "../services/analytics.js";
import * as blocks from "../services/blocks.js";
import * as clients from "../services/clients.js";
import type { ServiceContext } from "../services/context.js";
import { onAiDraftCreated, onAiPublished } from "../services/notify.js";
import { createPreviewUrl } from "../services/preview.js";
import * as proposals from "../services/proposals.js";
import { publishProposal } from "../services/publish.js";
import { sendProposalEmail } from "../services/sendProposal.js";
import * as templates from "../services/templates.js";
import { getWorkspaceContext } from "../services/workspace.js";

/**
 * MCP server (SPEC §10). Stateless Streamable HTTP: one server per request, authenticated
 * by the OAuth provider (Claude.ai / ChatGPT connectors) or an API key (Claude Code).
 * Every tool calls the same services as REST v1. There are no delete tools; the AI can
 * archive, never delete. Mutations are audited as `ai:<client>` with created_via = mcp.
 */

/** Set on ctx.props by the OAuth provider (grant props) or resolveExternalToken (API key). */
export interface McpProps {
  ownerId: string;
  clientName: string;
  principal: "oauth" | "api_key";
}

const INSTRUCTIONS = `Bridger Digital Proposals: write, publish, and track client proposals.
Typical flow: get_workspace_context → list_templates → create_proposal (from the closest template, with client details) → adjust with update_block / insert_block / set_pricing → get_preview_url (share it for review) → publish_proposal.
Rules: money is integer cents ($1,500.00 = 150000). Proposals are always created as drafts. Exactly one signature block, last. Signed proposals are locked. Call get_block_schema before writing blocks by hand. Errors name the block and field to fix.`;

const uuid = z.string().describe("UUID");
const anyJson = (description: string) => z.any().describe(description);

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Turns service errors into specific, actionable tool errors (SPEC §10.1). */
function fail(e: unknown): CallToolResult {
  let text: string;
  if (e instanceof ApiError) {
    text = `${e.message}${e.issues?.length ? `\n\nFix these:\n${e.issues.map((i) => `- ${i.message}`).join("\n")}` : ""}`;
  } else if (e instanceof z.ZodError) {
    text = `Invalid input:\n${zodIssues(e).map((i) => `- ${i.message}`).join("\n")}`;
  } else {
    console.error("MCP tool failed", e);
    text = "Something went wrong on the server. Try again, or ask John to check.";
  }
  return { isError: true, content: [{ type: "text", text }] };
}

const run = (fn: () => Promise<unknown>) => async (): Promise<CallToolResult> => {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
};

/** Parses with the real (strict) schema so errors carry block/field detail. */
function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = zodIssues(r.error, value);
    throw new ApiError(422, "invalid_input", issues.map((i) => i.message).join("; "), issues);
  }
  return r.data;
}

export function buildMcpServer(env: Env, exec: ExecutionContext, props: McpProps): McpServer {
  const server = new McpServer({ name: "bridger-digital-proposals", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const ctx = (): ServiceContext => ({
    db: serviceClient(env),
    ownerId: props.ownerId,
    actor: `ai:${props.clientName}`,
    principal: props.principal,
    createdVia: "mcp",
    createdViaClient: props.clientName,
  });
  const readOnly = { readOnlyHint: true, destructiveHint: false } as const;
  const edit = { readOnlyHint: false, destructiveHint: false } as const;

  server.registerTool(
    "get_workspace_context",
    { description: "Brand, company info, default terms, John's writing guidelines, templates, and a services/pricing catalog from the templates. Call this first.", annotations: readOnly },
    run(() => getWorkspaceContext(ctx())),
  );
  server.registerTool(
    "get_block_schema",
    { description: "JSON Schema for proposal content and pricing, with an example of every block type and the rules. Call before writing blocks.", annotations: readOnly },
    run(async () => getBlockSchemaDocument()),
  );

  // Templates
  server.registerTool("list_templates", { description: "List proposal templates.", annotations: readOnly }, run(() => templates.listTemplates(ctx())));
  server.registerTool(
    "get_template",
    { description: "A template's full content and pricing.", inputSchema: { templateId: uuid }, annotations: readOnly },
    async ({ templateId }) => run(() => templates.getTemplate(ctx(), templateId))(),
  );

  // Clients
  server.registerTool(
    "list_clients",
    { description: "List clients, optionally searching name, company, or email.", inputSchema: { query: z.string().optional() }, annotations: readOnly },
    async ({ query }) => run(() => clients.listClients(ctx(), query))(),
  );
  server.registerTool(
    "get_client",
    { description: "A client and their proposals.", inputSchema: { clientId: uuid }, annotations: readOnly },
    async ({ clientId }) => run(() => clients.getClient(ctx(), clientId))(),
  );
  server.registerTool(
    "create_client",
    {
      description: "Create a client.",
      inputSchema: { name: z.string(), company: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), website: z.string().optional(), notes: z.string().optional() },
      annotations: edit,
    },
    async (input) => run(() => clients.createClient(ctx(), parse(ClientInputSchema, input)))(),
  );
  server.registerTool(
    "update_client",
    {
      description: "Update a client's details.",
      inputSchema: { clientId: uuid, name: z.string().optional(), company: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), website: z.string().optional(), notes: z.string().optional() },
      annotations: edit,
    },
    async ({ clientId, ...patch }) => run(() => clients.updateClient(ctx(), clientId, parse(ClientPatchSchema, patch)))(),
  );

  // Proposals
  server.registerTool(
    "list_proposals",
    {
      description: "List proposals, filtered by status, client, or title.",
      inputSchema: { status: z.enum(["draft", "sent", "viewed", "signed", "declined", "expired", "archived"]).optional(), clientId: uuid.optional(), query: z.string().optional() },
      annotations: readOnly,
    },
    async ({ status, clientId, query }) => run(() => proposals.listProposals(ctx(), parse(ListProposalsQuerySchema, { status, clientId, q: query })))(),
  );
  server.registerTool(
    "get_proposal",
    { description: "Full proposal JSON (content + pricing), status, and computed totals.", inputSchema: { proposalId: uuid }, annotations: readOnly },
    async ({ proposalId }) => run(() => proposals.getProposal(ctx(), proposalId))(),
  );
  server.registerTool(
    "create_proposal",
    {
      description:
        "Create a DRAFT proposal. Pass clientId, or `client` to create one inline. Use templateId to start from a template (its {{client_name}} and {{default_terms}} are filled in), and/or pass full `content`/`pricing`. Returns the ID, editor URL, and preview URL.",
      inputSchema: {
        title: z.string(),
        clientId: uuid.optional(),
        client: z.object({ name: z.string(), company: z.string().optional(), email: z.string().optional() }).optional().describe("New client, instead of clientId"),
        templateId: uuid.optional(),
        content: anyJson("Optional full ProposalContent (see get_block_schema)").optional(),
        pricing: anyJson("Optional full Pricing object (money in integer cents)").optional(),
        expiresAt: z.string().optional().describe("ISO date-time"),
      },
      annotations: edit,
    },
    async (input) =>
      run(async () => {
        const c = ctx();
        const p = await proposals.createProposal(c, parse(CreateProposalSchema, input));
        exec.waitUntil(onAiDraftCreated(env, c.db, p.id, props.clientName));
        const preview = await createPreviewUrl(c, env, p.id);
        return {
          id: p.id,
          title: p.title,
          status: p.status,
          editorUrl: `${env.APP_URL.replace(/\/$/, "")}/app/proposals/${p.id}`,
          previewUrl: preview.url,
          blocks: p.content.blocks.map((b, i) => ({ index: i, id: b.id, type: b.type })),
          totals: p.totals?.total ?? null,
        };
      })(),
  );
  server.registerTool(
    "update_proposal_meta",
    { description: "Change title, client, or expiry date.", inputSchema: { proposalId: uuid, title: z.string().optional(), clientId: uuid.nullable().optional(), expiresAt: z.string().nullable().optional() }, annotations: edit },
    async ({ proposalId, ...meta }) => run(() => proposals.updateProposal(ctx(), proposalId, parse(UpdateProposalMetaSchema, meta)))(),
  );
  server.registerTool(
    "replace_content",
    {
      description:
        "Replace all blocks with a full, valid ProposalContent (see get_block_schema). Optionally pass `pricing` too: use this when pricing section IDs change, so pricing blocks and sections are saved together.",
      inputSchema: { proposalId: uuid, content: anyJson("ProposalContent: { schemaVersion: 1, blocks: [...] }"), pricing: anyJson("Optional Pricing to save in the same step").optional() },
      annotations: edit,
    },
    async ({ proposalId, content, pricing }) =>
      run(() => blocks.replaceContent(ctx(), proposalId, parse(ProposalContentSchema, content), pricing === undefined ? undefined : parse(PricingSchema, pricing)))(),
  );
  server.registerTool(
    "insert_block",
    {
      description: "Insert one block. Position: { index }, { afterBlockId }, { beforeBlockId }, or \"end\" (default: just before the signature). Missing props get defaults.",
      inputSchema: {
        proposalId: uuid,
        block: z.object({ type: z.string(), props: z.record(z.string(), z.any()).optional(), id: z.string().optional(), hidden: z.boolean().optional() }),
        position: anyJson('{ "index": 2 } | { "afterBlockId": "…" } | { "beforeBlockId": "…" } | "end"').optional(),
      },
      annotations: edit,
    },
    async ({ proposalId, block, position }) => run(() => blocks.insertBlock(ctx(), proposalId, parse(InsertBlockSchema, { block, position })))(),
  );
  server.registerTool(
    "update_block",
    { description: "Merge props into one block (by ID), or hide/show it.", inputSchema: { proposalId: uuid, blockId: z.string(), props: z.record(z.string(), z.any()).optional(), hidden: z.boolean().optional() }, annotations: edit },
    async ({ proposalId, blockId, props: p, hidden }) => run(() => blocks.updateBlock(ctx(), proposalId, blockId, parse(UpdateBlockSchema, { props: p, hidden })))(),
  );
  server.registerTool(
    "delete_block",
    { description: "Remove one block from a draft (not the proposal itself).", inputSchema: { proposalId: uuid, blockId: z.string() }, annotations: { ...edit, destructiveHint: true } },
    async ({ proposalId, blockId }) => run(() => blocks.deleteBlock(ctx(), proposalId, blockId))(),
  );
  server.registerTool(
    "move_block",
    { description: "Move a block to a new position.", inputSchema: { proposalId: uuid, blockId: z.string(), position: anyJson('{ "index": 0 } | { "afterBlockId": "…" } | { "beforeBlockId": "…" } | "end"') }, annotations: edit },
    async ({ proposalId, blockId, position }) => run(() => blocks.moveBlock(ctx(), proposalId, blockId, parse(MoveBlockSchema, { position }).position))(),
  );
  server.registerTool(
    "set_pricing",
    {
      description:
        "Replace the whole pricing object. Returns the recomputed totals so you can check the math. Keep the section IDs the pricing blocks reference (see get_proposal); to change section IDs, use replace_content with both content and pricing.",
      inputSchema: { proposalId: uuid, pricing: anyJson("Pricing: { sections: [...], discounts: [...], taxRatePct?, notes? } — money in integer cents") },
      annotations: edit,
    },
    async ({ proposalId, pricing }) =>
      run(async () => {
        const p = await blocks.setPricing(ctx(), proposalId, parse(PricingSchema, pricing));
        return { totals: p.totals, sections: p.totals?.sections.map((s) => ({ sectionId: s.sectionId, title: s.title, total: s.total })) };
      })(),
  );
  server.registerTool(
    "get_preview_url",
    { description: "A signed link to preview the current draft, valid for 1 hour and never tracked. Share it with John for review.", inputSchema: { proposalId: uuid }, annotations: readOnly },
    async ({ proposalId }) => run(() => createPreviewUrl(ctx(), env, proposalId))(),
  );
  server.registerTool(
    "publish_proposal",
    { description: "Run the pre-publish checks and publish (only if John allows AI publishing). Returns the public link to send the client.", inputSchema: { proposalId: uuid }, annotations: { ...edit, openWorldHint: true } },
    async ({ proposalId }) =>
      run(async () => {
        const c = ctx();
        const r = await publishProposal(c, proposalId, env.APP_URL);
        if (r.published) exec.waitUntil(onAiPublished(env, c.db, r.proposal.id, props.clientName, r.proposal.current_version));
        return { published: r.published, publicUrl: r.publicUrl, version: r.proposal.current_version, status: r.proposal.status, expiresAt: r.proposal.expires_at };
      })(),
  );
  server.registerTool(
    "send_proposal_email",
    { description: "Email the proposal link to the client (only if John allows it). Optional personal message.", inputSchema: { proposalId: uuid, message: z.string().optional() }, annotations: { ...edit, openWorldHint: true } },
    async ({ proposalId, message }) => run(() => sendProposalEmail(ctx(), env, proposalId, parse(SendProposalEmailSchema, { message })))(),
  );
  server.registerTool(
    "get_proposal_analytics",
    { description: "Views, reading time per section, pricing interactions, and a summarized visit list.", inputSchema: { proposalId: uuid }, annotations: readOnly },
    async ({ proposalId }) =>
      run(async () => {
        const a = await analytics.getAnalytics(ctx(), proposalId);
        return { ...a, sessions: a.sessions.slice(0, 25).map(({ id: _id, ...s }) => s), totalSessions: a.sessions.length };
      })(),
  );
  server.registerTool(
    "duplicate_proposal",
    { description: "Duplicate a proposal as a new draft, optionally for a different client.", inputSchema: { proposalId: uuid, clientId: uuid.optional() }, annotations: edit },
    async ({ proposalId, clientId }) => run(() => proposals.duplicateProposal(ctx(), proposalId, parse(DuplicateProposalSchema, { clientId })))(),
  );
  server.registerTool(
    "save_as_template",
    { description: "Save a proposal as a reusable template.", inputSchema: { proposalId: uuid, name: z.string(), category: z.string().optional(), description: z.string().optional() }, annotations: edit },
    async ({ proposalId, ...t }) => run(() => proposals.saveProposalAsTemplate(ctx(), proposalId, parse(SaveAsTemplateSchema, t)))(),
  );
  server.registerTool(
    "archive_proposal",
    { description: "Archive a proposal (hides it; John can restore it). Deleting isn't available to AI.", inputSchema: { proposalId: uuid }, annotations: edit },
    async ({ proposalId }) => run(() => proposals.archiveProposal(ctx(), proposalId))(),
  );

  return server;
}

/** The /mcp handler behind the OAuth provider. */
export const mcpHandler = {
  async fetch(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const props = (exec as ExecutionContext & { props?: McpProps }).props;
    if (!props?.ownerId) return new Response("Unauthorized", { status: 401 });
    const server = buildMcpServer(env, exec, props);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
