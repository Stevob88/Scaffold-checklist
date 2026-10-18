-- Scaffolder role, photo-verified snag closing, push notifications, finished scaffolds, 7-day checks.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Roles: scaffolders can see everything but only change snags (through submit_snag_fix)
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'inspector', 'viewer', 'scaffolder', 'pending'));

create or replace function public.can_view()
returns boolean language sql stable as $$
  select coalesce(public.my_role() in ('admin', 'inspector', 'viewer', 'scaffolder'), false);
$$;

create or replace function public.is_scaffolder()
returns boolean language sql stable as $$
  select coalesce(public.my_role() = 'scaffolder', false);
$$;

drop policy if exists "snag photos insert" on storage.objects;
create policy "snag photos insert" on storage.objects for insert
  with check (bucket_id = 'snag-photos' and (public.can_inspect() or public.is_scaffolder()));

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.site_settings add column if not exists check_days int not null default 7;
alter table public.site_settings add column if not exists geofence_m int not null default 60;
alter table public.site_settings add column if not exists vapid_public_key text not null default '';
alter table public.site_settings add column if not exists app_url text not null default '';

-- ---------------------------------------------------------------------------
-- Scaffolds: finished (binned) and last check date that survives the purge
-- ---------------------------------------------------------------------------
alter table public.scaffolds add column if not exists finished_at timestamptz;
alter table public.scaffolds add column if not exists last_checked_at timestamptz;
alter table public.scaffolds add column if not exists check_reminder_at timestamptz;

create or replace function public.inspection_completed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and new.completed_at is not null and new.scaffold_id is not null then
    update public.scaffolds
    set last_checked_at = greatest(coalesce(last_checked_at, new.completed_at), new.completed_at),
        check_reminder_at = null
    where id = new.scaffold_id;
  end if;
  return new;
end;
$$;

drop trigger if exists inspection_completed on public.inspections;
create trigger inspection_completed
  after insert or update of status, completed_at on public.inspections
  for each row execute function public.inspection_completed();

update public.scaffolds s set last_checked_at = x.last_done
from (select scaffold_id, max(completed_at) as last_done from public.inspections where status = 'completed' group by scaffold_id) x
where x.scaffold_id = s.id and s.last_checked_at is null;

-- ---------------------------------------------------------------------------
-- Snags: fix submission, approval and notification tracking
-- ---------------------------------------------------------------------------
alter table public.snags drop constraint if exists snags_status_check;
alter table public.snags add constraint snags_status_check check (status in ('open', 'pending_approval', 'closed'));
alter table public.snags add column if not exists notified_at timestamptz;
alter table public.snags add column if not exists overdue_notified_at timestamptz;
alter table public.snags add column if not exists close_context_photo_path text;
alter table public.snags add column if not exists close_location_source text;
alter table public.snags add column if not exists close_distance_m double precision;
alter table public.snags add column if not exists close_flags text[] not null default '{}';
alter table public.snags add column if not exists close_submitted_by uuid references public.profiles(id) on delete set null;
alter table public.snags add column if not exists close_submitted_at timestamptz;
alter table public.snags add column if not exists close_verified text;
alter table public.snags add column if not exists reviewed_by_name text;
alter table public.snags add column if not exists reviewed_at timestamptz;
alter table public.snags add column if not exists reject_note text not null default '';

-- Closing (or swapping the fix photo) is only possible through submit_snag_fix / review_snag_fix.
create or replace function public.snag_close_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.snag_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.close_photo_path is not null then
      raise exception 'New snags must be open.';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.close_photo_path is distinct from old.close_photo_path
     or new.close_context_photo_path is distinct from old.close_context_photo_path
     or new.close_latitude is distinct from old.close_latitude
     or new.close_longitude is distinct from old.close_longitude
     or new.close_taken_at is distinct from old.close_taken_at
     or new.close_verified is distinct from old.close_verified
     or new.close_flags is distinct from old.close_flags
     or new.closed_at is distinct from old.closed_at then
    raise exception 'Snags can only be closed by taking a photo of the fix in the app.';
  end if;
  return new;
end;
$$;

drop trigger if exists snag_close_guard on public.snags;
create trigger snag_close_guard
  before insert or update on public.snags
  for each row execute function public.snag_close_guard();

