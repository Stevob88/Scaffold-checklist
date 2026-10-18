import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { buildArchive, getArchiveCounts, purgeAll, type ArchiveCounts } from '../../lib/archive';
import { downloadBlob } from '../../lib/share';
import { daysSince, fmtDate, safeFileName } from '../../lib/format';

export default function ArchiveAdmin() {
  const { settings, refreshSettings } = useAuth();
  const [counts, setCounts] = useState<ArchiveCounts | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getArchiveCounts().then(setCounts).catch((e) => setError(String(e)));
  }, []);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const blob = await buildArchive(settings, setProgress);
      const name = safeFileName(`Scaffold_archive_${settings?.site_name ?? ''}_${new Date().toISOString().slice(0, 10)}`);
      downloadBlob(blob, `${name}.zip`);
      setArchived(true);
      setProgress('Archive downloaded. Keep it somewhere safe (e.g. OneDrive) before wiping.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    if (!confirm('Permanently delete ALL inspections, snags and photos from the app?')) return;
    setBusy(true);
    setError(null);
    try {
      await purgeAll(setProgress);
      await refreshSettings();
      setCounts(await getArchiveCounts());
      setConfirmText('');
      setArchived(false);
      setProgress('All inspection data wiped. Scaffolds, checklist, users and settings were kept.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wipe failed');
    } finally {
      setBusy(false);
    }
  }

  const days = daysSince(settings?.last_purged_at);

  return (
    <div>
      <div className="card">
        <h2>Storage</h2>
        <p>
          Last wiped: <strong>{fmtDate(settings?.last_purged_at)}</strong>
          {days != null && ` (${days} days ago)`}
        </p>
        {counts && (
          <p>
            {counts.inspections} inspections · {counts.snags} snags ({counts.openSnags} still open)
          </p>
        )}
        <p className="small muted">
          The free Supabase plan has limited space, so download an archive and wipe every 2-3 weeks. The archive is a ZIP
          with a PDF report for every check, all original photos, and a snags spreadsheet (CSV). Scaffolds, the checklist
          preset, users and settings are never wiped.
        </p>
      </div>

      <div className="card">
        <h2>1. Download archive</h2>
        <button className="btn btn-primary" onClick={() => void download()} disabled={busy}>
          {busy && !archived ? 'Working...' : 'Download archive (ZIP)'}
        </button>
      </div>

      <div className="card">
        <h2>2. Wipe data</h2>
        {counts && counts.openSnags > 0 && (
          <div className="alert alert-warn">
            {counts.openSnags} snag(s) are still open. They'll be deleted too. They're in the archive if you need them.
          </div>
        )}
        {!archived && <p className="small muted">Download the archive first.</p>}
        <div className="field">
          <label htmlFor="confirm">Type WIPE to confirm</label>
          <input id="confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} disabled={!archived || busy} />
        </div>
        <button className="btn btn-danger" onClick={() => void wipe()} disabled={!archived || busy || confirmText !== 'WIPE'}>
          Wipe all inspection data
        </button>
      </div>

      {progress && <div className="alert alert-info">{progress}</div>}
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}
