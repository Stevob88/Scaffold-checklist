import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import type { SiteSettings } from '../../lib/types';
import { sendNotification } from '../../lib/notify';

export default function SettingsAdmin() {
  const { settings, refreshSettings } = useAuth();
  const [form, setForm] = useState<SiteSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => setForm(settings), [settings]);

  if (!form) return <div className="muted">Loading...</div>;

  async function test(delay = 0) {
    setTesting(true);
    setTestMsg(null);
    const r = await sendNotification('test', delay ? { delay_s: String(delay) } : {});
    setTesting(false);
    if (r.error) return setTestMsg(`Failed: ${r.error}`);
    const devices = r.push_devices ?? 0;
    if (devices === 0) {
      return setTestMsg(
        'No devices have notifications turned on for your account. Open the app from the home screen icon on your phone and tap "Turn on notifications".',
      );
    }
    if (r.scheduled) {
      return setTestMsg(
        `Sending to ${devices} device(s) in ${r.scheduled} seconds - lock your phone or go to the home screen now.`,
      );
    }
    const problems = r.push_errors?.length ? ` Problems: ${r.push_errors.join('; ')}` : '';
    setTestMsg(
      `Sent to ${r.push ?? 0} of ${devices} device(s)${r.email ? ' and your email' : ''}.${problems} ` +
        'Phones often hide notifications while the app is open - if nothing showed, try "Send in 10 seconds" and lock the phone.',
    );
  }

  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => setForm({ ...form, [k]: v });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setMsg(null);
    const { id: _id, last_purged_at: _l, vapid_public_key: _v, app_url: _a, ...patch } = form;
    const { error } = await supabase.from('site_settings').update(patch).eq('id', 1);
    setSaving(false);
    if (error) return setMsg(error.message);
    await refreshSettings();
    setMsg('Saved');
  }

  return (
    <form className="card" onSubmit={(e) => void save(e)}>
      <h2>Site</h2>
      <div className="field">
        <label htmlFor="site">Site name</label>
        <input id="site" value={form.site_name} onChange={(e) => set('site_name', e.target.value)} />
      </div>

      <h2 className="mt">Scaffold company contracts manager</h2>
      <div className="form-row">
        <div className="field grow">
          <label htmlFor="mname">Name</label>
          <input id="mname" value={form.manager_name} onChange={(e) => set('manager_name', e.target.value)} />
        </div>
        <div className="field grow">
          <label htmlFor="comp">Scaffold company</label>
          <input id="comp" value={form.company_name} onChange={(e) => set('company_name', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="field grow">
          <label htmlFor="memail">Email</label>
          <input id="memail" type="email" value={form.manager_email} onChange={(e) => set('manager_email', e.target.value)} />
        </div>
        <div className="field grow">
          <label htmlFor="mphone">Mobile (for WhatsApp)</label>
          <input
            id="mphone"
            type="tel"
            value={form.manager_phone}
            onChange={(e) => set('manager_phone', e.target.value)}
            placeholder="07700 900123"
          />
        </div>
      </div>

      <h2 className="mt">Rules</h2>
      <div className="form-row">
        <div className="field">
          <label htmlFor="hours">Hours to close snags</label>
          <input
            id="hours"
            type="number"
            min={1}
            value={form.fix_hours}
            onChange={(e) => set('fix_hours', Number(e.target.value) || 48)}
          />
        </div>
        <div className="field">
          <label htmlFor="purge">Remind me to archive & wipe every (days)</label>
          <input
            id="purge"
            type="number"
            min={1}
            value={form.purge_reminder_days}
            onChange={(e) => set('purge_reminder_days', Number(e.target.value) || 14)}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="checkdays">Each scaffold must be checked every (days)</label>
          <input
            id="checkdays"
            type="number"
            min={1}
            max={30}
            value={form.check_days}
            onChange={(e) => set('check_days', Number(e.target.value) || 7)}
          />
        </div>
        <div className="field">
          <label htmlFor="fence">Fix photo must be within (metres of the snag)</label>
          <input
            id="fence"
            type="number"
            min={15}
            max={500}
            value={form.geofence_m}
            onChange={(e) => set('geofence_m', Number(e.target.value) || 60)}
          />
        </div>
      </div>
      <p className="small muted">
        Fix photos taken further away than this, with no GPS, or uploaded late go to you for approval instead of closing
        automatically.
      </p>

      {msg && <div className="alert alert-info">{msg}</div>}
      <button className="btn btn-primary" disabled={saving}>
        {saving ? 'Saving...' : 'Save settings'}
      </button>

      <h2 className="mt">Notifications</h2>
      <p className="small muted">
        New snags go to Scaffolder accounts (push) and the contracts manager email above. Overdue snags, fixes to approve
        and scaffolds past their {form.check_days}-day check come to admins.
      </p>
      <div className="row gap-sm wrap">
        <button type="button" className="btn btn-secondary" onClick={() => void test()} disabled={testing}>
          {testing ? 'Sending...' : 'Send me a test notification'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void test(10)} disabled={testing}>
          Send in 10 seconds
        </button>
      </div>
      {testMsg && <div className="alert alert-info mt-sm">{testMsg}</div>}
    </form>
  );
}
