-- Scaffold Checklist database schema.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Users / roles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'pending'
    check (role in ('admin', 'inspector', 'viewer', 'pending')),
  created_at timestamptz not null default now()
);

-- The very first account to sign up becomes admin; everyone after that waits
-- for an admin to approve them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

create or replace function public.can_inspect()
returns boolean language sql stable as $$
  select coalesce(public.my_role() in ('admin', 'inspector'), false);
$$;

create or replace function public.can_view()
returns boolean language sql stable as $$
  select coalesce(public.my_role() in ('admin', 'inspector', 'viewer'), false);
$$;

-- ---------------------------------------------------------------------------
-- Site settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
  id int primary key default 1 check (id = 1),
  site_name text not null default 'My Site',
  company_name text not null default '',
  manager_name text not null default '',
  manager_email text not null default '',
  manager_phone text not null default '',
  fix_hours int not null default 48,
  purge_reminder_days int not null default 14,
  last_purged_at timestamptz default now()
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Scaffolds (a single detached plot, a pair, or a block of plots)
-- ---------------------------------------------------------------------------
create table if not exists public.scaffolds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'pair' check (kind in ('single', 'pair', 'block')),
  plot_numbers text[] not null default '{}',
  lifts int not null default 2 check (lifts between 1 and 6),
  active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Checklist preset
-- ---------------------------------------------------------------------------
create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  section text not null default 'General',
  text text not null,
  sort_order int not null default 0,
  applies text not null default 'every' check (applies in ('once', 'every', 'table')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Inspections, ticked items and snags
-- ---------------------------------------------------------------------------
create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  scaffold_id uuid references public.scaffolds(id) on delete set null,
  scaffold_name text not null,
  plot_numbers text[] not null default '{}',
  inspector_id uuid references public.profiles(id) on delete set null,
  inspector_name text not null default '',
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  sent_at timestamptz,
  notes text not null default ''
);

create table if not exists public.inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  item_id uuid references public.checklist_items(id) on delete set null,
  section text not null,
  text text not null,
  sort_order int not null default 0,
  lift text not null default '',
  lift_order int not null default 0,
  result text check (result in ('pass', 'fail', 'na')),
  note text not null default ''
);
create index if not exists inspection_items_inspection_idx on public.inspection_items(inspection_id);

