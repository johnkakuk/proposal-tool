-- "Each email fires once under its rules" (SPEC §14 Phase 5). A notification claims
-- its dedupe key by inserting the email_log row first; a second attempt with the same
-- key hits the unique index and is skipped.
alter table public.email_log add column dedupe_key text;
create unique index email_log_dedupe_key_idx on public.email_log (dedupe_key) where dedupe_key is not null;
create index email_log_template_proposal_idx on public.email_log (template, proposal_id, created_at);
