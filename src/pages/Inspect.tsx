import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Inspection, InspectionItem, ItemResult, Snag } from '../lib/types';
import { addHours, plotsLabel } from '../lib/format';
import { sendNotification } from '../lib/notify';
import { groupByLift, groupBySection, liftName } from '../lib/lifts';
import { removePhotos } from '../lib/photo';
import SnagModal from '../components/SnagModal';
import SnagCard from '../components/SnagCard';

export default function Inspect() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canInspect, settings } = useAuth();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [snags, setSnags] = useState<Snag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snagFor, setSnagFor] = useState<{ itemId: string | null; text: string; lift: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [tab, setTab] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const [i, it, s] = await Promise.all([
        supabase.from('inspections').select('*').eq('id', id).maybeSingle(),
        supabase.from('inspection_items').select('*').eq('inspection_id', id).order('lift_order').order('sort_order'),
        supabase.from('snags').select('*').eq('inspection_id', id).order('created_at'),
      ]);
      const ins = i.data as Inspection | null;
      setInspection(ins);
      setNotes(ins?.notes ?? '');
      setItems((it.data as InspectionItem[]) ?? []);
      setSnags((s.data as Snag[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  const lifts = useMemo(() => groupByLift(items), [items]);
  const tabIdx = Math.max(0, lifts.findIndex((l) => l.lift === tab));
  const current = lifts[tabIdx];
  const sections = useMemo(() => groupBySection(current?.items ?? []), [current]);

  if (loading) return <div className="muted">Loading...</div>;
  if (!inspection) return <div className="alert alert-error">Inspection not found.</div>;
  if (inspection.status === 'completed' || !canInspect) return <Navigate to={`/inspections/${inspection.id}`} replace />;

  const answered = items.filter((i) => i.result).length;
  const snagsByItem = (itemId: string) => snags.filter((s) => s.inspection_item_id === itemId);

  async function setResults(ids: string[], result: ItemResult | null) {
    if (ids.length === 0) return;
    const before = items;
    setItems((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, result } : x)));
    const { error: err } = await supabase.from('inspection_items').update({ result }).in('id', ids);
    if (err) {
      setError(err.message);
      setItems(before);
      return false;
    }
    return true;
  }

  async function setResult(item: InspectionItem, result: ItemResult) {
    const next = item.result === result ? null : result;
    const ok = await setResults([item.id], next);
    if (ok && next === 'fail' && snagsByItem(item.id).length === 0) {
      setSnagFor({ itemId: item.id, text: item.text, lift: item.lift });
    }
  }

  async function passRemainingOnLift() {
    if (!current) return;
    const ids = current.items.filter((i) => !i.result).map((i) => i.id);
    if (ids.length === 0) return;
    if (!confirm(`Mark the ${ids.length} unticked item(s) on ${liftName(current.lift)} as OK?`)) return;
    await setResults(ids, 'pass');
  }

  async function liftNotUp() {
    if (!current) return;
    const answeredHere = current.items.filter((i) => i.result && i.result !== 'na').length;
    const msg = answeredHere
      ? `${liftName(current.lift)} is not up yet?\n\nThis changes ${answeredHere} ticked item(s) on this lift to N/A.`
      : `Mark everything on ${liftName(current.lift)} as N/A (lift not up yet)?`;
    if (!confirm(msg)) return;
    await setResults(
      current.items.map((i) => i.id),
      'na',
    );
  }

  function goToTab(idx: number) {
    setTab(lifts[idx]?.lift ?? null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveNotes() {
    if (!inspection || notes === inspection.notes) return;
    await supabase.from('inspections').update({ notes }).eq('id', inspection.id);
    setInspection({ ...inspection, notes });
  }

  async function deleteSnag(s: Snag) {
    if (!confirm('Delete this snag and its photo?')) return;
    await supabase.from('snags').delete().eq('id', s.id);
    await removePhotos([s.photo_path ?? '']);
    setSnags((prev) => prev.filter((x) => x.id !== s.id));
  }

  async function finish() {
    if (!inspection) return;
    const unanswered = items.length - answered;
    const failedNoPhoto = items.filter((i) => i.result === 'fail' && snagsByItem(i.id).length === 0).length;
    const warnings = [
      unanswered ? `${unanswered} item(s) not ticked.` : '',
      failedNoPhoto ? `${failedNoPhoto} failed item(s) have no snag photo.` : '',
    ].filter(Boolean);
    if (warnings.length && !confirm(`${warnings.join('\n')}\n\nFinish anyway?`)) return;
    setFinishing(true);
    await saveNotes();
    const now = new Date();
    const hasSnags = snags.some((s) => s.status === 'open');
    const { error: err } = await supabase
      .from('inspections')
      .update({
        status: 'completed',
        completed_at: now.toISOString(),
        ...(hasSnags && !inspection.sent_at ? { sent_at: now.toISOString() } : {}),
      })
      .eq('id', inspection.id);
    if (err) {
      setError(err.message);
      setFinishing(false);
      return;
    }
    if (hasSnags) {
      await supabase
        .from('snags')
        .update({ due_at: addHours(now, settings?.fix_hours ?? 48).toISOString() })
        .eq('inspection_id', inspection.id)
        .eq('status', 'open')
        .is('due_at', null);
      void sendNotification('snags_submitted', { inspection_id: inspection.id });
    }
    navigate(`/inspections/${inspection.id}`, { replace: true });
  }

  async function discard() {
    if (!inspection) return;
    if (!confirm('Discard this check? All ticks and snag photos for it will be deleted.')) return;
    await removePhotos(snags.map((s) => s.photo_path ?? ''));
    await supabase.from('inspections').delete().eq('id', inspection.id);
    navigate('/', { replace: true });
  }

  const extraSnags = snags.filter((s) => !s.inspection_item_id);
  const next = lifts[tabIdx + 1];

  return (
    <div className="inspect">
      <div className="inspect-head card">
        <div className="row between">
          <div>
            <h1>{inspection.scaffold_name}</h1>
            <div className="small muted">{plotsLabel(inspection.plot_numbers)}</div>
          </div>
          <div className="progress-count">
            {answered}/{items.length}
          </div>
        </div>
        <div className="progress">
          <div style={{ width: `${items.length ? (answered / items.length) * 100 : 0}%` }} />
        </div>
        {lifts.length > 1 && (
          <div className="lift-tabs mt-sm">
            {lifts.map((l, i) => {
              const done = l.items.filter((x) => x.result).length;
              const failed = l.items.some((x) => x.result === 'fail');
              return (
                <button
                  key={l.lift || 'whole'}
                  className={`lift-tab ${i === tabIdx ? 'on' : ''} ${done === l.items.length ? 'done' : ''} ${failed ? 'has-fail' : ''}`}
                  onClick={() => goToTab(i)}
                >
                  <span>{liftName(l.lift)}</span>
                  <span className="lift-tab-count">
                    {done}/{l.items.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {current && (
        <div className="row gap-sm wrap">
          <button className="btn btn-ghost btn-sm" onClick={() => void passRemainingOnLift()}>
            Tick all remaining OK on {liftName(current.lift)}
          </button>
          {current.lift && (
            <button className="btn btn-ghost btn-sm" onClick={() => void liftNotUp()}>
              {current.lift} not up yet (all N/A)
            </button>
          )}
        </div>
      )}

      {sections.map((sec) => (
        <section key={sec.name} className="card checklist-section">
          <h2>
            {sec.name}
            {current?.lift ? <span className="lift-label"> · {current.lift}</span> : null}
          </h2>
          {sec.items.map((it) => {
            const itemSnags = snagsByItem(it.id);
            return (
              <div key={it.id} className={`check-item ${it.result ?? ''}`}>
                <div className="check-text">{it.text}</div>
                <div className="check-buttons">
                  <button className={`rb pass ${it.result === 'pass' ? 'on' : ''}`} onClick={() => void setResult(it, 'pass')}>
                    ✓ OK
                  </button>
                  <button className={`rb fail ${it.result === 'fail' ? 'on' : ''}`} onClick={() => void setResult(it, 'fail')}>
                    ✗ Fail
                  </button>
                  <button className={`rb na ${it.result === 'na' ? 'on' : ''}`} onClick={() => void setResult(it, 'na')}>
                    N/A
                  </button>
                </div>
                {it.result === 'fail' && (
                  <div className="check-snags">
                    {itemSnags.map((s) => (
                      <SnagCard key={s.id} snag={s} onDelete={() => void deleteSnag(s)} />
                    ))}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setSnagFor({ itemId: it.id, text: it.text, lift: it.lift })}
                    >
                      📷 {itemSnags.length ? 'Add another photo' : 'Add snag photo'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {next && (
        <button className="btn btn-secondary btn-block" onClick={() => goToTab(tabIdx + 1)}>
          Next: {liftName(next.lift)} →
        </button>
      )}

      <section className="card mt">
        <h2>Other snags</h2>
        {extraSnags.map((s) => (
          <SnagCard key={s.id} snag={s} onDelete={() => void deleteSnag(s)} />
        ))}
        <button className="btn btn-secondary" onClick={() => setSnagFor({ itemId: null, text: '', lift: '' })}>
          📷 Add snag not on the checklist
        </button>
      </section>

      <section className="card">
        <h2>Notes</h2>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void saveNotes()} placeholder="Optional notes for the report" />
      </section>

      <div className="sticky-actions">
        <button className="btn btn-ghost danger" onClick={() => void discard()}>
          Discard
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => void finish()} disabled={finishing}>
          {finishing ? 'Finishing...' : snags.length ? `Finish & send ${snags.length} snag${snags.length === 1 ? '' : 's'}` : 'Finish & create report'}
        </button>
      </div>

      {snagFor && (
        <SnagModal
          inspection={inspection}
          inspectionItemId={snagFor.itemId}
          defaultDescription={snagFor.text}
          lift={snagFor.lift}
          onClose={() => setSnagFor(null)}
          onSaved={(s) => {
            setSnags((prev) => [...prev, s]);
            setSnagFor(null);
          }}
        />
      )}
    </div>
  );
}
