// Sends push notifications and emails for Scaffold Checklist.
//
// Events (POST JSON { event, ... }):
//   snags_submitted { inspection_id }  site manager finished a check with snags -> scaffold company
//   fix_submitted   { snag_id }        fix photo submitted -> site manager (approval or FYI)
//   fix_reviewed    { snag_id }        site manager rejected a fix -> scaffold company
//   test            {}                 sends a test to the caller
//   sweep           {}                 run by pg_cron: 48h overdue snags + scaffolds past their 7-day check
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET,
//          optional BREVO_API_KEY or RESEND_API_KEY + EMAIL_FROM (+ EMAIL_FROM_NAME), optional APP_URL.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const BREVO_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? '';
const EMAIL_FROM_NAME = Deno.env.get('EMAIL_FROM_NAME') ?? 'Scaffold Checklist';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface Message {
  title: string;
  body: string;
  path: string;
  tag?: string;
  lines?: string[];
}

interface Settings {
  site_name: string;
  manager_email: string;
  fix_hours: number;
  check_days: number;
  app_url: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function getSettings(): Promise<Settings> {
  const { data } = await db.from('site_settings').select('*').eq('id', 1).single();
  return data as Settings;
}

async function profilesByRole(roles: string[]): Promise<Profile[]> {
  const { data } = await db.from('profiles').select('id, email, full_name, role').in('role', roles);
  return (data as Profile[]) ?? [];
}

async function profilesById(ids: (string | null)[]): Promise<Profile[]> {
  const list = ids.filter((x): x is string => !!x);
  if (list.length === 0) return [];
  const { data } = await db.from('profiles').select('id, email, full_name, role').in('id', list);
  return (data as Profile[]) ?? [];
}

async function sendPush(userIds: string[], msg: Message): Promise<number> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || userIds.length === 0) return 0;
  const { data } = await db.from('push_subscriptions').select('*').in('user_id', [...new Set(userIds)]);
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.path, tag: msg.tag });
  let sent = 0;
  for (const sub of data ?? []) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        TTL: 60 * 60 * 24,
        urgency: 'high',
      });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', sub.id);
      else console.error('push failed', code, (e as Error).message);
    }
  }
  return sent;
}

async function sendEmail(addresses: string[], msg: Message, appUrl: string): Promise<number> {
  const to = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter((a) => a.includes('@')))];
  if (to.length === 0 || !EMAIL_FROM || (!BREVO_KEY && !RESEND_KEY)) return 0;
  const link = appUrl ? `${appUrl}${msg.path}` : '';
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#111">
      <h2 style="margin:0 0 8px">${escapeHtml(msg.title)}</h2>
      <p>${escapeHtml(msg.body)}</p>
      ${msg.lines?.length ? `<ul>${msg.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}
      ${link ? `<p><a href="${link}" style="background:#f97316;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Scaffold Checklist</a></p>` : ''}
    </div>`;
  let sent = 0;
  for (const email of to) {
    const res = BREVO_KEY
      ? await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: { email: EMAIL_FROM, name: EMAIL_FROM_NAME },
            to: [{ email }],
            subject: msg.title,
            htmlContent: html,
          }),
        })
      : await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`, to: [email], subject: msg.title, html }),
        });
    if (res.ok) sent++;
    else console.error('email failed', email, res.status, await res.text());
  }
  return sent;
}

async function notify(
  people: Profile[],
  msg: Message,
  settings: Settings,
  opts: { email?: boolean; extraEmails?: string[] } = {},
) {
  const appUrl = (Deno.env.get('APP_URL') || settings.app_url || '').replace(/\/$/, '');
  const push = await sendPush(
    people.map((p) => p.id),
    msg,
  );
  const email =
    opts.email === false ? 0 : await sendEmail([...people.map((p) => p.email), ...(opts.extraEmails ?? [])], msg, appUrl);
  return { push, email };
}

const snagLine = (s: { location: string; description: string; scaffold_name?: string }, withScaffold = false) =>
  [withScaffold ? s.scaffold_name : '', s.location, s.description].filter(Boolean).join(' - ');

