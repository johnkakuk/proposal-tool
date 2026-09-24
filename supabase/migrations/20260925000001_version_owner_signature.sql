-- Publishing freezes the owner's signature into the version (SPEC §7.6: "applied
-- automatically when a proposal is published"), so later changes in Settings never
-- alter what a client already saw or signed.
alter table public.proposal_versions add column owner_signature jsonb;
