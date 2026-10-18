-- Lifts + merged checklist (standard + timber frame forms).
-- Safe to re-run. Keeps the Paperwork items, replaces the rest of the preset.

alter table public.scaffolds
  add column if not exists lifts int not null default 2 check (lifts between 1 and 6);

alter table public.checklist_items
  add column if not exists applies text not null default 'every' check (applies in ('once', 'every', 'table'));

alter table public.inspection_items add column if not exists lift text not null default '';
alter table public.inspection_items add column if not exists lift_order int not null default 0;

update public.checklist_items set applies = 'once' where section = 'Paperwork';

delete from public.checklist_items
where section <> 'Paperwork'
  and not exists (select 1 from public.checklist_items c where c.section = 'Edge protection' and c.text like 'Guard rails, outside and inside%');

insert into public.checklist_items (section, text, sort_order, applies)
select * from (values
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
where not exists (select 1 from public.checklist_items c where c.section = 'Edge protection' and c.text like 'Guard rails, outside and inside%');
