import type { Snag } from './types';

/** Why a fix photo could not be verified automatically and needs the site manager to approve it. */
export const FLAG_LABELS: Record<string, string> = {
  no_gps: 'No GPS when the photo was taken (wide photo of the plot attached)',
  no_reference: 'The original snag photo had no GPS to compare against',
  off_plot: 'Taken away from where the snag was logged',
  low_accuracy: 'GPS was not accurate enough',
  no_time: 'No time on the photo',
  late_upload: 'Uploaded more than 15 minutes after it was taken (no signal?)',
  clock_wrong: "Phone clock doesn't match the server clock",
};

export const flagLabel = (f: string) => FLAG_LABELS[f] ?? f;

export const snagRef = (s: Pick<Snag, 'id'>) => `S-${s.id.slice(0, 6).toUpperCase()}`;

export function isSnagOverdue(s: Snag, now = Date.now()): boolean {
  return s.status === 'open' && !!s.due_at && new Date(s.due_at).getTime() < now;
}

/** One line describing how a snag was closed, for cards, reports and PDFs. */
export function closedSummary(s: Snag): string {
  if (s.status !== 'closed') return '';
  const how =
    s.close_verified === 'gps'
      ? `GPS verified${s.close_distance_m != null ? ` (${Math.round(s.close_distance_m)} m from snag)` : ''}`
      : s.close_verified === 'approved'
        ? `approved by ${s.reviewed_by_name ?? 'site manager'}`
        : '';
  const late = s.due_at && s.closed_at && new Date(s.closed_at) > new Date(s.due_at) ? ' - closed late' : '';
  return how + late;
}
