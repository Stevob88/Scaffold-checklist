export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtStamp(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function timeLeft(due: string | null, now = Date.now()): { label: string; overdue: boolean } | null {
  if (!due) return null;
  const ms = new Date(due).getTime() - now;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const span = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
  return ms >= 0 ? { label: `${span} left`, overdue: false } : { label: `Overdue ${span}`, overdue: true };
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function plotsLabel(plots: string[]): string {
  if (plots.length === 0) return 'No plots';
  if (plots.length === 1) return `Plot ${plots[0]}`;
  return `Plots ${plots.slice(0, -1).join(', ')} & ${plots[plots.length - 1]}`;
}

/** Orders scaffolds by their lowest plot number, so "Apartments 135-143" sits between plots 134 and 144. */
export function byFirstPlot(a: { name: string; plot_numbers: string[] }, b: { name: string; plot_numbers: string[] }): number {
  const first = (plots: string[]) => Math.min(...plots.map((p) => parseInt(p, 10)).filter((n) => !Number.isNaN(n)), Infinity);
  return first(a.plot_numbers) - first(b.plot_numbers) || a.name.localeCompare(b.name, undefined, { numeric: true });
}

/** Accepts "101/102", "101 & 102", "101, 102", "101+102", "101 and 102". */
export function parsePlots(input: string): string[] {
  return input
    .split(/[\/,&+]|\band\b|\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function mapsLink(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function fmtCoords(lat: number | null, lng: number | null, acc?: number | null): string {
  if (lat == null || lng == null) return 'No location';
  const a = acc != null ? ` (+/-${Math.round(acc)}m)` : '';
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}${a}`;
}

export function safeFileName(s: string): string {
  return s.replace(/[^a-z0-9\-_.]+/gi, '_').replace(/_+/g, '_').slice(0, 80);
}
