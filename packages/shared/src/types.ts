import type { PricingResult } from "./pricing.js";
import type { ProposalContent } from "./schemas/content.js";
import type { CreatedVia, ProposalStatus } from "./schemas/db.js";
import type { Pricing } from "./schemas/pricing.js";
import type { OwnerSignature } from "./schemas/settings.js";
import type { CompanyInfo, Theme } from "./schemas/theme.js";

/** API response shapes for /api/v1/*. Column names follow the database (snake_case). */

export interface ClientRow {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalSummary {
  id: string;
  slug: string;
  title: string;
  status: ProposalStatus;
  client: Pick<ClientRow, "id" | "name" | "company"> | null;
  total_one_time_cents: number;
  total_monthly_cents: number;
  current_version: number;
  expires_at: string | null;
  sent_at: string | null;
  last_viewed_at: string | null;
  signed_at: string | null;
  created_via: CreatedVia;
  created_at: string;
  updated_at: string;
}

export interface ProposalDetail extends ProposalSummary {
  client_id: string | null;
  content: ProposalContent;
  pricing: Pricing;
  template_id: string | null;
  revision_of: string | null;
  created_via_client: string | null;
  /** Totals from default selections, recomputed server-side. Null if pricing can't be computed. */
  totals: PricingResult | null;
  /** True when the draft differs from the latest published version (or it was never published). */
  has_unpublished_changes: boolean;
  /** When the current version was published; null if never. */
  published_at: string | null;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateDetail extends TemplateSummary {
  content: ProposalContent;
  pricing: Pricing;
}

export interface ClientDetail extends ClientRow {
  proposals: ProposalSummary[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

/** What the client sees (SPEC §8.1). Drafts and archived proposals are never returned (404). */
export type PublicProposalState = "active" | "expired" | "declined" | "signed";

export interface PublicProposal {
  state: PublicProposalState;
  slug: string;
  title: string;
  version: number;
  clientName: string | null;
  expiresAt: string | null;
  brand: { theme: Theme | null; company: CompanyInfo | null; contactEmail: string };
  /** Present for active and signed proposals only. */
  document: { content: ProposalContent; pricing: Pricing; ownerSignature: OwnerSignature | null } | null;
}

/** Minimal metadata for link previews (Open Graph), fetched by the Pages Function. */
export interface PublicProposalMeta {
  title: string;
  description: string;
  imageUrl: string | null;
}
