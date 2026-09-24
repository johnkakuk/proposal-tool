-- LOCAL DEVELOPMENT ONLY (runs on `supabase db reset`). Never run in production:
-- there, John's account is created by hand in the Supabase dashboard.
--
-- Dev login: owner@bridger.local / bridger-dev-password
-- Creating the user fires the bootstrap trigger, which creates the settings row.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'owner@bridger.local', extensions.crypt('bridger-dev-password', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  gen_random_uuid(), '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
  jsonb_build_object('sub', '00000000-0000-4000-8000-000000000001', 'email', 'owner@bridger.local', 'email_verified', true),
  'email', now(), now(), now()
) on conflict do nothing;
