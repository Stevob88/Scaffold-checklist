import { useEffect, useState } from 'react';
import Modal from './Modal';
import PhotoImg from './PhotoImg';
import CameraField, { type CapturedPhoto } from './CameraField';
import { distanceM, fmtDistance, watchGps, type GeoFix } from '../lib/photo';
import { isNetworkError, queueFix, submitFix, type FixJob } from '../lib/fixQueue';
import { flagLabel, snagRef } from '../lib/snags';
import { timeLeft } from '../lib/format';
import { useAuth } from '../lib/auth';
import type { Snag } from '../lib/types';

const NO_GPS_AFTER_MS = 20_000;

type Outcome = { kind: 'closed' | 'pending'; snag: Snag } | { kind: 'queued' };

/** Closing a snag: the only way is a live, stamped photo of the fix, checked by the server. */
export default function CloseSnagModal({
  snag,
  onSaved,
  onClose,
}: {
  snag: Snag;
  onSaved: (snag: Snag) => void;
  onClose: () => void;
}) {
  const { profile, settings } = useAuth();
  const fence = settings?.geofence_m ?? 60;
  const [gps, setGps] = useState<GeoFix | null>(null);
  const [gpsMsg, setGpsMsg] = useState('Searching for GPS...');
  const [gpsSlow, setGpsSlow] = useState(false);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [context, setContext] = useState<CapturedPhoto | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const name = profile?.full_name || profile?.email || 'Scaffolder';
  const ref = snagRef(snag);
  const hasRef = snag.latitude != null && snag.longitude != null;
  const left = timeLeft(snag.due_at);

  useEffect(() => {
    const stop = watchGps(setGps, setGpsMsg);
    const t = window.setTimeout(() => setGpsSlow(true), NO_GPS_AFTER_MS);
    return () => {
      stop();
      window.clearTimeout(t);
    };
  }, []);

  const distFrom = (fix: GeoFix | null) =>
    fix && hasRef ? distanceM(snag.latitude!, snag.longitude!, fix.latitude, fix.longitude) : null;
  const liveDist = distFrom(gps);
  const photoDist = distFrom(photo?.fix ?? null);
  const noGps = !!photo && !photo.fix;
  const offPlot = photoDist != null && photoDist > fence;
  const needsContext = noGps;

  async function save() {
    if (!photo) return setError('Take a photo of the fix first.');
    if (needsContext && !context) return setError('No GPS: also take a wide photo showing the plot number.');
    setSaving(true);
    setError(null);
    const job: FixJob = {
      id: crypto.randomUUID(),
      snagId: snag.id,
      inspectionId: snag.inspection_id,
      scaffoldName: snag.scaffold_name,
      photo: photo.blob,
      context: context?.blob ?? null,
      latitude: photo.fix?.latitude ?? null,
      longitude: photo.fix?.longitude ?? null,
      accuracy: photo.fix?.accuracy ?? null,
      source: photo.source,
      takenAt: photo.takenAt.toISOString(),
      note: note.trim(),
      queuedAt: new Date().toISOString(),
    };
    try {
      if (!navigator.onLine) {
        await queueFix(job);
        setOutcome({ kind: 'queued' });
        return;
      }
      const saved = await submitFix(job);
      onSaved(saved);
      setOutcome({ kind: saved.status === 'closed' ? 'closed' : 'pending', snag: saved });
    } catch (e) {
      if (isNetworkError(e)) {
        await queueFix(job);
        setOutcome({ kind: 'queued' });
      } else {
        setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? 'Could not send fix'));
      }
    } finally {
      setSaving(false);
    }
  }

  if (outcome) {
    return (
      <Modal
        title="Fix sent"
        onClose={onClose}
        footer={
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        }
      >
        {outcome.kind === 'closed' && (
          <div className="alert alert-success">
            ✅ Snag closed. GPS verified
            {outcome.snag.close_distance_m != null ? ` - ${Math.round(outcome.snag.close_distance_m)} m from the snag` : ''}.
          </div>
        )}
        {outcome.kind === 'pending' && (
          <div className="alert alert-info">
            <p>
              ⏳ Sent to the site manager for approval. It stays open until approved, so the 48-hour clock is still running.
            </p>
            <ul>
              {outcome.snag.close_flags.map((f) => (
                <li key={f}>{flagLabel(f)}</li>
              ))}
            </ul>
          </div>
        )}
        {outcome.kind === 'queued' && (
          <div className="alert alert-info">
            📤 No signal - the fix is saved on this phone and uploads automatically when you get signal. Keep the app open
            when you're back in signal. Uploading more than 15 minutes later means the site manager will need to approve it.
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={`Close snag - ${snag.scaffold_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-success"
            onClick={() => void save()}
            disabled={saving || !photo || (needsContext && !context)}
          >
            {saving ? 'Sending...' : 'Send fix'}
          </button>
        </>
      }
    >
      <div className="fix-before">
        {snag.photo_path && <PhotoImg path={snag.photo_path} alt="Snag" className="snag-photo" />}
        <div>
          <div>
            <strong>{snag.description}</strong>
          </div>
          {snag.location && <div className="small muted">{snag.location}</div>}
          <div className="small muted">Ref {ref}</div>
          {left && <span className={`badge ${left.overdue ? 'badge-red' : 'badge-amber'}`}>{left.label}</span>}
        </div>
      </div>

      {snag.reject_note && (
        <div className="alert alert-error">Last fix was rejected: {snag.reject_note}</div>
      )}

      <div className={`gps-status ${gps ? (liveDist != null && liveDist > fence ? 'warn' : 'ok') : gpsSlow ? 'bad' : ''}`}>
        {gps ? (
          <>
            📍 GPS ±{Math.round(gps.accuracy)} m
            {liveDist != null &&
              (liveDist > fence
                ? ` - you are ${fmtDistance(liveDist)} from where the snag was logged. Go to the scaffold.`
                : ` - ${Math.round(liveDist)} m from the snag ✓`)}
            {!hasRef && ' - original snag had no GPS, so this will need approval'}
          </>
        ) : gpsSlow ? (
          <>
            📡 No GPS yet. GPS works without phone signal but can take a minute - try in the open, away from the
            scaffold. If it still won't come, take the fix photo anyway and you'll be asked for a wide photo showing the
            plot number. The site manager then approves it.
          </>
        ) : (
          <>⏳ {gpsMsg}</>
        )}
      </div>

      <div className="field">
        <label>Photo of the fix (same view as the snag photo)</label>
        <CameraField
          stamp={{ title: snag.scaffold_name, subtitle: `FIXED${snag.location ? ` - ${snag.location}` : ''}`, inspector: name, code: ref }}
          value={photo}
          onChange={setPhoto}
          ghostPath={snag.photo_path}
          allowNoGps
        />
        {offPlot && (
          <div className="alert alert-warn">
            This photo was taken {fmtDistance(photoDist!)} from the snag. Retake it at the scaffold, or it will need site
            manager approval.
          </div>
        )}
      </div>

      {(needsContext || offPlot || context) && (
        <div className="field">
          <label>
            Wide photo showing the plot number {needsContext ? '(required - no GPS)' : '(recommended)'}
          </label>
          <div className="small muted">Stand back so the plot number / house and the fixed scaffold are both in shot.</div>
          <CameraField
            stamp={{ title: snag.scaffold_name, subtitle: 'WIDE SHOT - PLOT', inspector: name, code: ref }}
            value={context}
            onChange={setContext}
            allowNoGps
            label="📷 Take wide photo"
          />
        </div>
      )}

      <div className="field">
        <label htmlFor="close-note">Note</label>
        <textarea id="close-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  );
}
