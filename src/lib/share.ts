import type { Inspection, SiteSettings, Snag } from './types';
import { fmtDateTime, mapsLink } from './format';

export function canShareFiles(): boolean {
  try {
    const probe = new File([new Blob(['x'], { type: 'application/pdf' })], 'probe.pdf', { type: 'application/pdf' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported';

export async function shareFile(blob: Blob, filename: string, title: string, text: string): Promise<ShareOutcome> {
  const file = new File([blob], filename, { type: blob.type || 'application/pdf' });
  if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [file] })) return 'unsupported';
  try {
    await navigator.share({ files: [file], title, text });
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function openEmail(to: string, subject: string, body: string): void {
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = href;
}

/** Converts UK numbers like 07700 900123 to the international 447700900123 that wa.me needs. */
export function whatsappNumber(phone: string): string {
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = '44' + digits.slice(1);
  return digits;
}

export function openWhatsApp(phone: string, text: string): void {
  const num = phone ? whatsappNumber(phone) : '';
  const url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}

export function reportSubject(inspection: Inspection, settings: SiteSettings | null): string {
  return `Scaffold snags - ${inspection.scaffold_name}${settings?.site_name ? ` - ${settings.site_name}` : ''}`;
}

export function reportMessage(
  inspection: Inspection,
  snags: Snag[],
  settings: SiteSettings | null,
  deadline: Date,
): string {
  const open = snags.filter((s) => s.status !== 'closed');
  const hours = settings?.fix_hours ?? 48;
  const greeting = settings?.manager_name ? `Hi ${settings.manager_name.split(' ')[0]},` : 'Hi,';
  const lines = [
    greeting,
    '',
    `Scaffold inspection for ${inspection.scaffold_name}${settings?.site_name ? ` at ${settings.site_name}` : ''} on ${fmtDateTime(inspection.completed_at ?? inspection.started_at)}.`,
  ];
  if (open.length === 0) {
    lines.push('', 'No snags found. Thanks.');
  } else {
    lines.push(
      '',
      `${open.length} snag${open.length === 1 ? '' : 's'} to be closed within ${hours} hours (by ${fmtDateTime(deadline.toISOString())}):`,
      '',
    );
    open.forEach((s, i) => {
      const where = s.location ? ` [${s.location}]` : '';
      const map = s.latitude != null && s.longitude != null ? ` ${mapsLink(s.latitude, s.longitude)}` : '';
      lines.push(`${i + 1}. ${s.description}${where}${map}`);
    });
    lines.push('', 'Full report with geo-tagged photos attached (PDF).');
  }
  lines.push('', inspection.inspector_name || '');
  return lines.join('\n');
}