create table if not exists public.snags (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  inspection_item_id uuid references public.inspection_items(id) on delete set null,
  scaffold_name text not null,
  location text not null default '',
  description text not null default '',
  photo_path text,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  taken_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed')),
  due_at timestamptz,
  closed_at timestamptz,
  closed_by_name text,
  close_note text not null default '',
  close_photo_path text,
  close_latitude double precision,
  close_longitude double precision,
  close_accuracy_m double precision,
  close_taken_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists snags_inspection_idx on public.snags(inspection_id);
create index if not exists snags_status_idx on public.snags(status);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.site_settings enable row level security;
alter table public.scaffolds enable row level security;
alter table public.checklist_items enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_items enable row level security;
alter table public.snags enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select
  using (id = auth.uid() or public.can_view());
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "profiles admin delete" on public.profiles;
create policy "profiles admin delete" on public.profiles for delete
  using (public.is_admin());

drop policy if exists "settings read" on public.site_settings;
create policy "settings read" on public.site_settings for select
  using (auth.uid() is not null);
drop policy if exists "settings admin update" on public.site_settings;
create policy "settings admin update" on public.site_settings for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "scaffolds read" on public.scaffolds;
create policy "scaffolds read" on public.scaffolds for select using (public.can_view());
drop policy if exists "scaffolds admin write" on public.scaffolds;
create policy "scaffolds admin write" on public.scaffolds for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "checklist read" on public.checklist_items;
create policy "checklist read" on public.checklist_items for select using (public.can_view());
drop policy if exists "checklist admin write" on public.checklist_items;
create policy "checklist admin write" on public.checklist_items for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "inspections read" on public.inspections;
create policy "inspections read" on public.inspections for select using (public.can_view());
drop policy if exists "inspections insert" on public.inspections;
create policy "inspections insert" on public.inspections for insert with check (public.can_inspect());
drop policy if exists "inspections update" on public.inspections;
create policy "inspections update" on public.inspections for update
  using (public.can_inspect()) with check (public.can_inspect());
drop policy if exists "inspections delete" on public.inspections;
create policy "inspections delete" on public.inspections for delete
  using (public.is_admin() or (inspector_id = auth.uid() and status = 'in_progress'));

drop policy if exists "items read" on public.inspection_items;
create policy "items read" on public.inspection_items for select using (public.can_view());
drop policy if exists "items write" on public.inspection_items;
create policy "items write" on public.inspection_items for all
  using (public.can_inspect()) with check (public.can_inspect());

drop policy if exists "snags read" on public.snags;
create policy "snags read" on public.snags for select using (public.can_view());
drop policy if exists "snags write" on public.snags;
create policy "snags write" on public.snags for all
  using (public.can_inspect()) with check (public.can_inspect());

-- ---------------------------------------------------------------------------
-- Photo storage (private bucket, signed URLs only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('snag-photos', 'snag-photos', false)
on conflict (id) do nothing;

drop policy if exists "snag photos read" on storage.objects;
create policy "snag photos read" on storage.objects for select
  using (bucket_id = 'snag-photos' and public.can_view());
drop policy if exists "snag photos insert" on storage.objects;
create policy "snag photos insert" on storage.objects for insert
  with check (bucket_id = 'snag-photos' and public.can_inspect());
drop policy if exists "snag photos delete" on storage.objects;
create policy "snag photos delete" on storage.objects for delete
  using (bucket_id = 'snag-photos' and public.can_inspect());

-- ---------------------------------------------------------------------------
-- Starter checklist preset (edit / remove in the app under Admin > Checklist)
-- ---------------------------------------------------------------------------
-- applies: 'once' = whole scaffold, 'every' = each lift and the table lift, 'table' = table lift only.
insert into public.checklist_items (section, text, sort_order, applies)
select * from (values
  ('Paperwork', 'Scaffold tag in place, signed and in date', 10, 'once'),
  ('Paperwork', 'Handover certificate available', 20, 'once'),
  ('Base', 'Base plates on firm, level ground. Footings not undermined', 30, 'once'),
  ('Base', 'Sole boards: minimum 1, maximum 2 under each standard. Do not use if split', 40, 'once'),
  ('Base', 'Board under the foot of the ladder', 50, 'once'),
  ('Base', 'Chute with hopper fitted to the plot', 60, 'once'),
  ('Edge protection', 'Guard rails, outside and inside: top rail at 950mm and lower rail at 470mm', 100, 'every'),
  ('Edge protection', 'Toe boards, outside and inside, clipped on every standard', 110, 'every'),
  ('Edge protection', 'Brick guards in place', 120, 'every'),
  ('Edge protection', 'Inside edge protection in place before next external lift is raised', 130, 'every'),
  ('Edge protection', 'Internal standards flush with platform, or at least 1m high and capped', 140, 'every'),
  ('Platform', 'Plan bracing in place', 200, 'every'),
  ('Platform', 'Boards banded at both ends and in good condition', 210, 'every'),
  ('Platform', 'Inside boards secured at minimum two points. No materials stored on them', 220, 'every'),
  ('Platform', 'Inside board gap no more than 150mm from the building (100mm on timber frame). If bigger, put in a tube to reduce the gap', 230, 'every'),
  ('Platform', 'Working platform no more than 900mm below top of floor joists', 240, 'every'),
  ('Loading bays', 'Any tubes punching through must be flush or at least 1m high', 300, 'every'),
  ('Loading bays', 'No gap from beam to lift more than 50mm', 310, 'every'),
  ('Loading bays', '90-degree and standard loading bays have the correct bracing', 320, 'every'),
  ('Loading bays', 'Maximum load signs on loading bay gates', 330, 'every'),
  ('Gables', 'Gable handrails have 3 tubes where the fall is more than 1.5m', 400, 'every'),
  ('Gables', 'Gable triple handrails no more than 100mm from the gable', 410, 'every'),
  ('Access', 'Access ladders in good condition, tied at 75 degrees, extending 1.05m above the landing, with a halo at the top', 500, 'every'),
  ('Access', 'Self-closing gates close by themselves', 510, 'every'),
  ('Eaves', 'Platform no more than 450mm below top of fascia and at least 900mm beyond the overhang', 600, 'table')
) as v(section, text, sort_order, applies)
where not exists (select 1 from public.checklist_items);
