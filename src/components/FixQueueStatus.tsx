import { useEffect, useState } from 'react';
import { discardQueuedFix, FIX_QUEUE_EVENT, listQueuedFixes, processFixQueue, type FixJob } from '../lib/fixQueue';

const RETRY_MS = 60_000;

/** Shows fix photos taken with no signal and sends them as soon as the phone is back online. */
export default function FixQueueStatus() {
  const [jobs, setJobs] = useState<FixJob[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listQueuedFixes()
        .then((j) => alive && setJobs(j))
        .catch(() => undefined);
    const send = () => void processFixQueue().finally(refresh);

    refresh();
    send();
    window.addEventListener(FIX_QUEUE_EVENT, refresh);
    window.addEventListener('online', send);
    const timer = window.setInterval(send, RETRY_MS);
    return () => {
      alive = false;
      window.removeEventListener(FIX_QUEUE_EVENT, refresh);
      window.removeEventListener('online', send);
      window.clearInterval(timer);
    };
  }, []);

  if (!jobs.length) return null;
  const waiting = jobs.filter((j) => !j.lastError);
  const refused = jobs.filter((j) => j.lastError);

  async function retry() {
    setBusy(true);
    await processFixQueue(true);
    setJobs(await listQueuedFixes());
    setBusy(false);
  }

  return (
    <div className="alert alert-info fix-queue">
      {waiting.length > 0 && (
        <div>
          📤 <strong>{waiting.length}</strong> fix photo{waiting.length === 1 ? '' : 's'} waiting for signal. They upload
          automatically - keep the app open when you get signal.
        </div>
      )}
      {refused.map((j) => (
        <div key={j.id} className="fix-queue-refused">
          <span>
            ⚠️ {j.scaffoldName}: {j.lastError}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void discardQueuedFix(j.id)}>
            Discard
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void retry()} disabled={busy}>
        {busy ? 'Sending...' : 'Send now'}
      </button>
    </div>
  );
}
