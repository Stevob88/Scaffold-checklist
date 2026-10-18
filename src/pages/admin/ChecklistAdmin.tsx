import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import type { ChecklistItem, ItemApplies } from '../../lib/types';
import { APPLIES_LABEL } from '../../lib/lifts';

const APPLIES_OPTIONS = Object.entries(APPLIES_LABEL) as [ItemApplies, string][];

function groupSections(items: ChecklistItem[]) {
  const out: { name: string; items: ChecklistItem[] }[] = [];
  for (const it of items) {
    const sec = out.find((s) => s.name === it.section);
    if (sec) sec.items.push(it);
    else out.push({ name: it.section, items: [it] });
  }
  return out;
}

export default function ChecklistAdmin() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSection, setNewSection] = useState('');
  const [newText, setNewText] = useState('');
  const [newApplies, setNewApplies] = useState<ItemApplies>('every');

  async function load() {
    const { data, error: err } = await supabase.from('checklist_items').select('*').order('sort_order');
    if (err) setError(err.message);
    setItems((data as ChecklistItem[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const sections = useMemo(() => groupSections(items), [items]);

  /** Saves a new ordering: flattens sections in order and renumbers 10, 20, 30... */
  async function saveOrder(groups: { name: string; items: ChecklistItem[] }[]) {
    const flat = groups.flatMap((g) => g.items).map((it, i) => ({ ...it, sort_order: (i + 1) * 10 }));
    setItems(flat);
    const changed = flat.filter((it) => items.find((o) => o.id === it.id)?.sort_order !== it.sort_order);
    if (changed.length === 0) return;
    const { error: err } = await supabase
      .from('checklist_items')
      .upsert(
        changed.map(({ id, section, text, sort_order, applies, active }) => ({ id, section, text, sort_order, applies, active })),
      );
    if (err) setError(err.message);
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const section = newSection.trim() || 'General';
    const text = newText.trim();
    if (!text) return;
    const { data, error: err } = await supabase
      .from('checklist_items')
      .insert({ section, text, sort_order: 999_999, applies: newApplies })
      .select()
      .single();
    if (err) return setError(err.message);
    const groups = groupSections(items);
    const g = groups.find((x) => x.name === section);
    if (g) g.items.push(data as ChecklistItem);
    else groups.push({ name: section, items: [data as ChecklistItem] });
    setNewText('');
    await saveOrder(groups);
  }

  async function updateItem(id: string, patch: Partial<ChecklistItem>) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error: err } = await supabase.from('checklist_items').update(patch).eq('id', id);
    if (err) setError(err.message);
  }

  async function removeItem(it: ChecklistItem) {
    if (!confirm(`Remove "${it.text}" from the preset?\n\nPast reports keep their copy of this item.`)) return;
    const { error: err } = await supabase.from('checklist_items').delete().eq('id', it.id);
    if (err) return setError(err.message);
    setItems((prev) => prev.filter((x) => x.id !== it.id));
  }

  async function renameSection(oldName: string) {
    const name = prompt('Section name', oldName)?.trim();
    if (!name || name === oldName) return;
    setItems((prev) => prev.map((x) => (x.section === oldName ? { ...x, section: name } : x)));
    const { error: err } = await supabase.from('checklist_items').update({ section: name }).eq('section', oldName);
    if (err) setError(err.message);
  }

  async function removeSection(name: string, count: number) {
    if (!confirm(`Remove the whole "${name}" section (${count} items)?`)) return;
    const { error: err } = await supabase.from('checklist_items').delete().eq('section', name);
    if (err) return setError(err.message);
    setItems((prev) => prev.filter((x) => x.section !== name));
  }

  function moveItem(sectionIdx: number, itemIdx: number, dir: -1 | 1) {
    const groups = groupSections(items);
    const list = groups[sectionIdx].items;
    const j = itemIdx + dir;
    if (j < 0 || j >= list.length) return;
    [list[itemIdx], list[j]] = [list[j], list[itemIdx]];
    void saveOrder(groups);
  }

  function moveSection(idx: number, dir: -1 | 1) {
    const groups = groupSections(items);
    const j = idx + dir;
    if (j < 0 || j >= groups.length) return;
    [groups[idx], groups[j]] = [groups[j], groups[idx]];
    void saveOrder(groups);
  }

  if (loading) return <div className="muted">Loading...</div>;

  return (
    <div>
      <p className="muted small">
        This preset is copied into every new check. "Every lift" items appear on each lift and the table lift, "Once per
        scaffold" items appear once, "Table lift only" items appear on the table lift. Untick "In use" to hide an item
        without deleting it. Changes don't affect checks already started.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      <form className="card" onSubmit={(e) => void addItem(e)}>
        <h2>Add item</h2>
        <div className="form-row">
          <div className="field">
            <label htmlFor="sec">Section</label>
            <input
              id="sec"
              list="section-list"
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              placeholder="e.g. Edge protection"
            />
            <datalist id="section-list">
              {sections.map((s) => (
                <option key={s.name} value={s.name} />
              ))}
            </datalist>
          </div>
          <div className="field grow">
            <label htmlFor="txt">Checklist item</label>
            <input id="txt" value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="e.g. Toe boards fitted" />
          </div>
          <div className="field">
            <label htmlFor="applies">Check on</label>
            <select id="applies" value={newApplies} onChange={(e) => setNewApplies(e.target.value as ItemApplies)}>
              {APPLIES_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn btn-primary">Add to preset</button>
      </form>

      {sections.map((sec, si) => (
        <section key={sec.name} className="card checklist-section">
          <div className="row between">
            <h2>{sec.name}</h2>
            <div className="row gap-xs">
              <button className="btn btn-ghost btn-sm" onClick={() => moveSection(si, -1)} disabled={si === 0} title="Move section up">
                ▲
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => moveSection(si, 1)}
                disabled={si === sections.length - 1}
                title="Move section down"
              >
                ▼
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void renameSection(sec.name)}>
                Rename
              </button>
              <button className="btn btn-ghost btn-sm danger" onClick={() => void removeSection(sec.name, sec.items.length)}>
                Remove
              </button>
            </div>
          </div>
          {sec.items.map((it, ii) => (
            <div key={it.id} className={`preset-item ${it.active ? '' : 'inactive'}`}>
              <input
                className="preset-text"
                defaultValue={it.text}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== it.text) void updateItem(it.id, { text: v });
                }}
              />
              <select
                className="applies-select"
                value={it.applies ?? 'every'}
                onChange={(e) => void updateItem(it.id, { applies: e.target.value as ItemApplies })}
              >
                {APPLIES_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="toggle small">
                <input type="checkbox" checked={it.active} onChange={(e) => void updateItem(it.id, { active: e.target.checked })} />
                In use
              </label>
              <div className="row gap-xs">
                <button className="btn btn-ghost btn-sm" onClick={() => moveItem(si, ii, -1)} disabled={ii === 0}>
                  ▲
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => moveItem(si, ii, 1)} disabled={ii === sec.items.length - 1}>
                  ▼
                </button>
                <button className="btn btn-ghost btn-sm danger" onClick={() => void removeItem(it)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