const FLAG_TEXT: Record<string, string> = {
  no_gps: 'no GPS (wide photo provided)',
  off_plot: 'photo taken away from the snag location',
  low_accuracy: 'weak GPS signal',
  no_reference: 'original snag had no GPS',
  late_upload: 'uploaded late (no signal when taken)',
  clock_wrong: 'phone clock looks wrong',
  no_time: 'no photo time',
};

// ---------------------------------------------------------------------------

async function snagsSubmitted(inspectionId: string) {
  const settings = await getSettings();
  const { data: ins } = await db.from('inspections').select('*').eq('id', inspectionId).single();
  if (!ins) return { skipped: 'inspection not found' };
  const { data: snags } = await db
    .from('snags')
    .select('*')
    .eq('inspection_id', inspectionId)
    .eq('status', 'open')
    .is('notified_at', null);
  if (!snags?.length) return { skipped: 'no new snags' };
  const due = snags.map((s) => s.due_at).filter(Boolean).sort()[0] ?? null;
  const msg: Message = {
    title: `${snags.length} scaffold snag${snags.length === 1 ? '' : 's'} - ${ins.scaffold_name}`,
    body: `${settings.site_name}: close ${snags.length === 1 ? 'it' : 'them'} with a photo of the fix by ${fmt(due)} (${settings.fix_hours} hours).`,
    lines: snags.map((s) => snagLine(s)),
    path: '/snags',
    tag: `snags-${inspectionId}`,
  };
  const result = await notify(await profilesByRole(['scaffolder']), msg, settings, { extraEmails: [settings.manager_email] });
  await db
    .from('snags')
    .update({ notified_at: new Date().toISOString() })
    .in(
      'id',
      snags.map((s) => s.id),
    );
  return result;
}

async function fixSubmitted(snagId: string) {
  const settings = await getSettings();
  const { data: s } = await db.from('snags').select('*').eq('id', snagId).single();
  if (!s) return { skipped: 'snag not found' };
  const admins = await profilesByRole(['admin']);
  if (s.status === 'pending_approval') {
    const reasons = (s.close_flags as string[]).map((f) => FLAG_TEXT[f] ?? f).join(', ');
    return notify(
      admins,
      {
        title: `Snag fix needs your approval - ${s.scaffold_name}`,
        body: `${s.closed_by_name ?? 'Scaffolder'} sent a fix photo that could not be verified automatically: ${reasons}. Check before and after photos.`,
        lines: [snagLine(s)],
        path: '/snags?filter=approval',
        tag: `approval-${snagId}`,
      },
      settings,
    );
  }
  if (s.status === 'closed') {
    const { data: ins } = await db.from('inspections').select('inspector_id').eq('id', s.inspection_id).single();
    const people = [...admins, ...(await profilesById([ins?.inspector_id ?? null]))];
    return notify(
      people,
      {
        title: `Snag closed - ${s.scaffold_name}`,
        body: `${s.closed_by_name ?? 'Scaffolder'} closed it with a GPS-verified photo${s.close_distance_m != null ? ` (${Math.round(s.close_distance_m)} m from the snag)` : ''}.`,
        lines: [snagLine(s)],
        path: '/snags?filter=closed',
        tag: `closed-${snagId}`,
      },
      settings,
      { email: false },
    );
  }
  return { skipped: s.status };
}

async function fixReviewed(snagId: string) {
  const settings = await getSettings();
  const { data: s } = await db.from('snags').select('*').eq('id', snagId).single();
  if (!s || s.status !== 'open') return { skipped: s?.status ?? 'snag not found' };
  return notify(
    await profilesByRole(['scaffolder']),
    {
      title: `Fix rejected - ${s.scaffold_name}`,
      body: `${s.reviewed_by_name ?? 'Site manager'}: ${s.reject_note || 'please fix and take a new photo'}. Deadline still ${fmt(s.due_at)}.`,
      lines: [snagLine(s)],
      path: '/snags',
      tag: `rejected-${snagId}`,
    },
    settings,
    { extraEmails: [settings.manager_email] },
  );
}

