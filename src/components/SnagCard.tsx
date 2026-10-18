import { useState } from 'react';
import { Link } from 'react-router-dom';
import PhotoImg from './PhotoImg';
import type { Snag } from '../lib/types';
import { fmtCoords, fmtDateTime, mapsLink, timeLeft } from '../lib/format';
import { closedSummary, flagLabel, snagRef } from '../lib/snags';

function Coords({ lat, lng, acc }: { lat: number | null; lng: number | null; acc: number | null }) {
  if (lat == null || lng == null) return <>No GPS</>;
  return (
    <a href={mapsLink(lat, lng)} target="_blank" rel="noreferrer">
      {fmtCoords(lat, lng, acc)}
    </a>
  );
}

export default function SnagCard({
  snag,
  index,
  showScaffold,
  onClose,
  onDelete,
  onReview,
}: {
  snag: Snag;
  index?: number;
  showScaffold?: boolean;
  onClose?: () => void;
  onDelete?: () => void;
  /** Site manager approves or rejects a fix that couldn't be verified automatically. */
  onReview?: (approve: boolean, note: string) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const left = snag.status !== 'closed' ? timeLeft(snag.due_at) : null;
  const pending = snag.status === 'pending_approval';
  const fixPhotos = snag.status !== 'open';

  async function review(approve: boolean) {
    if (!onReview) return;
    if (!approve && !reason.trim()) return;
    setBusy(true);
    try {
      await onReview(approve, approve ? '' : reason.trim());
      setRejecting(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`snag-card ${snag.status}`}>
      <div className={`snag-photos ${pending && onReview ? 'compare' : ''}`}>
        {snag.photo_path && (
          <figure>
            <PhotoImg path={snag.photo_path} alt="Snag" className="snag-photo" />
            {fixPhotos && <figcaption>Before</figcaption>}
          </figure>
        )}
        {fixPhotos && snag.close_photo_path && (
          <figure>
            <PhotoImg path={snag.close_photo_path} alt="Fixed" className="snag-photo" />
            <figcaption>After</figcaption>
          </figure>
        )}
        {fixPhotos && snag.close_context_photo_path && (
          <figure>
            <PhotoImg path={snag.close_context_photo_path} alt="Wide shot" className="snag-photo" />
            <figcaption>Wide</figcaption>
          </figure>
        )}
      </div>
      <div className="snag-body">
        <div className="snag-head">
          <strong>
            {index != null ? `Snag ${index + 1}` : 'Snag'}
            {showScaffold && (
              <>
                {' · '}
                <Link to={`/inspections/${snag.inspection_id}`}>{snag.scaffold_name}</Link>
              </>
            )}
          </strong>
          {snag.status === 'closed' ? (
            <span className="badge badge-green">Closed</span>
          ) : pending ? (
            <span className="badge badge-blue">Awaiting approval</span>
          ) : left ? (
            <span className={`badge ${left.overdue ? 'badge-red' : 'badge-amber'}`}>{left.label}</span>
          ) : (
            <span className="badge badge-grey">Not sent yet</span>
          )}
        </div>
        <div>{snag.description}</div>
        {snag.location && <div className="small muted">{snag.location}</div>}
        <div className="small muted">
          {snagRef(snag)} · {fmtDateTime(snag.taken_at)} · <Coords lat={snag.latitude} lng={snag.longitude} acc={snag.accuracy_m} />
        </div>

        {snag.status === 'open' && snag.reject_note && (
          <div className="small danger">Fix rejected: {snag.reject_note}</div>
        )}

        {fixPhotos && (
          <div className="small">
            {snag.status === 'closed' ? 'Fixed' : 'Fix sent'} {fmtDateTime(snag.close_submitted_at ?? snag.closed_at)} by{' '}
            {snag.closed_by_name}
            {snag.status === 'closed' && closedSummary(snag) ? ` - ${closedSummary(snag)}` : ''}
            {snag.close_note ? ` - "${snag.close_note}"` : ''}
            {snag.close_photo_path && (
              <div className="muted">
                Fix photo: <Coords lat={snag.close_latitude} lng={snag.close_longitude} acc={snag.close_accuracy_m} />
                {snag.close_distance_m != null && ` · ${Math.round(snag.close_distance_m)} m from snag`}
                {snag.close_location_source === 'last_known' && ' · last known fix'}
              </div>
            )}
          </div>
        )}

        {pending && snag.close_flags.length > 0 && (
          <ul className="flag-list small">
            {snag.close_flags.map((f) => (
              <li key={f}>{flagLabel(f)}</li>
            ))}
          </ul>
        )}

        {pending && onReview && (
          <div className="review-box">
            {rejecting ? (
              <>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why? e.g. Toe board still missing / wrong plot"
                  autoFocus
                />
                <div className="row gap-sm mt-sm">
                  <button className="btn btn-danger btn-sm" onClick={() => void review(false)} disabled={busy || !reason.trim()}>
                    Reject - send back
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(false)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="row gap-sm">
                <button className="btn btn-success btn-sm" onClick={() => void review(true)} disabled={busy}>
                  ✓ Approve fix
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setRejecting(true)} disabled={busy}>
                  ✗ Reject
                </button>
              </div>
            )}
          </div>
        )}

        {(onClose || onDelete) && (
          <div className="row gap-sm mt-sm">
            {onClose && snag.status === 'open' && (
              <button className="btn btn-success btn-sm" onClick={onClose}>
                📷 Close with photo
              </button>
            )}
            {onDelete && (
              <button className="btn btn-ghost btn-sm danger" onClick={onDelete}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
