-- Row Level Security (SPEC §3).
--
-- Access model:
--   * anon: no table access at all. The public viewer talks only to the Worker.
--   * authenticated (John, via the admin SPA): reads his own rows. Writes directly
--     only to plain-CRUD tables (settings, clients, templates). Proposals, versions,
--     signatures, audit, API keys, email log, and analytics are written only by the
--     Worker's service layer (service role), so status transitions, totals, and
--     hashes are always computed server-side.
--   * service_role (Worker): bypasses RLS; still subject to immutability triggers.

do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'clients', 'templates', 'proposals', 'proposal_versions', 'signatures', 'audit_events',
    'api_keys', 'email_log', 'view_sessions', 'session_block_stats', 'heatmap_points', 'heatmap_cells',
    'pricing_interactions', 'otp_codes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- Tables the SPA only reads.
revoke insert, update, delete, truncate on
  public.proposals, public.proposal_versions, public.signatures, public.audit_events, public.api_keys,
  public.email_log, public.view_sessions, public.session_block_stats, public.heatmap_points,
  public.heatmap_cells, public.pricing_interactions, public.otp_codes
from authenticated;
revoke all on public.otp_codes from authenticated;
revoke delete, truncate on public.settings from authenticated;

-- ---------------------------------------------------------------------------
-- Owner read policies
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'clients', 'templates', 'proposals', 'proposal_versions', 'signatures', 'audit_events',
    'api_keys', 'email_log', 'view_sessions'
  ] loop
    execute format(
      'create policy owner_select on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t
    );
  end loop;
end;
$$;

-- Analytics child tables: visible when the parent proposal belongs to the owner.
create policy owner_select on public.session_block_stats for select to authenticated
  using (exists (select 1 from public.view_sessions s where s.id = session_id and s.owner_id = (select auth.uid())));
create policy owner_select on public.heatmap_points for select to authenticated
  using (exists (select 1 from public.proposals p where p.id = proposal_id and p.owner_id = (select auth.uid())));
create policy owner_select on public.heatmap_cells for select to authenticated
  using (exists (select 1 from public.proposals p where p.id = proposal_id and p.owner_id = (select auth.uid())));
create policy owner_select on public.pricing_interactions for select to authenticated
  using (exists (select 1 from public.proposals p where p.id = proposal_id and p.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Owner write policies (plain CRUD tables)
-- ---------------------------------------------------------------------------
create policy owner_update on public.settings for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy owner_insert on public.settings for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy owner_insert on public.clients for insert to authenticated with check (owner_id = (select auth.uid()));
create policy owner_update on public.clients for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy owner_delete on public.clients for delete to authenticated using (owner_id = (select auth.uid()));

create policy owner_insert on public.templates for insert to authenticated with check (owner_id = (select auth.uid()));
create policy owner_update on public.templates for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy owner_delete on public.templates for delete to authenticated using (owner_id = (select auth.uid()));
