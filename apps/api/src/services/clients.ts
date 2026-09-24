import type { ClientDetail, ClientInputSchema, ClientPatchSchema, ClientRow, ProposalSummary } from "@bridger/shared";
import type { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { found, must, type ServiceContext } from "./context.js";
import { SUMMARY_COLUMNS } from "./proposals.js";

export async function getClientRow(ctx: ServiceContext, id: string): Promise<ClientRow> {
  return found(
    await ctx.db.from("clients").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle(),
    "load the client",
    "Client",
  ) as ClientRow;
}

export async function listClients(ctx: ServiceContext, q?: string): Promise<ClientRow[]> {
  let query = ctx.db.from("clients").select("*").eq("owner_id", ctx.ownerId).order("name").limit(1000);
  if (q) {
    const pattern = `%${q.replace(/[%_\\,()]/g, "")}%`;
    query = query.or(`name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`);
  }
  return must(await query, "list clients") as ClientRow[];
}

export async function getClient(ctx: ServiceContext, id: string): Promise<ClientDetail> {
  const client = await getClientRow(ctx, id);
  const proposals = must(
    await ctx.db.from("proposals").select(SUMMARY_COLUMNS).eq("owner_id", ctx.ownerId).eq("client_id", id).order("updated_at", { ascending: false }),
    "list the client's proposals",
  ) as unknown as ProposalSummary[];
  return { ...client, proposals };
}

export async function createClient(ctx: ServiceContext, input: z.output<typeof ClientInputSchema>): Promise<ClientRow> {
  return must(await ctx.db.from("clients").insert({ ...input, owner_id: ctx.ownerId }).select("*").single(), "create the client") as ClientRow;
}

export async function updateClient(ctx: ServiceContext, id: string, input: z.output<typeof ClientPatchSchema>): Promise<ClientRow> {
  await getClientRow(ctx, id);
  return must(await ctx.db.from("clients").update(input).eq("owner_id", ctx.ownerId).eq("id", id).select("*").single(), "update the client") as ClientRow;
}

export async function deleteClient(ctx: ServiceContext, id: string): Promise<void> {
  await getClientRow(ctx, id);
  const { count } = await ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("owner_id", ctx.ownerId).eq("client_id", id);
  if (count) throw new ApiError(409, "client_has_proposals", `This client has ${count} proposal${count === 1 ? "" : "s"}. Reassign or archive them first.`);
  must(await ctx.db.from("clients").delete().eq("owner_id", ctx.ownerId).eq("id", id), "delete the client");
}
