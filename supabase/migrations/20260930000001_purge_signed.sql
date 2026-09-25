-- Permanent deletion of archived *signed* proposals, on explicit confirmation.
--
-- Signed proposals are executed contracts, so this stays deliberately narrow:
--   * purge_proposal() needs p_confirm_signed = true for a signed proposal (the app only
--     sends it after John types "delete"); only the service role can call it, and the
--     Worker only lets a signed-in human (never an API key or AI connector) ask for it.
--   * The immutability triggers make an exception only for the one proposal named in this
--     transaction's `bridger.purging_proposal` setting, and only for DELETE. Updates to
--     signed proposals, signatures, versions, and audit events stay forbidden everywhere.
-- Returns the storage paths (signature images, signed PDFs) for the Worker to remove.

create or replace function public.guard_signed_proposal() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.signed_at is not null and old.id::text is distinct from current_setting('bridger.purging_proposal', true) then
      raise exception 'Proposal % is signed and cannot be deleted', old.id
        using errcode = 'P0001', hint = 'Signed proposals are immutable. Archive it instead.';
    end if;
    return old;
  end if;

  if old.signed_at is not null then
    if new.status not in ('signed', 'archived')
       or (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Proposal % is signed and locked; only archiving is allowed', old.id
        using errcode = 'P0001', hint = 'Use "Duplicate as new revision" to make changes.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_signature() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.proposal_id::text = current_setting('bridger.purging_proposal', true) then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and old.pdf_path is null and old.pdf_hash is null
     and new.pdf_path is not null and new.pdf_hash is not null
     and (to_jsonb(new) - 'pdf_path' - 'pdf_hash' - 'updated_at') = (to_jsonb(old) - 'pdf_path' - 'pdf_hash' - 'updated_at') then
    return new;
  end if;
  raise exception '% on public.signatures is not allowed: signatures are immutable (pdf_path/pdf_hash can be set once)', tg_op
    using errcode = 'P0001';
end;
$$;

drop function public.purge_proposal(uuid, uuid);

create function public.purge_proposal(p_proposal_id uuid, p_owner_id uuid, p_confirm_signed boolean default false)
returns table (bucket text, path text)
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
  if r.status <> 'archived' then
    raise exception 'Only archived proposals can be permanently deleted' using errcode = 'P0001';
  end if;
  if r.signed_at is not null and not coalesce(p_confirm_signed, false) then
    raise exception 'Signed proposals can''t be permanently deleted without explicit confirmation' using errcode = 'P0001';
  end if;

  -- Files to remove after the rows are gone (collected before deleting the signatures).
  return query
    select 'signatures'::text, s.signature_image_path from public.signatures s where s.proposal_id = r.id and s.signature_image_path is not null
    union all
    select 'signed-pdfs'::text, s.pdf_path from public.signatures s where s.proposal_id = r.id and s.pdf_path is not null;

  perform set_config('bridger.purging_proposal', r.id::text, true);
  -- Revisions keep existing; they just lose the link to this one.
  update public.proposals set revision_of = null where revision_of = r.id;
  delete from public.signatures where proposal_id = r.id;
  delete from public.audit_events where proposal_id = r.id;
  delete from public.proposal_versions where proposal_id = r.id;
  -- email_log (set null) and analytics / OTP rows (cascade) follow the proposal.
  delete from public.proposals where id = r.id;
  perform set_config('bridger.purging_proposal', '', true);
end;
$$;

revoke execute on function public.purge_proposal(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.purge_proposal(uuid, uuid, boolean) to service_role;
