-- Tracking & heatmaps (SPEC §6.2, §6.5, §11).

-- Ingest one batch from the viewer's tracker, atomically:
--   block visibility (upsert + increment), heatmap points (capped at 3,000 per session;
--   extra points are dropped before insert), pricing toggles, and session totals.
-- Owner and bot sessions keep their row (flagged) but store no events.
-- Returns the session's active time before and after, for notification thresholds.
create function public.ingest_tracking(
  p_session_id uuid,
  p_blocks jsonb,
  p_points jsonb,
  p_pricing jsonb,
  p_active_ms_delta int,
  p_max_scroll int
) returns table (active_ms_before bigint, active_ms_after bigint)
language plpgsql
set search_path = ''
as $$
declare
  s public.view_sessions;
  room int;
begin
  select * into s from public.view_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  active_ms_before := s.active_ms;

  if s.is_owner or s.is_bot then
    update public.view_sessions set last_seen_at = now() where id = s.id;
    active_ms_after := s.active_ms;
    return next;
    return;
  end if;

  insert into public.session_block_stats (session_id, block_id, visible_ms, times_entered, first_seen_at)
  select s.id, b ->> 'blockId', greatest(0, least((b ->> 'visibleMsDelta')::bigint, 600000)), case when (b ->> 'entered')::boolean then 1 else 0 end, now()
    from jsonb_array_elements(p_blocks) b
  on conflict (session_id, block_id) do update
    set visible_ms = public.session_block_stats.visible_ms + excluded.visible_ms,
        times_entered = public.session_block_stats.times_entered + excluded.times_entered;

  select greatest(0, 3000 - count(*)) into room from public.heatmap_points where session_id = s.id;
  insert into public.heatmap_points (session_id, proposal_id, version, block_id, kind, x_pct, y_pct, device)
  select s.id, s.proposal_id, s.version, pt ->> 'blockId', (pt ->> 'kind')::public.heatmap_kind,
         least(1, greatest(0, (pt ->> 'x')::real)), least(1, greatest(0, (pt ->> 'y')::real)), s.device
    from (select value as pt from jsonb_array_elements(p_points) limit room) t;

  insert into public.pricing_interactions (session_id, proposal_id, section_id, item_id, action)
  select s.id, s.proposal_id, e ->> 'sectionId', e ->> 'itemId', (e ->> 'action')::public.pricing_action
    from jsonb_array_elements(p_pricing) e;

  update public.view_sessions
     set active_ms = public.view_sessions.active_ms + greatest(0, least(p_active_ms_delta, 600000)),
         max_scroll_pct = greatest(public.view_sessions.max_scroll_pct, least(100, greatest(0, p_max_scroll))),
         last_seen_at = now()
   where id = s.id
  returning public.view_sessions.active_ms into active_ms_after;
  return next;
end;
$$;

-- Coordinates are real (float4); bucketing goes through numeric so values stored as
-- e.g. 0.02 land in cell 1, not cell 0 (0.0199999… × 50).

-- Nightly (SPEC §6.5): roll raw points older than 24 h into the permanent 50×50 grid,
-- then delete raw points older than 90 days.
create function public.rollup_heatmaps() returns int
language plpgsql
set search_path = ''
as $$
declare
  rolled int;
begin
  with pts as (
    update public.heatmap_points
       set rolled_up = true
     where not rolled_up and occurred_at < now() - interval '24 hours'
    returning proposal_id, version, block_id, device, kind, x_pct, y_pct
  ), grouped as (
    select proposal_id, version, block_id, device, kind,
           least(49, floor(x_pct::numeric * 50))::smallint as cell_x, least(49, floor(y_pct::numeric * 50))::smallint as cell_y, count(*)::int as n
      from pts group by 1, 2, 3, 4, 5, 6, 7
  )
  insert into public.heatmap_cells (proposal_id, version, block_id, device, kind, cell_x, cell_y, count)
  select proposal_id, version, block_id, device, kind, cell_x, cell_y, n from grouped
  on conflict (proposal_id, version, block_id, device, kind, cell_x, cell_y)
    do update set count = public.heatmap_cells.count + excluded.count;
  get diagnostics rolled = row_count;
  delete from public.heatmap_points where occurred_at < now() - interval '90 days';
  return rolled;
end;
$$;

-- Heatmap read (SPEC §11.3): permanent cells + raw points not yet rolled up, bucketed
-- into the same 50×50 grid. Filtering by one session uses its raw points (kept 90 days).
create function public.heatmap_grid(p_proposal_id uuid, p_version int, p_device public.device_type, p_kinds public.heatmap_kind[], p_session_id uuid default null)
returns table (block_id text, cell_x smallint, cell_y smallint, count bigint)
language sql
stable
set search_path = ''
as $$
  select block_id, cell_x, cell_y, sum(n)::bigint from (
    select c.block_id, c.cell_x, c.cell_y, c.count::bigint as n
      from public.heatmap_cells c
     where p_session_id is null and c.proposal_id = p_proposal_id and c.version = p_version and c.device = p_device and c.kind = any (p_kinds)
    union all
    select p.block_id, least(49, floor(p.x_pct::numeric * 50))::smallint, least(49, floor(p.y_pct::numeric * 50))::smallint, 1
      from public.heatmap_points p
     where p.proposal_id = p_proposal_id and p.version = p_version and p.device = p_device and p.kind = any (p_kinds)
       and (case when p_session_id is null then not p.rolled_up else p.session_id = p_session_id end)
  ) t group by 1, 2, 3;
$$;

revoke execute on function public.ingest_tracking(uuid, jsonb, jsonb, jsonb, int, int) from public, anon, authenticated;
revoke execute on function public.rollup_heatmaps() from public, anon, authenticated;
revoke execute on function public.heatmap_grid(uuid, int, public.device_type, public.heatmap_kind[], uuid) from public, anon, authenticated;
grant execute on function public.ingest_tracking(uuid, jsonb, jsonb, jsonb, int, int) to service_role;
grant execute on function public.rollup_heatmaps() to service_role;
grant execute on function public.heatmap_grid(uuid, int, public.device_type, public.heatmap_kind[], uuid) to service_role;

create index heatmap_points_rollup_idx on public.heatmap_points (occurred_at) where not rolled_up;
create index view_sessions_visitor_idx on public.view_sessions (proposal_id, visitor_id);
