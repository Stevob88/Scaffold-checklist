import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import type { Scaffold, ScaffoldKind } from '../../lib/types';
import { byFirstPlot, fmtDate, parsePlots, plotsLabel } from '../../lib/format';
import VariationImport from '../../components/VariationImport';
import { liftsSummary } from '../../lib/lifts';

function kindFor(plots: string[]): ScaffoldKind {
  return plots.length <= 1 ? 'single' : plots.length === 2 ? 'pair' : 'block';
}

export default function ScaffoldsAdmin() {
  const [scaffolds, setScaffolds] = useState<Scaffold[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [plotsInput, setPlotsInput] = useState('');
  const [notes, setNotes] = useState('');
  const [bulk, setBulk] = useState('');
  const [showStruck, setShowStruck] = useState(true);
  const [liftPlots, setLiftPlots] = useState('');
  const [liftCount, setLiftCount] = useState(3);

  async function load() {
    const { data, error: err } = await supabase.from('scaffolds').select('*');
    if (err) setError(err.message);
    setScaffolds(((data as Scaffold[]) ?? []).sort(byFirstPlot));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function insertMany(lists: string[][], notesFor: string) {
    const existing = new Set(scaffolds.map((s) => s.name.toLowerCase()));
    const rows = lists
      .filter((p) => p.length > 0)
      .map((plots) => ({ name: plotsLabel(plots), kind: kindFor(plots), plot_numbers: plots, notes: notesFor }))
      .filter((r) => !existing.has(r.name.toLowerCase()));
    if (rows.length === 0) {
      setInfo('Nothing new to add (already exists).');
      return 0;
    }
    const { error: err } = await supabase.from('scaffolds').insert(rows);
    if (err) {
      setError(err.message);
      return 0;
    }
    await load();
    return rows.length;
  }

  async function addOne(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const plots = parsePlots(plotsInput);
    if (plots.length === 0) return setError('Enter one plot number (detached) or two (pair), e.g. 101/102');
    const n = await insertMany([plots], notes.trim());
    if (n) {
      setPlotsInput('');
      setNotes('');
      setInfo(`Added ${plotsLabel(plots)}`);
    }
  }

  async function addBulk() {
    setError(null);
    setInfo(null);
    const lists = bulk
      .split(/\r?\n/)
      .map((l) => parsePlots(l))
      .filter((p) => p.length > 0);
    if (lists.length === 0) return;
    const n = await insertMany(lists, '');
    if (n) {
      setBulk('');
      setInfo(`Added ${n} scaffold${n === 1 ? '' : 's'}.`);
    }
  }

  async function update(s: Scaffold, patch: Partial<Scaffold>) {
    setScaffolds((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...patch } : x)));
    const { error: err } = await supabase.from('scaffolds').update(patch).eq('id', s.id);
    if (err) setError(err.message);
  }

  async function editPlots(s: Scaffold) {
    const v = prompt('Plot numbers (e.g. 101/102 for a pair, 105 for detached)', s.plot_numbers.join('/'));
    if (v == null) return;
    const plots = parsePlots(v);
    if (plots.length === 0) return;
    await update(s, { plot_numbers: plots, name: plotsLabel(plots), kind: kindFor(plots) });
    setScaffolds((prev) => [...prev].sort(byFirstPlot));
  }

  async function remove(s: Scaffold) {
    if (!confirm(`Delete ${s.name}? Past reports are kept. Tip: untick "Scaffold up" (or use the bin on the Scaffolds page) to move it to Finished instead.`)) return;
    const { error: err } = await supabase.from('scaffolds').delete().eq('id', s.id);
    if (err) return setError(err.message);
    setScaffolds((prev) => prev.filter((x) => x.id !== s.id));
  }

  async function setLiftsBulk() {
    setError(null);
    setInfo(null);
    const wanted = new Set(
      liftPlots.split(/[\s,/&+]+/).flatMap((tok) => {
        const range = /^(\d+)-(\d+)$/.exec(tok);
        if (!range) return tok ? [tok] : [];
        const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
        return Array.from({ length: Math.min(b - a + 1, 500) }, (_, i) => String(a + i));
      }),
    );
    const targets = scaffolds.filter((s) => s.plot_numbers.some((p) => wanted.has(p)));
    if (targets.length === 0) return setError('No scaffolds found for those plots.');
    const ids = targets.map((s) => s.id);
    const { error: err } = await supabase.from('scaffolds').update({ lifts: liftCount }).in('id', ids);
    if (err) return setError(err.message);
    setScaffolds((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, lifts: liftCount } : s)));
    setLiftPlots('');
    setInfo(`Set ${targets.length} scaffold${targets.length === 1 ? '' : 's'} to ${liftsSummary(liftCount)}.`);
  }

  const visible = scaffolds.filter((s) => showStruck || s.active);

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      <VariationImport existing={scaffolds} onDone={() => void load()} />

      <div className="two-col">
        <form className="card" onSubmit={(e) => void addOne(e)}>
          <h2>Add scaffold</h2>
          <div className="field">
            <label htmlFor="plots">Plot number(s)</label>
            <input
              id="plots"
              value={plotsInput}
              onChange={(e) => setPlotsInput(e.target.value)}
              placeholder="101/102 for a pair, 105 for detached"
            />
            {plotsInput && <div className="small muted">Will be added as: {plotsLabel(parsePlots(plotsInput))}</div>}
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. house type" />
          </div>
          <button className="btn btn-primary">Add</button>
        </form>

        <div className="card">
          <h2>Bulk add from variation sheet</h2>
          <p className="small muted">One scaffold per line. Two plots on a line = pair, one plot = detached.</p>
          <textarea rows={6} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'101/102\n103/104\n105\n106/107'} />
          <button className="btn btn-primary mt-sm" onClick={() => void addBulk()} disabled={!bulk.trim()}>
            Add all
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Set lifts</h2>
        <p className="small muted">
          New scaffolds start at {liftsSummary(2)}. Enter plots to change several at once, e.g. "135-143, 173-181, 63".
        </p>
        <div className="form-row">
          <div className="field grow">
            <label htmlFor="lift-plots">Plots</label>
            <input id="lift-plots" value={liftPlots} onChange={(e) => setLiftPlots(e.target.value)} placeholder="135-143, 173-181" />
          </div>
          <div className="field">
            <label htmlFor="lift-count">Lifts</label>
            <select id="lift-count" value={liftCount} onChange={(e) => setLiftCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {liftsSummary(n)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => void setLiftsBulk()} disabled={!liftPlots.trim()}>
          Set lifts
        </button>
      </div>

      <div className="card">
        <div className="row between">
          <h2>
            Scaffolds ({scaffolds.filter((s) => s.active).length} up, {scaffolds.filter((s) => !s.active).length} finished)
          </h2>
          <label className="toggle small">
            <input type="checkbox" checked={showStruck} onChange={(e) => setShowStruck(e.target.checked)} />
            Show finished
          </label>
        </div>
        {loading ? (
          <div className="muted">Loading...</div>
        ) : (
          <div className="list">
            {visible.map((s) => (
              <div key={s.id} className={`list-row ${s.active ? '' : 'inactive'}`}>
                <div>
                  <div className="strong">{s.name}</div>
                  <div className="small muted">
                    {s.kind === 'single' ? 'Detached' : s.kind === 'pair' ? 'Pair' : 'Block'}
                    {s.notes ? ` · ${s.notes}` : ''}
                    {!s.active && s.finished_at ? ` · finished ${fmtDate(s.finished_at)}` : ''}
                  </div>
                </div>
                <div className="row gap-sm wrap">
                  <select
                    className="lift-select"
                    value={s.lifts ?? 2}
                    onChange={(e) => void update(s, { lifts: Number(e.target.value) })}
                    title="Lifts below the table lift"
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {liftsSummary(n)}
                      </option>
                    ))}
                  </select>
                  <label className="toggle small">
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={(e) =>
                        void update(s, {
                          active: e.target.checked,
                          finished_at: e.target.checked ? null : new Date().toISOString(),
                        })
                      }
                    />
                    Scaffold up
                  </label>
                  <button className="btn btn-ghost btn-sm" onClick={() => void editPlots(s)}>
                    Edit
                  </button>
                  <button className="btn btn-ghost btn-sm danger" onClick={() => void remove(s)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
