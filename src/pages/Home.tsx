import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { ChecklistItem, Inspection, Scaffold, Snag } from '../lib/types';
import { byFirstPlot, daysSince, fmtDate, plotsLabel } from '../lib/format';
import { expandChecklist, liftsSummary } from '../lib/lifts';

type InspectionLite = Pick<Inspection, 'id' | 'scaffold_id' | 'status' | 'started_at' | 'completed_at' | 'inspector_id'>;
type SnagLite = Pick<Snag, 'id' | 'inspection_id' | 'due_at' | 'status'>;
type Filter = 'all' | 'overdue' | 'soon';

const DAY_MS = 86_400_000;
const DUE_SOON_DAYS = 2;

export default function Home() {
  const { profile, settings, isAdmin, canInspect } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get('filter') === 'overdue' ? 'overdue' : params.get('filter') === 'soon' ? 'soon' : 'all';
  const [scaffolds, setScaffolds] = useState<Scaffold[]>([]);
  const [inspections, setInspections] = useState<InspectionLite[]>([]);
  const [snags, setSnags] = useState<SnagLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<Scaffold | null>(null);
  const checkDays = settings?.check_days ?? 7;

  useEffect(() => {
    void (async () => {
      const [s, i, n] = await Promise.all([
        supabase.from('scaffolds').select('*').eq('active', true),
        supabase
          .from('inspections')
          .select('id, scaffold_id, status, started_at, completed_at, inspector_id')
          .order('started_at', { ascending: false }),
        supabase.from('snags').select('id, inspection_id, due_at, status').neq('status', 'closed'),
      ]);
      setScaffolds(((s.data as Scaffold[]) ?? []).sort(byFirstPlot));
      setInspections((i.data as InspectionLite[]) ?? []);
      setSnags((n.data as SnagLite[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const scaffoldOfInspection = new Map(inspections.map((i) => [i.id, i.scaffold_id]));
    const map = new Map<string, { last?: InspectionLite; inProgress?: InspectionLite; open: number; overdue: number; pending: number }>();
    const entry = (id: string) => map.get(id) ?? { open: 0, overdue: 0, pending: 0 };
    for (const i of inspections) {
      if (!i.scaffold_id) continue;
      const e = entry(i.scaffold_id);
      if (i.status === 'completed' && !e.last) e.last = i;
      if (i.status === 'in_progress' && !e.inProgress) e.inProgress = i;
      map.set(i.scaffold_id, e);
    }
    const now = Date.now();
    for (const s of snags) {
      const sid = scaffoldOfInspection.get(s.inspection_id);
      if (!sid) continue;
      const e = entry(sid);
      if (s.status === 'pending_approval') e.pending++;
      else {
        e.open++;
        if (s.due_at && new Date(s.due_at).getTime() < now) e.overdue++;
      }
      map.set(sid, e);
    }
    return map;
  }, [inspections, snags]);

  /** Whole days until the next weekly check is due (negative = overdue). */
  const daysLeft = (s: Scaffold) => {
    const last = stats.get(s.id)?.last?.completed_at ?? s.last_checked_at ?? s.created_at;
    return Math.floor((new Date(last).getTime() + checkDays * DAY_MS - Date.now()) / DAY_MS);
  };

  const searched = scaffolds.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.plot_numbers.some((p) => p.toLowerCase().includes(q));
  });
  const overdueCount = scaffolds.filter((s) => daysLeft(s) < 0).length;
  const soonCount = scaffolds.filter((s) => daysLeft(s) >= 0 && daysLeft(s) < DUE_SOON_DAYS).length;
  const filtered = searched.filter((s) =>
    filter === 'overdue' ? daysLeft(s) < 0 : filter === 'soon' ? daysLeft(s) >= 0 && daysLeft(s) < DUE_SOON_DAYS : true,
  );

  const purgeDays = daysSince(settings?.last_purged_at);
  const purgeDue = isAdmin && purgeDays != null && purgeDays >= (settings?.purge_reminder_days ?? 14);

  async function start(s: Scaffold) {
    if (!profile) return;
    setStarting(s.id);
    setError(null);
    try {
      const { data: items, error: e1 } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('active', true)
        .order('sort_order');
      if (e1) throw e1;
      if (!items || items.length === 0) throw new Error('The checklist preset is empty. Add items under Admin > Checklist.');
      const { data: ins, error: e2 } = await supabase
        .from('inspections')
        .insert({
          scaffold_id: s.id,
          scaffold_name: s.name,
          plot_numbers: s.plot_numbers,
          inspector_id: profile.id,
          inspector_name: profile.full_name || profile.email,
        })
        .select()
        .single();
      if (e2) throw e2;
      const { error: e3 } = await supabase
        .from('inspection_items')
        .insert(
          expandChecklist(items as ChecklistItem[], s.lifts ?? 2).map((row) => ({ ...row, inspection_id: (ins as Inspection).id })),
        );
      if (e3) throw e3;
      navigate(`/inspect/${(ins as Inspection).id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start inspection');
      setStarting(null);
    }
  }

  async function setActive(s: Scaffold, active: boolean) {
    setError(null);
    const finishedAt = active ? null : new Date().toISOString();
    const { error: err } = await supabase.from('scaffolds').update({ active, finished_at: finishedAt }).eq('id', s.id);
    if (err) {
      setError(err.message);
      return false;
    }
    setScaffolds((prev) =>
      (active ? [...prev, { ...s, active, finished_at: null }] : prev.filter((x) => x.id !== s.id)).sort(byFirstPlot),
    );
    return true;
  }

  async function finish(s: Scaffold) {
    const st = stats.get(s.id);
    const outstanding = (st?.open ?? 0) + (st?.pending ?? 0);
    const msg = [
      `${s.name} is finished and the scaffold has been struck?`,
      outstanding ? `\n⚠️ It still has ${outstanding} snag(s) not closed.` : '',
      '\nIt will be hidden from this list and stop sending 7-day check reminders. All its checks and photos are kept. You can restore it under Admin > Scaffolds.',
    ].join('');
    if (!confirm(msg)) return;
    if (await setActive(s, false)) setFinished(s);
  }

  return (
    <div>
      <div className="page-head">
        <h1>Scaffolds</h1>
        <input
          className="search"
          type="search"
          placeholder="Search plot number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {purgeDue && (
        <div className="alert alert-warn">
          It's been {purgeDays} days since the data was last archived and wiped.{' '}
          <Link to="/admin/archive">Archive & wipe now</Link>
        </div>
      )}
      {finished && (
        <div className="alert alert-info row between gap-sm">
          <span>{finished.name} moved to Finished.</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void setActive(finished, true).then((ok) => ok && setFinished(null))}
          >
            Undo
          </button>
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      {scaffolds.length > 0 && (
        <div className="segmented segmented-wrap">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setParams({})}>
            All ({scaffolds.length})
          </button>
          <button className={filter === 'overdue' ? 'on' : ''} onClick={() => setParams({ filter: 'overdue' })}>
            Check overdue ({overdueCount})
          </button>
          <button className={filter === 'soon' ? 'on' : ''} onClick={() => setParams({ filter: 'soon' })}>
            Due soon ({soonCount})
          </button>
        </div>
      )}

      {loading ? (
        <div className="muted">Loading...</div>
      ) : scaffolds.length === 0 ? (
        <div className="empty">
          <p>No scaffolds set up yet.</p>
          {isAdmin && (
            <Link className="btn btn-primary" to="/admin/scaffolds">
              Add scaffolds
            </Link>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">Nothing here.</div>
      ) : (
        <div className="grid">
          {filtered.map((s) => {
            const st = stats.get(s.id);
            const days = daysSince(st?.last?.completed_at);
            const left = daysLeft(s);
            return (
              <div key={s.id} className={`card scaffold-card ${left < 0 ? 'check-overdue' : ''}`}>
                <div className="row between">
                  <div>
                    <div className="scaffold-name">{s.name}</div>
                    <div className="small muted">
                      {s.notes || `${s.kind === 'single' ? 'Detached' : s.kind === 'pair' ? 'Pair' : 'Block'} · ${plotsLabel(s.plot_numbers)}`}
                    </div>
                  </div>
                  <div className="row gap-sm">
                    {left < 0 ? (
                      <span className="badge badge-red solid">Check overdue {-left}d</span>
                    ) : left === 0 ? (
                      <span className="badge badge-amber">Check due today</span>
                    ) : left < DUE_SOON_DAYS ? (
                      <span className="badge badge-amber">Due in {left}d</span>
                    ) : (
                      <span className="badge badge-green">Next in {left}d</span>
                    )}
                    {isAdmin && (
                      <button
                        className="icon-btn bin-btn"
                        title="Scaffold finished - remove"
                        aria-label={`Finish ${s.name}`}
                        onClick={() => void finish(s)}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
                <div className="small muted">{liftsSummary(s.lifts ?? 2)}</div>
                <div className="small mt-sm">
                  Last check: {st?.last ? `${fmtDate(st.last.completed_at)} (${days}d ago)` : 'Never'}
                </div>
                <div className="row gap-sm mt-sm wrap">
                  {st && st.open > 0 && <span className="badge badge-red">{st.open} open snag{st.open === 1 ? '' : 's'}</span>}
                  {st && st.overdue > 0 && <span className="badge badge-red solid">{st.overdue} overdue</span>}
                  {st && st.pending > 0 && <span className="badge badge-blue">{st.pending} awaiting approval</span>}
                </div>
                {canInspect && (
                  <div className="mt">
                    {st?.inProgress ? (
                      <Link className="btn btn-primary btn-block" to={`/inspect/${st.inProgress.id}`}>
                        Continue check
                      </Link>
                    ) : (
                      <button
                        className="btn btn-primary btn-block"
                        onClick={() => void start(s)}
                        disabled={starting !== null}
                      >
                        {starting === s.id ? 'Starting...' : 'Start check'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
