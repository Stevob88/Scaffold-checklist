import type { ChecklistItem, InspectionItem, ItemApplies } from './types';

export const WHOLE_SCAFFOLD = 'Whole scaffold';
export const TABLE_LIFT = 'Table lift';
const TABLE_ORDER = 99;

export const APPLIES_LABEL: Record<ItemApplies, string> = {
  once: 'Once per scaffold',
  every: 'Every lift',
  table: 'Table lift only',
};

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${s}`;
}

/** "1st lift" ... "Nth lift", then the table lift. */
export function liftsFor(count: number): { lift: string; order: number }[] {
  const lifts = Array.from({ length: Math.max(0, count) }, (_, i) => ({ lift: `${ordinal(i + 1)} lift`, order: i + 1 }));
  return [...lifts, { lift: TABLE_LIFT, order: TABLE_ORDER }];
}

export function liftsSummary(count: number): string {
  return `${count} lift${count === 1 ? '' : 's'} + table lift`;
}

export function liftName(lift: string): string {
  return lift || WHOLE_SCAFFOLD;
}

export function shortLift(lift: string): string {
  return lift ? lift.replace(/ lift$/, '') : 'Once';
}

/** Turns the preset into one inspection row per item per lift it applies to. */
export function expandChecklist(items: ChecklistItem[], liftCount: number) {
  const lifts = liftsFor(liftCount);
  return items
    .flatMap((it) => {
      const targets = it.applies === 'once' ? [{ lift: '', order: 0 }] : it.applies === 'table' ? lifts.slice(-1) : lifts;
      return targets.map((t) => ({
        item_id: it.id,
        section: it.section,
        text: it.text,
        sort_order: it.sort_order,
        lift: t.lift,
        lift_order: t.order,
      }));
    })
    .sort((a, b) => a.lift_order - b.lift_order || a.sort_order - b.sort_order);
}

export function sortItems<T extends Pick<InspectionItem, 'lift_order' | 'sort_order'>>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.lift_order ?? 0) - (b.lift_order ?? 0) || a.sort_order - b.sort_order);
}

export function groupByLift(items: InspectionItem[]): { lift: string; items: InspectionItem[] }[] {
  const out: { lift: string; items: InspectionItem[] }[] = [];
  for (const it of sortItems(items)) {
    const lift = it.lift ?? '';
    const g = out.find((x) => x.lift === lift);
    if (g) g.items.push(it);
    else out.push({ lift, items: [it] });
  }
  return out;
}

export function groupBySection<T extends { section: string }>(items: T[]): { name: string; items: T[] }[] {
  const out: { name: string; items: T[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.name === it.section) last.items.push(it);
    else out.push({ name: it.section, items: [it] });
  }
  return out;
}

export interface LiftGridRow {
  section: string;
  text: string;
  cells: Map<string, InspectionItem>;
}

/** Report layout: whole-scaffold items as a list, per-lift items as one row each with a column per lift. */
export function liftGrid(items: InspectionItem[]) {
  const sorted = sortItems(items);
  const once = sorted.filter((i) => !i.lift);
  const perLift = sorted.filter((i) => i.lift);
  const lifts = [...new Map(perLift.map((i) => [i.lift, i.lift_order])).entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([lift]) => lift);
  const rows = new Map<string, LiftGridRow & { sort: number }>();
  for (const it of perLift) {
    const key = `${it.section}\u0000${it.text}`;
    const row = rows.get(key) ?? { section: it.section, text: it.text, cells: new Map(), sort: it.sort_order };
    row.cells.set(it.lift, it);
    rows.set(key, row);
  }
  return { once, lifts, rows: [...rows.values()].sort((a, b) => a.sort - b.sort) };
}

export function resultLabel(result: InspectionItem['result']): string {
  return result === 'pass' ? 'OK' : result === 'fail' ? 'FAIL' : result === 'na' ? 'N/A' : '-';
}
