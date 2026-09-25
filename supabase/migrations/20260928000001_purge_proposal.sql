-- Permanent deletion of archived, unsigned proposals.
--
-- Versions and audit events are append-only (SPEC §6.4). The only exception is
-- purge_proposal(): it marks its own transaction with `bridger.purging_proposal` and the
-- immutability triggers allow DELETE of that one proposal's rows. Signed proposals can
-- never be purged (executed contracts stay immutable). Only the service role can call it.

create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.proposal_id::text = current_setting('bridger.purging_proposal', true) then
    return old;
  end if;
  raise exception '% on %.% is not allowed: rows are immutable', tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;

create function public.purge_proposal(p_proposal_id uuid, p_owner_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  r public.proposals;
begin
  select * into r from public.proposals where id = p_proposal_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if r.signed_at is not null then
    raise exception 'Signed proposals can''t be permanently deleted' using errcode = 'P0001';
  end if;
  if r.status <> 'archived' then
    raise exception 'Only archived proposals can be permanently deleted' using errcode = 'P0001';
  end if;

  perform set_config('bridger.purging_proposal', r.id::text, true);
  -- Revisions keep existing; they just lose the link to this one.
  update public.proposals set revision_of = null where revision_of = r.id;
  delete from public.audit_events where proposal_id = r.id;
  delete from public.proposal_versions where proposal_id = r.id;
  -- email_log (set null) and analytics / OTP rows (cascade) follow the proposal.
  delete from public.proposals where id = r.id;
  perform set_config('bridger.purging_proposal', '', true);
end;
$$;

revoke execute on function public.purge_proposal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_proposal(uuid, uuid) to service_role;
