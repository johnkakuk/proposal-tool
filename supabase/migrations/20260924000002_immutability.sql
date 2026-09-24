-- Immutability (SPEC §6.4). These triggers apply to every role, including the
-- service role the Worker uses, so a bug in app code can't alter signed records.

-- ---------------------------------------------------------------------------
-- proposals: once signed, only `status` (signed ⇄ archived) and `updated_at` may change.
-- Keyed on signed_at rather than status so archiving a signed proposal doesn't unlock it.
-- ---------------------------------------------------------------------------
create function public.guard_signed_proposal() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.signed_at is not null then
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

-- Named with a leading "a_" so it runs before set_updated_at (triggers fire alphabetically).
create trigger a_guard_signed_proposal
  before update or delete on public.proposals
  for each row execute function public.guard_signed_proposal();

-- ---------------------------------------------------------------------------
-- Append-only tables: proposal_versions, audit_events, signatures.
-- ---------------------------------------------------------------------------
create function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% on %.% is not allowed: rows are immutable', tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger a_forbid_update_delete before update or delete on public.proposal_versions
  for each row execute function public.forbid_mutation();
create trigger a_forbid_truncate before truncate on public.proposal_versions
  for each statement execute function public.forbid_mutation();

create trigger a_forbid_update_delete before update or delete on public.audit_events
  for each row execute function public.forbid_mutation();
create trigger a_forbid_truncate before truncate on public.audit_events
  for each statement execute function public.forbid_mutation();

-- signatures: immutable, with one exception. The signed PDF is generated in the
-- background after the signing transaction commits (§8.2 step 6), so pdf_path and
-- pdf_hash may be set exactly once, from NULL, and nothing else may change.
create function public.guard_signature() returns trigger
language plpgsql as $$
begin
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

create trigger a_guard_signature before update or delete on public.signatures
  for each row execute function public.guard_signature();
create trigger a_forbid_truncate before truncate on public.signatures
  for each statement execute function public.forbid_mutation();

-- Belt and braces: client roles can't even attempt these writes.
revoke update, delete, truncate on public.proposal_versions, public.audit_events, public.signatures from anon, authenticated;
