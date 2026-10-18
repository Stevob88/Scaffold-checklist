import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { parsePlots as parsePlotInput, plotsLabel } from '../lib/format';
import { readVariationSheet, type ProposedScaffold, type SheetResult } from '../lib/variationSheet';
import type { Scaffold } from '../lib/types';

type Mode = 'add' | 'replace';

export default function VariationImport({ existing, onDone }: { existing: Scaffold[]; onDone: () => void }) {
  const { settings, refreshSettings } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<SheetResult | null>(null);
  const [rows, setRows] = useState<ProposedScaffold[]>([]);
  const [mode, setMode] = useState<Mode>(existing.length ? 'replace' : 'add');
  const [setSite, setSetSite] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setReading(true);
    setError(null);
    setDone(null);
    setResult(null);
    try {
      const r = await readVariationSheet(file);
      if (r.plots.length === 0) {
        throw new Error(
          "Couldn't find any plots in that file. Each plot row needs the plot number, house type and Semi Detached / Detached / Terrace / Apartment.",
        );
      }
      setResult(r);
      setRows(r.scaffolds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file');
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function editRow(row: ProposedScaffold) {
    const v = prompt('Plot numbers for this scaffold (e.g. 149/150, or 105 for detached)', row.plots.join('/'));
    if (v == null) return;
    const plots = parsePlotInput(v);
    if (plots.length === 0) return;
    setRows((prev) =>
      prev.map((r) =>
        r.key === row.key
          ? {
              ...r,
              plots,
              name: plotsLabel(plots),
              kind: plots.length === 1 ? 'single' : plots.length === 2 ? 'pair' : 'block',
              warning: null,
            }
          : r,
      ),
    );
  }

  function splitRow(row: ProposedScaffold) {
    setRows((prev) =>
      prev.flatMap((r) =>
        r.key === row.key
          ? r.plots.map((p) => ({ ...r, key: `${r.key}-${p}`, plots: [p], name: plotsLabel([p]), kind: 'single' as const, warning: null }))
          : [r],
      ),
    );
  }

  const plotCount = rows.reduce((n, r) => n + r.plots.length, 0);
  const duplicates = (() => {
    const seen = new Map<string, number>();
    rows.forEach((r) => r.plots.forEach((p) => seen.set(p, (seen.get(p) ?? 0) + 1)));
    return [...seen].filter(([, n]) => n > 1).map(([p]) => p);
  })();
  const warnings = rows.filter((r) => r.warning);
  const counts = {
    pairs: rows.filter((r) => r.kind === 'pair').length,
    detached: rows.filter((r) => r.kind === 'single').length,
    terraces: rows.filter((r) => r.kind === 'block' && r.notes.startsWith('Terrace')).length,
    blocks: rows.filter((r) => r.kind === 'block' && r.notes.startsWith('Apartment')).length,
  };

  async function save() {
    if (!result) return;
    if (duplicates.length) return setError(`Plots used twice: ${duplicates.join(', ')}. Fix them before saving.`);
    if (mode === 'replace' && existing.length && !confirm(`Delete the ${existing.length} existing scaffolds and replace them with ${rows.length} from this sheet?\n\nPast inspection reports are kept.`)) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === 'replace' && existing.length) {
        const { error: delErr } = await supabase.from('scaffolds').delete().not('id', 'is', null);
        if (delErr) throw delErr;
      }
      const existingNames = new Set(mode === 'add' ? existing.map((s) => s.name.toLowerCase()) : []);
      const toInsert = rows
        .filter((r) => !existingNames.has(r.name.toLowerCase()))
        .map((r) => ({ name: r.name, kind: r.kind, plot_numbers: r.plots, notes: r.notes }));
      for (let i = 0; i < toInsert.length; i += 200) {
        const { error: insErr } = await supabase.from('scaffolds').insert(toInsert.slice(i, i + 200));
        if (insErr) throw insErr;
      }
      if (setSite && result.siteName) {
        await supabase.from('site_settings').update({ site_name: result.siteName }).eq('id', 1);
        await refreshSettings();
      }
      const skipped = rows.length - toInsert.length;
      setDone(`Saved ${toInsert.length} scaffold${toInsert.length === 1 ? '' : 's'}${skipped ? ` (${skipped} already existed)` : ''}.`);
      setResult(null);
      setRows([]);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Import variation sheet</h2>
      <p className="small muted">
        Upload the variation sheet (PDF or Excel). Semi-detached plots are paired, detached plots get their own scaffold,
        terraces get one scaffold round the row, and apartments get one per block. Check the preview before saving.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xlsm,.csv,.txt,application/pdf"
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={reading || saving}>
        {reading ? `Reading ${fileName}...` : '⬆ Upload variation sheet'}
      </button>

      {error && <div className="alert alert-error">{error}</div>}
      {done && <div className="alert alert-info">{done}</div>}

      {result && (
        <div className="mt">
          <div className="import-summary">
            <div>
              <strong>{fileName}</strong>
              {result.siteName && <div className="small muted">Site: {result.siteName}</div>}
            </div>
            <div className="row gap-sm wrap">
              <span className="badge badge-green">{plotCount} plots</span>
              <span className="badge badge-grey">{rows.length} scaffolds</span>
              <span className="badge badge-grey">{counts.pairs} pairs</span>
              <span className="badge badge-grey">{counts.detached} detached</span>
              {counts.terraces > 0 && <span className="badge badge-grey">{counts.terraces} terraces</span>}
              {counts.blocks > 0 && <span className="badge badge-grey">{counts.blocks} apartment blocks</span>}
            </div>
          </div>

          {result.statedTotal != null && result.statedTotal !== result.plots.length && (
            <div className="alert alert-warn">
              The sheet says {result.statedTotal} plots but {result.plots.length} were found.
              {result.missingPlots.length > 0 && ` Missing: ${result.missingPlots.slice(0, 40).join(', ')}${result.missingPlots.length > 40 ? '...' : ''}`}
            </div>
          )}
          {result.statedTotal == null && result.missingPlots.length > 0 && (
            <div className="alert alert-warn">
              Gaps in plot numbers: {result.missingPlots.slice(0, 40).join(', ')}
              {result.missingPlots.length > 40 ? '...' : ''}
            </div>
          )}
          {duplicates.length > 0 && <div className="alert alert-error">Plots used twice: {duplicates.join(', ')}</div>}
          {warnings.length > 0 && (
            <div className="alert alert-warn">
              {warnings.length} scaffold{warnings.length === 1 ? '' : 's'} to check - highlighted below.
            </div>
          )}

          <div className="list import-list">
            {rows.map((r) => (
              <div key={r.key} className={`list-row ${r.warning ? 'flagged' : ''}`}>
                <div>
                  <div className="strong">{r.name}</div>
                  <div className="small muted">{r.notes}</div>
                  {r.warning && <div className="small warn-text">⚠ {r.warning}</div>}
                </div>
                <div className="row gap-xs">
                  <button className="btn btn-ghost btn-sm" onClick={() => editRow(r)}>
                    Edit
                  </button>
                  {r.plots.length > 1 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => splitRow(r)}>
                      Split
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm danger" onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="field mt">
            {existing.length > 0 && (
              <>
                <label className="toggle">
                  <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  Replace all {existing.length} existing scaffolds
                </label>
                <label className="toggle">
                  <input type="radio" name="mode" checked={mode === 'add'} onChange={() => setMode('add')} />
                  Add new ones only (skip any that already exist)
                </label>
              </>
            )}
            {result.siteName && result.siteName !== settings?.site_name && (
              <label className="toggle">
                <input type="checkbox" checked={setSite} onChange={(e) => setSetSite(e.target.checked)} />
                Set site name to "{result.siteName}"
              </label>
            )}
          </div>

          <div className="row gap-sm">
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving || rows.length === 0}>
              {saving ? 'Saving...' : `Save ${rows.length} scaffolds`}
            </button>
            <button className="btn btn-ghost" onClick={() => setResult(null)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
