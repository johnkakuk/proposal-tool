import { BrandSchema, OwnerSignatureSchema, type Pricing, type ProposalContent } from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SignJWT, jwtVerify } from "jose";
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";
import type { ServiceContext } from "./context.js";
import { getProposal } from "./proposals.js";

/**
 * Signed preview links (SPEC §10.2 get_preview_url): show the *draft* (not the published
 * version), valid for 1 hour, never tracked.
 */
const key = (secret: string) => new TextEncoder().encode(`preview:${secret}`);

export async function createPreviewUrl(ctx: ServiceContext, env: Env, proposalId: string): Promise<{ url: string; expiresAt: string }> {
  await getProposal(ctx, proposalId);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = await new SignJWT({ purpose: "preview" }).setProtectedHeader({ alg: "HS256" }).setSubject(proposalId).setExpirationTime(exp).sign(key(env.SIGNING_SECRET));
  return { url: `${env.APP_URL.replace(/\/$/, "")}/preview/${token}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function getPreview(env: Env, db: SupabaseClient, token: string) {
  let proposalId: string;
  try {
    const { payload } = await jwtVerify(token, key(env.SIGNING_SECRET), { algorithms: ["HS256"] });
    if (payload.purpose !== "preview" || !payload.sub) throw new Error();
    proposalId = payload.sub;
  } catch {
    throw new ApiError(404, "expired", "This preview link has expired. Ask for a new one.");
  }
  const { data: p } = await db.from("proposals").select("title, owner_id, content, pricing, client:clients(name, company)").eq("id", proposalId).maybeSingle();
  if (!p) throw new ApiError(404, "not_found", "This proposal no longer exists.");
  const { data: s } = await db.from("settings").select("brand, owner_signature").eq("owner_id", p.owner_id).maybeSingle();
  const brand = BrandSchema.safeParse(s?.brand);
  const sig = OwnerSignatureSchema.safeParse(s?.owner_signature);
  const client = p.client as unknown as { name: string; company: string | null } | null;
  return {
    title: p.title as string,
    clientName: client ? (client.company ?? client.name) : null,
    brand: { theme: brand.success ? brand.data.theme : null, company: brand.success ? brand.data.company : null },
    document: { content: p.content as ProposalContent, pricing: p.pricing as Pricing, ownerSignature: sig.success ? sig.data : null },
  };
}
