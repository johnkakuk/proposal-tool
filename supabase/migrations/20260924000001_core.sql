-- Bridger Proposals: core schema (SPEC §6.1–6.3)
-- Enum values are mirrored in packages/shared/src/schemas/db.ts (a test keeps them in sync).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.proposal_status as enum ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'archived');
create type public.created_via as enum ('manual', 'template', 'mcp', 'api');
create type public.version_reason as enum ('published', 'signed');
create type public.signature_type as enum ('typed', 'drawn');
create type public.device_type as enum ('desktop', 'tablet', 'mobile');
create type public.heatmap_kind as enum ('click', 'tap', 'move');
create type public.pricing_action as enum ('selected', 'deselected');
create type public.audit_event_type as enum (
  'created', 'edited', 'published', 'link_copied', 'emailed', 'viewed', 'otp_sent', 'otp_verified',
  'signed', 'declined', 'expired', 'extended', 'extension_requested', 'pdf_exported', 'archived', 'duplicated'
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) default auth.uid(),
  brand jsonb not null default '{}'::jsonb,
  default_terms_markdown text not null default '',
  default_expiry_days int not null default 30 check (default_expiry_days between 1 and 365),
  timezone text not null default 'America/Los_Angeles',
  notification_prefs jsonb not null default '{}'::jsonb,
  owner_signature jsonb,
  excluded_ips text[] not null default '{}',
  require_signer_email_otp boolean not null default true,
  ai_can_publish boolean not null default true,
  ai_can_email_client boolean not null default false,
  -- Writing guidelines returned to AI clients by get_workspace_context (§10.2)
  guidelines_markdown text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) default auth.uid(),
  name text not null,
  company text,
  email text,
  phone text,
  website text,
  logo_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) default auth.uid(),
  name text not null,
  description text,
  category text,
  content jsonb not null default '{"schemaVersion": 1, "blocks": []}'::jsonb,
  pricing jsonb not null default '{"currency": "USD", "sections": [], "discounts": []}'::jsonb,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) default auth.uid(),
  slug text not null unique check (slug ~ '^[A-Za-z0-9_-]{21}$'),
  client_id uuid references public.clients (id) on delete restrict,
  title text not null,
  status public.proposal_status not null default 'draft',
  content jsonb not null default '{"schemaVersion": 1, "blocks": []}'::jsonb,
  pricing jsonb not null default '{"currency": "USD", "sections": [], "discounts": []}'::jsonb,
  current_version int not null default 0 check (current_version >= 0),
  expires_at timestamptz,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  created_via public.created_via not null default 'manual',
  created_via_client text,
  template_id uuid references public.templates (id) on delete set null,
  revision_of uuid references public.proposals (id) on delete restrict,
  -- Denormalized from default selections, for the dashboard
  total_one_time_cents bigint not null default 0 check (total_one_time_cents >= 0),
  total_monthly_cents bigint not null default 0 check (total_monthly_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signed_has_signed_at check (status <> 'signed' or signed_at is not null)
);

create table public.proposal_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  proposal_id uuid not null references public.proposals (id) on delete restrict,
  version int not null check (version >= 1),
  content jsonb not null,
  pricing jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  reason public.version_reason not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proposal_id, version)
);

-- Several rows per proposal are allowed so multiple signers can be added later (§1).
create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  proposal_id uuid not null references public.proposals (id) on delete restrict,
  version int not null,
  signer_name text not null,
  signer_email text not null,
  signer_title text,
  signer_company text,
  signature_type public.signature_type not null,
  signature_text text,
  signature_image_path text,
  selections jsonb not null,
  computed_totals jsonb not null,
  consent_text text not null,
  consent_given_at timestamptz not null,
  email_verified boolean not null default false,
  otp_verified_at timestamptz,
  ip text,
  user_agent text,
  geo jsonb,
  timezone_offset_minutes int,
  snapshot jsonb not null,
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  -- Filled in once by the background PDF job; see the write-once rule in the immutability migration.
  pdf_path text,
  pdf_hash text check (pdf_hash is null or pdf_hash ~ '^[0-9a-f]{64}$'),
  certificate_id text not null unique check (certificate_id ~ '^BDP-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (proposal_id, version) references public.proposal_versions (proposal_id, version),
  constraint signature_has_mark check (
    (signature_type = 'typed' and signature_text is not null) or
    (signature_type = 'drawn' and signature_image_path is not null)
  )
);

