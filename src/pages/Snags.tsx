import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Snag } from '../lib/types';
import SnagCard from '../components/SnagCard';
import CloseSnagModal from '../components/CloseSnagModal';
import { FIX_QUEUE_EVENT } from '../lib/fixQueue';
import { sendNotification } from '../lib/notify';
import { isSnagOverdue } from '../lib/snags';
import { buildSnagListPdf, snagListFileName } from '../lib/pdf';
import { canShareFiles, downloadBlob, shareFile } from '../lib/share';

type Filter = 'open' | 'overdue' | 'approval' | 'closed' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'approval', label: 'Awaiting approval' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];
const STATUS_ORDER: Record<Snag['status'], number> = { pending_approval: 0, open: 1, closed: 2 };

export default function Snags() {
  const { canFix, isAdmin, isScaffolder, settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.find((f) => f.id === params.get('filter'))?.id ?? 'open') as Filter;
  const [snags, setSnags] = useState<Snag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<Snag | null>(null);
  const [, setTick] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('snags').select('*').order('created_at', { ascending: false });
    setSnags((data as Snag[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    const reload = () => void load();
    window.addEventListener(FIX_QUEUE_EVENT, reload);
    return () => {
      clearInterval(t);
      window.removeEventListener(FIX_QUEUE_EVENT, reload);
    };
  }, [load]);

  const now = Date.now();
  const matches = (s: Snag, f: Filter) =>
    f === 'all'
      ? true
      : f === 'overdue'
        ? isSnagOverdue(s, now)
        : f === 'approval'
          ? s.status === 'pending_approval'
          : s.status === f;
  const visible = snags
    .filter((s) => matches(s, filter))
    .sort((a, b) => {
      if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return da - db;
    });

  const replace = (s: Snag) => setSnags((prev) => prev.map((x) => (x.id === s.id ? s : x)));

  async function review(snag: Snag, approve: boolean, note: string) {
    setError(null);
    const { data, error: err } = await supabase.rpc('review_snag_fix', {
      p_snag_id: snag.id,
      p_approve: approve,
      p_note: note,
    });
    if (err) {
      setError(err.message);
      return;
    }
    replace(data as Snag);
    void sendNotification('fix_reviewed', { snag_id: snag.id });
  }

  async function exportPdf() {
    setError(null);
    setExporting('Loading plots...');
    try {
      const ids = [...new Set(visible.map((s) => s.inspection_id))];
      const plotsByInspection = new Map<string, string[]>();
      const inspectorByInspection = new Map<string, string>();
      if (ids.length > 0) {
        const { data, error: err } = await supabase
          .from('inspections')
          .select('id, plot_numbers, inspector_name')
          .in('id', ids);
        if (err) throw err;
        for (const i of (data ?? []) as { id: string; plot_numbers: string[]; inspector_name: string }[]) {
          plotsByInspection.set(i.id, i.plot_numbers ?? []);
          inspectorByInspection.set(i.id, i.inspector_name);
        }
      }
      const title = `${FILTERS.find((f) => f.id === filter)?.label ?? 'All'} snags`;
      const pdf = await buildSnagListPdf({
        snags: visible,
        plotsByInspection,
        inspectorByInspection,
        settings,
        title,
        onProgress: setExporting,
      });
      const fileName = snagListFileName(settings, title);
      const outcome = canShareFiles()
        ? await shareFile(pdf, fileName, `${title}${settings?.site_name ? ` - ${settings.site_name}` : ''}`, '')
        : 'unsupported';
      if (outcome === 'unsupported') downloadBlob(pdf, fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build PDF');
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>{isScaffolder ? 'Snags to close' : 'Snags'}</h1>
        <button className="btn btn-secondary btn-sm" onClick={() => void exportPdf()} disabled={!!exporting || visible.length === 0}>
          {exporting ?? '📄 Export PDF'}
        </button>
      </div>
      {isScaffolder && (
        <p className="muted small">
          Close each snag within 48 hours with a photo of the fix taken at the scaffold. Photos with GPS on the plot close
          straight away; anything else goes to the site manager to approve.
        </p>
      )}
      <div className="segmented segmented-wrap">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setParams(f.id === 'open' ? {} : { filter: f.id })}>
            {f.label} ({snags.filter((s) => matches(s, f.id)).length})
          </button>
        ))}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading ? (
        <div className="muted">Loading...</div>
      ) : visible.length === 0 ? (
        <div className="empty">Nothing here.</div>
      ) : (
        <div className="card">
          {visible.map((s) => (
            <SnagCard
              key={s.id}
              snag={s}
              showScaffold
              onClose={canFix ? () => setClosing(s) : undefined}
              onReview={isAdmin ? (approve, note) => review(s, approve, note) : undefined}
            />
          ))}
        </div>
      )}
      {closing && <CloseSnagModal snag={closing} onClose={() => setClosing(null)} onSaved={replace} />}
    </div>
  );
}
