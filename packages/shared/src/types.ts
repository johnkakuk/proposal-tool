import type { PricingResult } from "./pricing.js";
import type { ProposalContent } from "./schemas/content.js";
import type { CreatedVia, ProposalStatus } from "./schemas/db.js";
import type { Pricing } from "./schemas/pricing.js";

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
