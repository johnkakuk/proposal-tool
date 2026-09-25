-- E-signature (SPEC §8.2).

-- An OTP is verified first, then consumed by the signing transaction.
alter table public.otp_codes add column verified_at timestamptz;

-- Atomic signing. The Worker has already validated the request, recomputed totals,
-- built the canonical snapshot, and hashed it; this function re-checks everything
-- that could have changed and commits it all in one transaction:
--   * proposal is signable (not signed/declined/archived/expired) and the client saw
--     the current version (else 40001 → HTTP 409 "please review")
--   * the verified OTP (if required) is consumed
--   * a `signed` proposal_versions row is added (content/pricing copied from the
--     published version the client signed)
--   * the signature row is written, the proposal locked (status signed), audit logged
create function public.sign_proposal(p_proposal_id uuid, p_expected_version int, p_otp_id uuid, p_sig jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  r public.proposals;
  pub public.proposal_versions;
  v int;
  sig_id uuid;
  v_signed_at timestamptz := (p_sig ->> 'signed_at')::timestamptz;
begin
  select * into r from public.proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if r.signed_at is not null or r.status not in ('sent', 'viewed') then
    raise exception 'This proposal can no longer be signed' using errcode = 'P0001';
  end if;
  if r.expires_at is not null and r.expires_at <= now() then
    raise exception 'This proposal has expired' using errcode = 'P0001';
  end if;
  if r.current_version <> p_expected_version then
    raise exception 'This proposal was updated. Please review the latest version.' using errcode = '40001';
  end if;

  if p_otp_id is not null then
    update public.otp_codes
       set used_at = now()
     where id = p_otp_id and proposal_id = r.id and verified_at is not null and used_at is null
       and verified_at > now() - interval '30 minutes';
    if not found then
      raise exception 'Email verification expired. Please verify your email again.' using errcode = 'P0001';
    end if;
  end if;

  select * into pub from public.proposal_versions where proposal_id = r.id and version = r.current_version;
  v := r.current_version + 1;

  insert into public.proposal_versions (owner_id, proposal_id, version, content, pricing, content_hash, reason, owner_signature)
  values (r.owner_id, r.id, v, pub.content, pub.pricing, pub.content_hash, 'signed', pub.owner_signature);

  insert into public.signatures (
    owner_id, proposal_id, version, signer_name, signer_email, signer_title, signer_company,
    signature_type, signature_text, signature_image_path, selections, computed_totals,
    consent_text, consent_given_at, email_verified, otp_verified_at, ip, user_agent, geo,
    timezone_offset_minutes, snapshot, document_hash, certificate_id
  ) values (
    r.owner_id, r.id, v, p_sig ->> 'signer_name', p_sig ->> 'signer_email', p_sig ->> 'signer_title', p_sig ->> 'signer_company',
    (p_sig ->> 'signature_type')::public.signature_type, p_sig ->> 'signature_text', p_sig ->> 'signature_image_path',
    p_sig -> 'selections', p_sig -> 'computed_totals',
    p_sig ->> 'consent_text', v_signed_at, p_otp_id is not null,
    (select verified_at from public.otp_codes where id = p_otp_id),
    p_sig ->> 'ip', p_sig ->> 'user_agent', p_sig -> 'geo', (p_sig ->> 'timezone_offset_minutes')::int,
    p_sig -> 'snapshot', p_sig ->> 'document_hash', p_sig ->> 'certificate_id'
  ) returning id into sig_id;

  update public.proposals set status = 'signed', signed_at = v_signed_at, current_version = v where id = r.id;

  insert into public.audit_events (owner_id, proposal_id, event_type, actor, ip, user_agent, metadata)
  values (r.owner_id, r.id, 'signed', 'client', p_sig ->> 'ip', p_sig ->> 'user_agent',
          jsonb_build_object('signatureId', sig_id, 'certificateId', p_sig ->> 'certificate_id',
                             'documentHash', p_sig ->> 'document_hash', 'version', v, 'signedVersion', p_expected_version));
  return sig_id;
end;
$$;

revoke execute on function public.sign_proposal(uuid, int, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sign_proposal(uuid, int, uuid, jsonb) to service_role;
