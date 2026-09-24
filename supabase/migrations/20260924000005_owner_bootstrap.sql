-- Single-owner bootstrap. Public signups are disabled (supabase/config.toml and the
-- dashboard), so any user that exists was created by hand and is the owner. When that
-- account is created, give it a settings row with Bridger defaults (SPEC §6.1).
-- Starter templates are loaded separately: supabase/seed/02_starter_templates.sql.

create function public.bootstrap_owner_settings() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.settings (owner_id, brand, notification_prefs, default_terms_markdown, guidelines_markdown)
  values (
    new.id,
    jsonb_build_object(
      'theme', jsonb_build_object(
        -- PLACEHOLDER brand colors/fonts: replace with Bridger's real brand in Settings.
        'colors', jsonb_build_object('primary', '#0F2A44', 'accent', '#E07A1F', 'background', '#FFFFFF', 'text', '#1B1F24'),
        'headingFont', 'Playfair Display',
        'bodyFont', 'Inter'
      ),
      'company', jsonb_build_object(
        'name', 'Bridger Digital',
        'website', 'https://bridgerdigital.com'
      )
    ),
    jsonb_build_object(
      'first_view', true, 'return_visit', true, 'signed', true, 'declined', true,
      'expiring_soon', true, 'expired', true, 'extension_requested', true,
      'ai_draft_created', true, 'ai_published', true, 'daily_digest', false
    ),
    E'1. **Deposit.** 50% of the one-time total is due on signing; the balance is due on delivery.\n'
    || E'2. **Recurring services** are billed in advance and can be cancelled with 30 days'' written notice.\n'
    || E'3. **Revisions.** Two rounds of revisions are included per deliverable.\n'
    || E'4. **Ownership.** Final deliverables belong to the client once paid in full.\n\n'
    || E'_Placeholder terms — replace in Settings._',
    E'Write in a confident, plain-spoken voice. Lead with the client''s outcome, not our process.\n'
    || E'Keep paragraphs short. Use the client''s own words from discovery notes where possible.'
  )
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_bootstrap_settings
  after insert on auth.users
  for each row execute function public.bootstrap_owner_settings();