async function sweep() {
  const settings = await getSettings();
  const now = new Date();
  const out: Record<string, unknown> = {};

  const { data: overdue } = await db
    .from('snags')
    .select('*')
    .eq('status', 'open')
    .lt('due_at', now.toISOString())
    .is('overdue_notified_at', null);
  if (overdue?.length) {
    const { data: inspections } = await db
      .from('inspections')
      .select('id, inspector_id')
      .in('id', [...new Set(overdue.map((s) => s.inspection_id))]);
    const managers = [
      ...(await profilesByRole(['admin'])),
      ...(await profilesById((inspections ?? []).map((i) => i.inspector_id))),
    ];
    const uniq = [...new Map(managers.map((p) => [p.id, p])).values()];
    const lines = overdue.map((s) => `${snagLine(s, true)} (due ${fmt(s.due_at)})`);
    out.overdue_managers = await notify(
      uniq,
      {
        title: `${overdue.length} snag${overdue.length === 1 ? '' : 's'} not closed within ${settings.fix_hours} hours`,
        body: `${settings.site_name}: the scaffold company has missed the deadline.`,
        lines,
        path: '/snags?filter=overdue',
        tag: 'overdue-snags',
      },
      settings,
    );
    out.overdue_scaffolders = await notify(
      await profilesByRole(['scaffolder']),
      {
        title: `OVERDUE: ${overdue.length} scaffold snag${overdue.length === 1 ? '' : 's'}`,
        body: `${settings.site_name}: the ${settings.fix_hours} hour deadline has passed. Close with a photo of the fix now.`,
        lines,
        path: '/snags?filter=overdue',
        tag: 'overdue-snags',
      },
      settings,
      { extraEmails: [settings.manager_email] },
    );
    await db
      .from('snags')
      .update({ overdue_notified_at: now.toISOString() })
      .in(
        'id',
        overdue.map((s) => s.id),
      );
  }

  const days = settings.check_days || 7;
  const { data: scaffolds } = await db
    .from('scaffolds')
    .select('id, name, created_at, last_checked_at, check_reminder_at')
    .eq('active', true);
  const dayMs = 86_400_000;
  const late = (scaffolds ?? []).filter((s) => {
    const base = new Date(s.last_checked_at ?? s.created_at).getTime();
    if (base + days * dayMs > now.getTime()) return false;
    return !s.check_reminder_at || new Date(s.check_reminder_at).getTime() < now.getTime() - dayMs;
  });
  if (late.length) {
    out.checks = await notify(
      await profilesByRole(['admin']),
      {
        title: `${late.length} scaffold${late.length === 1 ? '' : 's'} past the ${days}-day check`,
        body: `${settings.site_name}: these scaffolds have not been inspected in the last ${days} days.`,
        lines: late.map((s) => {
          const ago = Math.floor((now.getTime() - new Date(s.last_checked_at ?? s.created_at).getTime()) / dayMs);
          return `${s.name} - ${s.last_checked_at ? `last checked ${ago} days ago` : `not checked since added ${ago} days ago`}`;
        }),
        path: '/?filter=overdue',
        tag: 'overdue-checks',
      },
      settings,
    );
    await db
      .from('scaffolds')
      .update({ check_reminder_at: now.toISOString() })
      .in(
        'id',
        late.map((s) => s.id),
      );
  }
  return out;
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (body.event === 'sweep') {
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'Forbidden' }, 403);
    return json(await sweep());
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await db.auth.getUser(token);
  if (!userData?.user) return json({ error: 'Sign in first' }, 401);
  const [caller] = await profilesById([userData.user.id]);
  if (!caller || caller.role === 'pending') return json({ error: 'Not allowed' }, 403);

  if (typeof body.app_url === 'string' && /^https:\/\//.test(body.app_url)) {
    await db.from('site_settings').update({ app_url: body.app_url.replace(/\/$/, '') }).eq('id', 1);
  }

  try {
    switch (body.event) {
      case 'snags_submitted':
        if (!['admin', 'inspector'].includes(caller.role)) return json({ error: 'Not allowed' }, 403);
        return json(await snagsSubmitted(body.inspection_id));
      case 'fix_submitted':
        return json(await fixSubmitted(body.snag_id));
      case 'fix_reviewed':
        if (caller.role !== 'admin') return json({ error: 'Not allowed' }, 403);
        return json(await fixReviewed(body.snag_id));
      case 'test': {
        const settings = await getSettings();
        return json(
          await notify(
            [caller],
            { title: 'Test notification', body: `Notifications are working for ${caller.email}.`, path: '/', tag: 'test' },
            settings,
          ),
        );
      }
      default:
        return json({ error: 'Unknown event' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
