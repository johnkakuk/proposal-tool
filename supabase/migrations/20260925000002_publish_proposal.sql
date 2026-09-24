-- Atomic publish (SPEC §4, §7.2). The Worker validates the document and computes its
-- canonical hash first; this function then, in one transaction:
--   * re-checks the row hasn't changed since it was validated (optimistic lock)
--   * snapshots content + pricing into a new proposal_versions row
--   * bumps current_version, moves draft → sent (or expired → sent/viewed), sets expiry
--   * writes the audit events
-- Error codes: P0002 not found, 40001 changed since validation, P0001 not publishable.

create function public.publish_proposal(
  p_proposal_id uuid,
  p_owner_id uuid,
  p_expected_updated_at timestamptz,
  p_content_hash text,
  p_owner_signature jsonb,
  p_expires_at timestamptz,
  p_actor text,
  p_ip text,
  p_user_agent text
) returns int
language plpgsql
set search_path = ''
as $$
declare
  r public.proposals;
  v int;
  next_status public.proposal_status;
begin
  select * into r from public.proposals where id = p_proposal_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if r.updated_at is distinct from p_expected_updated_at then
    raise exception 'The proposal changed while publishing. Try again.' using errcode = '40001';
  end if;
  if r.signed_at is not null or r.status in ('signed', 'archived', 'declined') then
    raise exception 'A % proposal can''t be published', r.status using errcode = 'P0001';
  end if;
  if p_expires_at <= now() then
    raise exception 'The expiry date must be in the future' using errcode = 'P0001';
  end if;

  v := r.current_version + 1;
  next_status := case
    when r.status = 'draft' then 'sent'::public.proposal_status
    when r.status = 'expired' then case when r.first_viewed_at is null then 'sent'::public.proposal_status else 'viewed'::public.proposal_status end
    else r.status
  end;

  insert into public.proposal_versions (owner_id, proposal_id, version, content, pricing, content_hash, reason, owner_signature)
  values (r.owner_id, r.id, v, r.content, r.pricing, p_content_hash, 'published', p_owner_signature);

  update public.proposals
     set current_version = v,
         status = next_status,
         sent_at = coalesce(r.sent_at, now()),
         expires_at = p_expires_at
   where id = r.id;

  insert into public.audit_events (owner_id, proposal_id, event_type, actor, ip, user_agent, metadata)
  values (r.owner_id, r.id, 'published', p_actor, p_ip, p_user_agent,
          jsonb_build_object('version', v, 'contentHash', p_content_hash, 'expiresAt', p_expires_at));
  if r.status = 'expired' then
    insert into public.audit_events (owner_id, proposal_id, event_type, actor, ip, user_agent, metadata)
    values (r.owner_id, r.id, 'extended', p_actor, p_ip, p_user_agent, jsonb_build_object('expiresAt', p_expires_at));
  end if;

  return v;
end;
$$;

revoke execute on function public.publish_proposal(uuid, uuid, timestamptz, text, jsonb, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.publish_proposal(uuid, uuid, timestamptz, text, jsonb, timestamptz, text, text, text) to service_role;
