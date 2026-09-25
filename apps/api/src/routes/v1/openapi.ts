import {
  ClientInputSchema,
  ClientPatchSchema,
  CreateProposalSchema,
  DuplicateProposalSchema,
  InsertBlockSchema,
  MoveBlockSchema,
  ReplaceContentSchema,
  SaveAsTemplateSchema,
  SendProposalEmailSchema,
  SetPricingSchema,
  TemplateInputSchema,
  TemplatePatchSchema,
  UpdateBlockSchema,
  UpdateProposalSchema,
} from "@bridger/shared";
import { z } from "zod";

/**
 * OpenAPI 3.1 for REST v1 (SPEC §10.3), so ChatGPT Actions and Zapier can use it.
 * Request bodies are generated from the same Zod schemas the server validates with.
 */

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any", target: "draft-2020-12" }) as Record<string, unknown>;

interface Op {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  operationId: string;
  summary: string;
  body?: z.ZodType;
  query?: Record<string, { type: string; description: string; enum?: string[] }>;
  ownerOnly?: boolean;
}

const OPS: Op[] = [
  { method: "get", path: "/workspace/context", operationId: "getWorkspaceContext", summary: "Brand, company, default terms, writing guidelines, templates, and a services/pricing catalog." },
  { method: "get", path: "/schema/blocks", operationId: "getBlockSchema", summary: "JSON Schema for proposal content and pricing, with an example for every block type." },
  { method: "get", path: "/templates", operationId: "listTemplates", summary: "List templates." },
  { method: "get", path: "/templates/{id}", operationId: "getTemplate", summary: "Get a template's content and pricing." },
  { method: "post", path: "/templates", operationId: "createTemplate", summary: "Create a template.", body: TemplateInputSchema },
  { method: "patch", path: "/templates/{id}", operationId: "updateTemplate", summary: "Update a template.", body: TemplatePatchSchema },
  { method: "get", path: "/clients", operationId: "listClients", summary: "List clients (optional search).", query: { q: { type: "string", description: "Search name, company, or email" } } },
  { method: "get", path: "/clients/{id}", operationId: "getClient", summary: "Get a client and their proposals." },
  { method: "post", path: "/clients", operationId: "createClient", summary: "Create a client.", body: ClientInputSchema },
  { method: "patch", path: "/clients/{id}", operationId: "updateClient", summary: "Update a client.", body: ClientPatchSchema },
  {
    method: "get",
    path: "/proposals",
    operationId: "listProposals",
    summary: "List proposals, filtered by status, client, or title.",
    query: {
      status: { type: "string", description: "Proposal status", enum: ["draft", "sent", "viewed", "signed", "declined", "expired", "archived"] },
      clientId: { type: "string", description: "Client ID" },
      q: { type: "string", description: "Title search" },
    },
  },
  { method: "get", path: "/proposals/{id}", operationId: "getProposal", summary: "Full proposal JSON, status, and computed totals." },
  { method: "post", path: "/proposals", operationId: "createProposal", summary: "Create a draft (blank, from a template, or with full content/pricing). Always a draft.", body: CreateProposalSchema },
  { method: "patch", path: "/proposals/{id}", operationId: "updateProposal", summary: "Update title, client, expiry, content, or pricing.", body: UpdateProposalSchema },
  { method: "put", path: "/proposals/{id}/content", operationId: "replaceContent", summary: "Replace all blocks (validated).", body: ReplaceContentSchema },
  { method: "put", path: "/proposals/{id}/pricing", operationId: "setPricing", summary: "Replace the pricing object; returns recomputed totals.", body: SetPricingSchema },
  { method: "post", path: "/proposals/{id}/blocks", operationId: "insertBlock", summary: "Insert a block at a position (default: just before the signature).", body: InsertBlockSchema },
  { method: "patch", path: "/proposals/{id}/blocks/{blockId}", operationId: "updateBlock", summary: "Merge props into a block, or hide/show it.", body: UpdateBlockSchema },
  { method: "delete", path: "/proposals/{id}/blocks/{blockId}", operationId: "deleteBlock", summary: "Remove one block from a draft." },
  { method: "post", path: "/proposals/{id}/blocks/{blockId}/move", operationId: "moveBlock", summary: "Move a block.", body: MoveBlockSchema },
  { method: "post", path: "/proposals/{id}/preview-url", operationId: "getPreviewUrl", summary: "A signed preview link to the draft, valid for 1 hour, never tracked." },
  { method: "post", path: "/proposals/{id}/publish", operationId: "publishProposal", summary: "Validate and publish (if allowed in Settings). Returns the public link." },
  { method: "post", path: "/proposals/{id}/send-email", operationId: "sendProposalEmail", summary: "Email the link to the client (if allowed in Settings).", body: SendProposalEmailSchema },
  { method: "get", path: "/proposals/{id}/analytics", operationId: "getProposalAnalytics", summary: "Views, section reading times, pricing interactions, and sessions." },
  { method: "post", path: "/proposals/{id}/duplicate", operationId: "duplicateProposal", summary: "Duplicate, optionally for a different client.", body: DuplicateProposalSchema },
  { method: "post", path: "/proposals/{id}/save-as-template", operationId: "saveAsTemplate", summary: "Turn a proposal into a template.", body: SaveAsTemplateSchema },
  { method: "post", path: "/proposals/{id}/archive", operationId: "archiveProposal", summary: "Archive (soft delete). Automated callers can't delete." },
];

export function openApiDocument(appUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params = [
      ...[...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } })),
      ...Object.entries(op.query ?? {}).map(([name, q]) => ({ name, in: "query", required: false, description: q.description, schema: { type: q.type, ...(q.enum ? { enum: q.enum } : {}) } })),
    ];
    (paths[op.path] ??= {})[op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      ...(params.length ? { parameters: params } : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: schema(op.body) } } } } : {}),
      responses: {
        "200": { description: "Success", content: { "application/json": { schema: { type: "object" } } } },
        "401": { description: "Missing or invalid credentials" },
        "409": { description: "Conflict (e.g. signed proposals are locked)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "422": { description: "Validation failed; `issues` explain what to fix", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Bridger Digital Proposals API",
      version: "1.0.0",
      description: "Create, edit, publish, and track proposals. Money is integer cents. Signed proposals are locked. Deleting is not available to API clients; archive instead.",
    },
    servers: [{ url: `${appUrl.replace(/\/$/, "")}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "An API key from Settings → AI & API (bdp_…), or an OAuth access token." } },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: { code: { type: "string" }, message: { type: "string" }, issues: { type: "array", items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } } } },
            },
          },
        },
      },
    },
    paths,
  };
}
