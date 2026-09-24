-- Storage buckets (SPEC §6.4). Private buckets are served only through
-- short-lived signed URLs issued by the Worker.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  -- Logos, cover images, team photos used in proposals. Public so the viewer and PDF renderer can load them.
  ('assets', 'assets', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
  -- Drawn signatures (client and owner). Private.
  ('signatures', 'signatures', false, 1048576, array['image/png']),
  -- Signed PDFs and unsigned exports. Private.
  ('signed-pdfs', 'signed-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

-- The owner may manage files in `assets` under a folder named after their user ID.
-- Everything else in storage is Worker-only (service role).
create policy "assets: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "assets: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "assets: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "assets: owner select" on storage.objects for select to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
