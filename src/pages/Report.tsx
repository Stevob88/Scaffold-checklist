import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Inspection, InspectionItem, Snag } from '../lib/types';
import { addHours, fmtDateTime, plotsLabel } from '../lib/format';
import { buildInspectionPdf, reportDeadline, reportFileName } from '../lib/pdf';
import { liftGrid, resultLabel, shortLift } from '../lib/lifts';
import {
  canShareFiles,
  downloadBlob,
  openEmail,
  openWhatsApp,
  reportMessage,
  reportSubject,
  shareFile,
} from '../lib/share';
import { removePhotos } from '../lib/photo';
import { sendNotification } from '../lib/notify';
import SnagCard from '../components/SnagCard';
import CloseSnagModal from '../components/CloseSnagModal';

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { settings, canInspect, canFix, isAdmin } = useAuth();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [snags, setSnags] = useState<Snag[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [issuedAt] = useState(() => new Date());
  const [message, setMessage] = useState<string | null>(null);
  const [closing, setClosing] = useState<Snag | null>(null);
  const shareSupported = canShareFiles();

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const [i, it, s] = await Promise.all([
        supabase.from('inspections').select('*').eq('id', id).maybeSingle(),
        supabase.from('inspection_items').select('*').eq('inspection_id', id).order('lift_order').order('sort_order'),
        supabase.from('snags').select('*').eq('inspection_id', id).order('created_at'),
      ]);
      setInspection(i.data as Inspection | null);
      setItems((it.data as InspectionItem[]) ?? []);
      setSnags((s.data as Snag[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!inspection) return;
    let alive = true;
    setPdf(null);
    setPdfError(null);
    buildInspectionPdf({ inspection, items, snags, settings, issuedAt })
      .then((b) => alive && setPdf(b))
      .catch((e) => alive && setPdfError(e instanceof Error ? e.message : 'Could not build PDF'));
    return () => {
      alive = false;
    };
  }, [inspection, items, snags, settings, issuedAt]);

  if (loading) return <div className="muted">Loading...</div>;
  if (!inspection) return <div className="alert alert-error">Report not found.</div>;

  const ins = inspection;
  const deadline = reportDeadline(ins, settings, issuedAt);
  const text = reportMessage(ins, snags, settings, deadline);
  const subject = reportSubject(ins, settings);
  const fileName = reportFileName(ins);
  const openCount = snags.filter((s) => s.status !== 'closed').length;
  const pass = items.filter((i) => i.result === 'pass').length;
  const fail = items.filter((i) => i.result === 'fail').length;
  const na = items.filter((i) => i.result === 'na').length;
  const grid = liftGrid(items);

  async function markSent() {
    if (ins.sent_at || !canInspect) return;
    const sentAt = new Date();
    const due = addHours(sentAt, settings?.fix_hours ?? 48).toISOString();
    await supabase.from('inspections').update({ sent_at: sentAt.toISOString() }).eq('id', ins.id);
    await supabase
      .from('snags')
      .update({ due_at: due })
      .eq('inspection_id', ins.id)
      .eq('status', 'open')
      .is('due_at', null);
    setInspection({ ...ins, sent_at: sentAt.toISOString() });
    setSnags((prev) => prev.map((s) => (s.status === 'open' && !s.due_at ? { ...s, due_at: due } : s)));
  }

  async function share() {
    if (!pdf) return;
    setMessage(null);
    try {
      const outcome = await shareFile(pdf, fileName, subject, text);
      if (outcome === 'shared') {
        await markSent();
        setMessage('Report shared. The 48 hour clock has started.');
      } else if (outcome === 'unsupported') {
        setMessage('This browser cannot share files. Use Download PDF and attach it to an email, or use WhatsApp text.');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Share failed');
    }
  }

  async function email() {
    if (!pdf) return;
    downloadBlob(pdf, fileName);
    openEmail(settings?.manager_email ?? '', subject, text);
    await markSent();
    setMessage('PDF downloaded. Attach it to the email that just opened.');
  }

  async function whatsapp() {
    openWhatsApp(settings?.manager_phone ?? '', text);
    await markSent();
  }

  function replaceSnag(s: Snag) {
    setSnags((prev) => prev.map((x) => (x.id === s.id ? s : x)));
  }

  async function review(snag: Snag, approve: boolean, note: string) {
    const { data, error } = await supabase.rpc('review_snag_fix', { p_snag_id: snag.id, p_approve: approve, p_note: note });
    if (error) return setMessage(error.message);
    replaceSnag(data as Snag);
    void sendNotification('fix_reviewed', { snag_id: snag.id });
  }

  async function reopen() {
    if (!confirm('Reopen this check to make changes?')) return;
    await supabase.from('inspections').update({ status: 'in_progress', completed_at: null }).eq('id', ins.id);
    navigate(`/inspect/${ins.id}`);
  }

  async function remove() {
    if (!confirm('Delete this whole inspection, its snags and photos? This cannot be undone.')) return;
    await removePhotos(
      snags.flatMap((s) => [s.photo_path ?? '', s.close_photo_path ?? '', s.close_context_photo_path ?? '']),
    );
    await supabase.from('inspections').delete().eq('id', ins.id);
    navigate('/history', { replace: true });
  }

  return (
    <div>
      <div className="card">
        <div className="row between wrap gap-sm">
          <div>
            <h1>{ins.scaffold_name}</h1>
            <div className="small muted">
              {plotsLabel(ins.plot_numbers)} · {ins.inspector_name} · {fmtDateTime(ins.completed_at ?? ins.started_at)}
            </div>
          </div>
          {ins.status === 'in_progress' ? (
            <Link className="btn btn-primary btn-sm" to={`/inspect/${ins.id}`}>
              Continue check
            </Link>
          ) : ins.sent_at ? (
            <span className="badge badge-green">Sent {fmtDateTime(ins.sent_at)}</span>
          ) : (
            <span className="badge badge-amber">Not sent</span>
          )}
        </div>
        <div className="row gap-sm wrap mt-sm">
          <span className="badge badge-green">{pass} OK</span>
          <span className="badge badge-red">{fail} failed</span>
          <span className="badge badge-grey">{na} N/A</span>
          <span className="badge badge-red solid">{openCount} open snags</span>
        </div>
        {openCount > 0 && (
          <div className="small mt-sm">
            {ins.sent_at ? 'Deadline' : 'Deadline once sent'}: <strong>{fmtDateTime(deadline.toISOString())}</strong> (
            {settings?.fix_hours ?? 48} hours)
          </div>
        )}
      </div>

      {canInspect && ins.status === 'completed' && (
        <div className="card">
          <h2>Send to scaffold contracts manager</h2>
          <p className="small muted">
            To: {settings?.manager_name || 'Manager not set'}
            {settings?.manager_email ? ` · ${settings.manager_email}` : ''}
            {settings?.manager_phone ? ` · ${settings.manager_phone}` : ''}
            {isAdmin && (
              <>
                {' '}
                (<Link to="/admin/settings">change</Link>)
              </>
            )}
          </p>
          {pdfError && <div className="alert alert-error">{pdfError}</div>}
          <div className="send-buttons">
            {shareSupported && (
              <button className="btn btn-primary btn-lg" onClick={() => void share()} disabled={!pdf}>
                {pdf ? '📤 Share PDF (Mail, WhatsApp...)' : 'Preparing PDF...'}
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => void email()} disabled={!pdf}>
              ✉ Email
            </button>
            <button className="btn btn-whatsapp" onClick={() => void whatsapp()}>
              WhatsApp message
            </button>
            <button className="btn btn-ghost" onClick={() => pdf && downloadBlob(pdf, fileName)} disabled={!pdf}>
              ⬇ Download PDF
            </button>
          </div>
          <p className="small muted mt-sm">
            {shareSupported
              ? 'Share PDF opens your phone share sheet. Pick Mail or WhatsApp and the PDF with photos is attached.'
              : 'Email downloads the PDF and opens your email app. Attach the downloaded PDF before sending.'}{' '}
            WhatsApp message sends a text summary with map links.
          </p>
          {message && <div className="alert alert-info">{message}</div>}
        </div>
      )}

      <div className="card">
        <h2>Snags ({snags.length})</h2>
        {snags.length === 0 && <p className="muted">No snags recorded.</p>}
        {snags.map((s, i) => (
          <SnagCard
            key={s.id}
            snag={s}
            index={i}
            onClose={canFix ? () => setClosing(s) : undefined}
            onReview={isAdmin ? (approve, note) => review(s, approve, note) : undefined}
          />
        ))}
      </div>

      <div className="card">
        <h2>Checklist</h2>
        {grid.once.length > 0 && (
          <table className="table">
            <tbody>
              {grid.once.map((it) => (
                <tr key={it.id}>
                  <td className="small muted">{it.section}</td>
                  <td>{it.text}</td>
                  <td className={`result ${it.result ?? ''}`}>{resultLabel(it.result)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {grid.rows.length > 0 && (
          <div className="table-scroll mt">
            <table className="table lift-grid">
              <thead>
                <tr>
                  <th>Check</th>
                  {grid.lifts.map((l) => (
                    <th key={l} className="lift-col">
                      {shortLift(l)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={`${row.section}|${row.text}`}>
                    <td>
                      <div className="small muted">{row.section}</div>
                      {row.text}
                    </td>
                    {grid.lifts.map((l) => {
                      const cell = row.cells.get(l);
                      return (
                        <td key={l} className={`result lift-col ${cell?.result ?? ''}`}>
                          {cell ? resultLabel(cell.result) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {ins.notes && (
          <p className="mt">
            <strong>Notes:</strong> {ins.notes}
          </p>
        )}
      </div>

      {canInspect && ins.status === 'completed' && (
        <div className="row gap-sm">
          <button className="btn btn-ghost" onClick={() => void reopen()}>
            Reopen check
          </button>
          {isAdmin && (
            <button className="btn btn-ghost danger" onClick={() => void remove()}>
              Delete inspection
            </button>
          )}
        </div>
      )}

      {closing && <CloseSnagModal snag={closing} onClose={() => setClosing(null)} onSaved={replaceSnag} />}
    </div>
  );
}