-- Append-only
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  proposal_id uuid not null references public.proposals (id) on delete restrict,
  event_type public.audit_event_type not null,
  occurred_at timestamptz not null default now(),
  actor text not null check (actor ~ '^(owner|client|system|ai:\S.{0,63})$'),
  ip text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) default auth.uid(),
  name text not null,
  key_prefix text not null check (char_length(key_prefix) = 8),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  to_email text not null,
  template text not null,
  proposal_id uuid references public.proposals (id) on delete set null,
  resend_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Analytics (§6.2). view_sessions carries owner_id; its child tables don't.
-- ---------------------------------------------------------------------------
create table public.view_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  version int not null,
  visitor_id text not null,
  session_start timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active_ms bigint not null default 0 check (active_ms >= 0),
  max_scroll_pct smallint not null default 0 check (max_scroll_pct between 0 and 100),
  device public.device_type not null,
  viewport_w int,
  viewport_h int,
  browser text,
  os text,
  referrer text,
  country text,
  region text,
  -- Salted SHA-256; raw IPs are never stored here.
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  is_owner boolean not null default false,
  is_bot boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.session_block_stats (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.view_sessions (id) on delete cascade,
  block_id text not null,
  visible_ms bigint not null default 0 check (visible_ms >= 0),
  first_seen_at timestamptz not null default now(),
  times_entered int not null default 0 check (times_entered >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, block_id)
);

-- Raw points, short-lived: rolled into heatmap_cells after 24h, deleted after 90 days (§6.5).
create table public.heatmap_points (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.view_sessions (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  version int not null,
  block_id text not null,
  kind public.heatmap_kind not null,
  x_pct real not null check (x_pct between 0 and 1),
  y_pct real not null check (y_pct between 0 and 1),
  device public.device_type not null,
  occurred_at timestamptz not null default now(),
  rolled_up boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.heatmap_cells (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  version int not null,
  block_id text not null,
  device public.device_type not null,
  kind public.heatmap_kind not null,
  cell_x smallint not null check (cell_x between 0 and 49),
  cell_y smallint not null check (cell_y between 0 and 49),
  count int not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proposal_id, version, block_id, device, kind, cell_x, cell_y)
);

create table public.pricing_interactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.view_sessions (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  section_id text not null,
  item_id text not null,
  action public.pricing_action not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Worker-only (service role). No owner_id; RLS on with no policies.
create table public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  attempts int not null default 0 check (attempts between 0 and 5),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes (§6.3 plus FK lookups)
-- ---------------------------------------------------------------------------
create index proposals_owner_status_idx on public.proposals (owner_id, status);
-- proposals(slug) is covered by its unique constraint.
create index proposals_client_idx on public.proposals (client_id);
create index proposals_expires_idx on public.proposals (expires_at) where status in ('sent', 'viewed');
create index clients_owner_idx on public.clients (owner_id);
create index templates_owner_idx on public.templates (owner_id);
create index signatures_proposal_idx on public.signatures (proposal_id);
create index view_sessions_proposal_start_idx on public.view_sessions (proposal_id, session_start);
create index session_block_stats_session_idx on public.session_block_stats (session_id);
create index heatmap_points_proposal_occurred_idx on public.heatmap_points (proposal_id, occurred_at);
create index heatmap_points_session_idx on public.heatmap_points (session_id);
create index heatmap_cells_lookup_idx on public.heatmap_cells (proposal_id, version, device, kind);
create index pricing_interactions_proposal_idx on public.pricing_interactions (proposal_id, occurred_at);
create index audit_events_proposal_occurred_idx on public.audit_events (proposal_id, occurred_at);
create index email_log_proposal_idx on public.email_log (proposal_id);
create index otp_codes_lookup_idx on public.otp_codes (proposal_id, email, created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'clients', 'templates', 'proposals', 'proposal_versions', 'signatures', 'audit_events',
    'api_keys', 'email_log', 'view_sessions', 'session_block_stats', 'heatmap_points', 'heatmap_cells',
    'pricing_interactions', 'otp_codes'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
