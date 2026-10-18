import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { enablePush, getPushState, resyncPush, type PushState } from '../lib/push';

const DISMISS_KEY = 'sc-push-dismissed';

export default function NotificationPrompt() {
  const { settings, profile } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    let alive = true;
    void getPushState().then((s) => {
      if (!alive) return;
      setState(s);
      if (s === 'on') void resyncPush().catch(() => undefined);
    });
    return () => {
      alive = false;
    };
  }, [profile?.id]);

  if (!state || state === 'on' || state === 'unsupported' || dismissed) return null;

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      await enablePush(settings?.vapid_public_key ?? '');
      setState('on');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on notifications');
      setState(await getPushState());
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="alert alert-info notify-prompt">
      {state === 'off' && (
        <>
          <div>
            <strong>Turn on notifications</strong> so you hear about new snags, deadlines and overdue checks on this device.
          </div>
          <div className="row gap-sm mt-sm">
            <button className="btn btn-primary btn-sm" onClick={() => void turnOn()} disabled={busy}>
              {busy ? 'Turning on...' : '🔔 Turn on'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={dismiss}>
              Not now
            </button>
          </div>
        </>
      )}
      {state === 'needs-install' && (
        <>
          <div>
            <strong>Get notifications on iPhone/iPad:</strong> tap the Share button, then <em>Add to Home Screen</em>. Open
            Scaffold Checklist from the new icon and tap Turn on.
          </div>
          <button className="btn btn-ghost btn-sm mt-sm" onClick={dismiss}>
            OK
          </button>
        </>
      )}
      {state === 'denied' && (
        <>
          <div>
            Notifications are blocked for this app. Allow them in your phone or browser settings to get snag and deadline
            alerts.
          </div>
          <button className="btn btn-ghost btn-sm mt-sm" onClick={dismiss}>
            OK
          </button>
        </>
      )}
      {error && <div className="small mt-sm">{error}</div>}
    </div>
  );
}