create or replace function public.geo_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Checks are done here, on the server, so the phone can't mark its own photo as verified.
-- Anything that can't be verified (no GPS, off the plot, uploaded late, clock wrong) waits for the site manager.
create or replace function public.submit_snag_fix(
  p_snag_id uuid,
  p_photo_path text,
  p_context_photo_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_location_source text,
  p_taken_at timestamptz,
  p_note text
)
returns public.snags
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.snags;
  me public.profiles;
  flags text[] := '{}';
  dist double precision;
  fence int;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role not in ('admin', 'inspector', 'scaffolder') then
    raise exception 'You are not allowed to close snags.';
  end if;

  select * into s from public.snags where id = p_snag_id for update;
  if s.id is null then raise exception 'Snag not found.'; end if;
  if s.status <> 'open' then raise exception 'This snag is not open.'; end if;

  if coalesce(p_photo_path, '') = '' then raise exception 'A photo of the fix is required.'; end if;
  if exists (
    select 1 from public.snags x
    where x.photo_path in (p_photo_path, p_context_photo_path)
       or x.close_photo_path in (p_photo_path, p_context_photo_path)
       or x.close_context_photo_path in (p_photo_path, p_context_photo_path)
  ) then
    raise exception 'That photo has already been used. Take a new photo of the fix.';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'snag-photos' and o.name = p_photo_path
      and o.owner_id = auth.uid()::text and o.created_at >= s.created_at
  ) then
    raise exception 'Fix photo not found. Take the photo again.';
  end if;
  if coalesce(p_context_photo_path, '') <> '' and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'snag-photos' and o.name = p_context_photo_path
      and o.owner_id = auth.uid()::text and o.created_at >= s.created_at
  ) then
    raise exception 'Wide photo not found. Take the photo again.';
  end if;

  select geofence_m into fence from public.site_settings where id = 1;
  fence := coalesce(fence, 60);

  if p_latitude is null or p_longitude is null then
    flags := flags || 'no_gps'::text;
    if coalesce(p_context_photo_path, '') = '' then
      raise exception 'No GPS: also take a wide photo showing the plot number.';
    end if;
  else
    if s.latitude is null or s.longitude is null then
      flags := flags || 'no_reference'::text;
    else
      dist := public.geo_distance_m(s.latitude, s.longitude, p_latitude, p_longitude);
      if dist > fence then flags := flags || 'off_plot'::text; end if;
    end if;
    if coalesce(p_accuracy_m, 9999) > 50 then flags := flags || 'low_accuracy'::text; end if;
  end if;

  if p_taken_at is null then
    flags := flags || 'no_time'::text;
  elsif now() - p_taken_at > interval '15 minutes' then
    flags := flags || 'late_upload'::text;
  elsif p_taken_at - now() > interval '5 minutes' then
    flags := flags || 'clock_wrong'::text;
  end if;

  perform set_config('app.snag_rpc', 'on', true);
  update public.snags set
    status = case when cardinality(flags) = 0 then 'closed' else 'pending_approval' end,
    closed_at = case when cardinality(flags) = 0 then now() else null end,
    closed_by_name = coalesce(nullif(me.full_name, ''), me.email),
    close_note = coalesce(p_note, ''),
    close_photo_path = p_photo_path,
    close_context_photo_path = nullif(p_context_photo_path, ''),
    close_latitude = p_latitude,
    close_longitude = p_longitude,
    close_accuracy_m = p_accuracy_m,
    close_taken_at = p_taken_at,
    close_location_source = coalesce(p_location_source, 'none'),
    close_distance_m = dist,
    close_flags = flags,
    close_submitted_by = auth.uid(),
    close_submitted_at = now(),
    close_verified = case when cardinality(flags) = 0 then 'gps' else null end,
    reviewed_by_name = null,
    reviewed_at = null
  where id = p_snag_id
  returning * into s;
  perform set_config('app.snag_rpc', 'off', true);
  return s;
end;
$$;

create or replace function public.review_snag_fix(p_snag_id uuid, p_approve boolean, p_note text)
returns public.snags
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.snags;
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'admin' then
    raise exception 'Only the site manager can approve or reject fixes.';
  end if;
  select * into s from public.snags where id = p_snag_id for update;
  if s.id is null then raise exception 'Snag not found.'; end if;
  if s.status <> 'pending_approval' then raise exception 'This fix is not waiting for approval.'; end if;

  perform set_config('app.snag_rpc', 'on', true);
  if p_approve then
    update public.snags set
      status = 'closed',
      closed_at = close_submitted_at,
      close_verified = 'approved',
      reviewed_by_name = coalesce(nullif(me.full_name, ''), me.email),
      reviewed_at = now(),
      reject_note = ''
    where id = p_snag_id
    returning * into s;
  else
    update public.snags set
      status = 'open',
      closed_at = null,
      closed_by_name = null,
      close_note = '',
      close_photo_path = null,
      close_context_photo_path = null,
      close_latitude = null,
      close_longitude = null,
      close_accuracy_m = null,
      close_taken_at = null,
      close_location_source = null,
      close_distance_m = null,
      close_flags = '{}',
      close_submitted_by = null,
      close_submitted_at = null,
      close_verified = null,
      reviewed_by_name = coalesce(nullif(me.full_name, ''), me.email),
      reviewed_at = now(),
      reject_note = coalesce(nullif(trim(p_note), ''), 'Fix rejected')
    where id = p_snag_id
    returning * into s;
  end if;
  perform set_config('app.snag_rpc', 'off', true);
  return s;
end;
$$;

revoke all on function public.submit_snag_fix(uuid, text, text, double precision, double precision, double precision, text, timestamptz, text) from public, anon;
grant execute on function public.submit_snag_fix(uuid, text, text, double precision, double precision, double precision, text, timestamptz, text) to authenticated;
revoke all on function public.review_snag_fix(uuid, boolean, text) from public, anon;
grant execute on function public.review_snag_fix(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Push notification subscriptions (one row per phone / browser)
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "push own read" on public.push_subscriptions;
create policy "push own read" on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists "push own delete" on public.push_subscriptions;
create policy "push own delete" on public.push_subscriptions for delete using (user_id = auth.uid());

-- A shared phone can switch user, so the endpoint is re-assigned to whoever is signed in.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_user_agent, ''))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
