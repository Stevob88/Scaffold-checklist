import type { ScaffoldKind } from './types';
import { plotsLabel } from './format';

export type PlotType = 'semi' | 'detached' | 'end-terrace' | 'mid-terrace' | 'terrace' | 'apartment' | 'other';

export interface SheetPlot {
  plot: string;
  num: number;
  houseType: string;
  typeText: string;
  type: PlotType;
  handing: 'As' | 'Opp' | null;
  block: string | null;
}

export interface ProposedScaffold {
  key: string;
  plots: string[];
  name: string;
  kind: ScaffoldKind;
  notes: string;
  warning: string | null;
}

export interface SheetResult {
  siteName: string | null;
  statedTotal: number | null;
  plots: SheetPlot[];
  scaffolds: ProposedScaffold[];
  missingPlots: number[];
}

// ---------------------------------------------------------------------------
// Reading files into text lines
// ---------------------------------------------------------------------------

async function pdfLines(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Landscape sheets are often printed with rotated text, so lines are built along each item's own text direction.
    const rows: { angle: number; line: number; items: { along: number; s: string }[] }[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const [a, b, , , x, y] = item.transform;
      const angle = Math.round(Math.atan2(b, a) / (Math.PI / 2)) * 90;
      const rad = (angle * Math.PI) / 180;
      const line = -x * Math.sin(rad) + y * Math.cos(rad);
      const along = x * Math.cos(rad) + y * Math.sin(rad);
      const tol = Math.max(0.5, Math.hypot(a, b) * 0.15);
      let row = rows.find((r) => r.angle === angle && Math.abs(r.line - line) <= tol);
      if (!row) {
        row = { angle, line, items: [] };
        rows.push(row);
      }
      row.items.push({ along, s: item.str });
    }
    rows.sort((p, q) => p.angle - q.angle || q.line - p.line);
    for (const r of rows) lines.push(r.items.sort((p, q) => p.along - q.along).map((i) => i.s).join(' '));
  }
  return lines;
}

async function excelLines(file: File): Promise<string[]> {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets = await readXlsxFile(file);
  return sheets.flatMap((sheet) =>
    sheet.data.map((row) =>
      row
        .filter((c) => c !== null && c !== '')
        .map((c) => String(c).replace(/\s+/g, ' ').trim())
        .join(' '),
    ),
  );
}

async function textLines(file: File): Promise<string[]> {
  return (await file.text()).split(/\r?\n/).map((l) => l.replace(/[,;\t]+/g, ' '));
}

export async function readSheetLines(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return pdfLines(file);
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return excelLines(file);
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. Open it in Excel and Save As .xlsx, or upload the PDF.');
  return textLines(file);
}

// ---------------------------------------------------------------------------
// Parsing plot rows
// ---------------------------------------------------------------------------

// Some PDFs split words with stray spaces ("Terra ce", "Apa rtment"), so keywords allow a space between letters.
const spaced = (word: string) => word.split('').join('\\s?');
const TYPE_WORDS = [
  `${spaced('semi')}[\\s-]*${spaced('detached')}`,
  spaced('detached'),
  `${spaced('end')}[\\s-]*${spaced('terrace')}`,
  `${spaced('mid')}[\\s-]*${spaced('terrace')}`,
  `${spaced('terrace')}d?`,
  `${spaced('apartment')}s?`,
  `${spaced('flat')}s?`,
  `${spaced('maisonette')}s?`,
  spaced('bungalow'),
  `${spaced('coach')}[\\s-]*${spaced('house')}`,
  'fog',
].join('|');
const ROW = new RegExp(`^\\s*(\\d{1,4}[A-Za-z]?)\\s+([A-Za-z][A-Za-z0-9 .'&/()-]{0,50}?)\\s+(${TYPE_WORDS})(?![a-z])(.*)$`, 'i');

/** Rejoins letter-spaced names like "Mai ds tone Mulberry" -> "Maidstone Mulberry". */
function tidyName(s: string): string {
  return s
    .split(/\s+/)
    .reduce<string[]>((out, tok) => {
      if (out.length && /^[a-z]/.test(tok)) out[out.length - 1] += tok;
      else out.push(tok);
      return out;
    }, [])
    .join(' ');
}

function classify(typeText: string): PlotType {
  const t = typeText.toLowerCase().replace(/[\s-]+/g, '');
  if (t.startsWith('semi')) return 'semi';
  if (t.startsWith('end')) return 'end-terrace';
  if (t.startsWith('mid')) return 'mid-terrace';
  if (t.startsWith('terrace')) return 'terrace';
  if (/^(apartment|flat|maisonette)/.test(t)) return 'apartment';
  if (t === 'detached' || t === 'bungalow' || t.startsWith('coach')) return 'detached';
  return 'other';
}

export function parsePlots(lines: string[]): SheetPlot[] {
  const found = new Map<string, SheetPlot>();
  for (const line of lines) {
    const m = ROW.exec(line.replace(/\s+/g, ' '));
    if (!m) continue;
    const [, plot, rawHouse, typeText, rest] = m;
    const key = plot.toUpperCase();
    if (found.has(key)) continue;
    const head = rest.slice(0, 30);
    const handing = /\ba\s?s\b/i.test(head) ? 'As' : /\bo\s?p\s?p\b/i.test(head) ? 'Opp' : null;
    const type = classify(typeText);
    const blockMatch = type === 'apartment' ? /^\s*-?\s*(\d{2,5}|[A-Z])\b/.exec(rest) : null;
    const extra = /^\s*(\([^)]*\)|-\s*(LH|RH|G)\b)/i.exec(rest)?.[1] ?? '';
    found.set(key, {
      plot: key,
      num: parseInt(plot, 10),
      houseType: `${tidyName(rawHouse.replace(/[\s-]+$/, '').trim())}${extra ? ` ${extra.replace(/^-\s*/, '')}` : ''}`,
      typeText,
      type,
      handing,
      block: blockMatch?.[1] ?? null,
    });
  }
  return [...found.values()].sort((a, b) => a.num - b.num || a.plot.localeCompare(b.plot));
}

// ---------------------------------------------------------------------------
// Grouping plots into scaffolds
// ---------------------------------------------------------------------------

const isTerrace = (t: PlotType) => t === 'end-terrace' || t === 'mid-terrace' || t === 'terrace';
const uniq = (xs: string[]) => [...new Set(xs)];

function makeScaffold(group: SheetPlot[], typeLabel: string, warning: string | null = null): ProposedScaffold {
  const plots = group.map((p) => p.plot);
  const isApt = group[0].type === 'apartment';
  const kind: ScaffoldKind = plots.length === 1 ? 'single' : plots.length === 2 ? 'pair' : 'block';
  const name = isApt && plots.length > 2 ? `Apartments ${plots[0]}-${plots[plots.length - 1]}` : plotsLabel(plots);
  return {
    key: plots.join('/'),
    plots,
    name,
    kind,
    notes: `${typeLabel} - ${uniq(group.map((p) => p.houseType)).join(' / ')}`,
    warning,
  };
}

export function groupScaffolds(rows: SheetPlot[]): ProposedScaffold[] {
  const used = new Set<string>();
  const out: ProposedScaffold[] = [];

  rows.forEach((r, i) => {
    if (used.has(r.plot)) return;

    if (r.type === 'semi') {
      const candidates: { p: SheetPlot; idx: number }[] = [];
      for (let j = i + 1; j < rows.length && j <= i + 5; j++) {
        if (!used.has(rows[j].plot) && rows[j].type === 'semi') candidates.push({ p: rows[j], idx: j });
      }
      if (candidates.length === 0) {
        used.add(r.plot);
        out.push(makeScaffold([r], 'Semi', 'Semi-detached with no partner found - set as single'));
        return;
      }
      let pick = candidates[0];
      let warning: string | null = null;
      // Mixed-type semis (e.g. Maidstone + Moresby) can share a handing, so only look past the next plot for same-type pairs.
      if (r.handing && pick.p.handing === r.handing && pick.p.houseType === r.houseType) {
        const opposite = (c: { p: SheetPlot }) => c.p.handing && c.p.handing !== r.handing;
        const better =
          candidates.find((c) => opposite(c) && c.p.houseType === r.houseType) ?? candidates.find(opposite);
        if (better) {
          pick = better;
          warning = 'Check pairing - these plots are not next to each other on the sheet';
        } else {
          warning = 'Check pairing - both plots have the same handing';
        }
      } else if (pick.idx !== i + 1) {
        warning = 'Check pairing - these plots are not next to each other on the sheet';
      }
      used.add(r.plot);
      used.add(pick.p.plot);
      out.push(makeScaffold([r, pick.p], 'Semi', warning));
      return;
    }

    if (isTerrace(r.type)) {
      const group = [r];
      for (let j = i + 1; j < rows.length; j++) {
        const n = rows[j];
        if (used.has(n.plot) || !isTerrace(n.type)) break;
        group.push(n);
        if (n.type === 'end-terrace') break;
      }
      group.forEach((p) => used.add(p.plot));
      const warning =
        group.length === 1
          ? 'Terrace plot on its own - check'
          : group.length > 6
            ? `Long terrace of ${group.length} plots - check`
            : null;
      out.push(makeScaffold(group, 'Terrace', warning));
      return;
    }

    if (r.type === 'apartment') {
      const group = r.block
        ? rows.filter((p) => !used.has(p.plot) && p.type === 'apartment' && p.block === r.block)
        : (() => {
            const g = [r];
            for (let j = i + 1; j < rows.length && rows[j].type === 'apartment' && !used.has(rows[j].plot); j++) g.push(rows[j]);
            return g;
          })();
      group.forEach((p) => used.add(p.plot));
      out.push(makeScaffold(group, r.block ? `Apartment block ${r.block}` : 'Apartments'));
      return;
    }

    used.add(r.plot);
    out.push(
      makeScaffold([r], 'Detached', r.type === 'other' ? `Unrecognised type "${r.typeText}" - set as single` : null),
    );
  });

  return out;
}

// ---------------------------------------------------------------------------

export async function readVariationSheet(file: File): Promise<SheetResult> {
  const lines = await readSheetLines(file);
  const joined = lines.join('\n');
  const siteName = /site\s*:\s*(.+?)(?:\s+\d+\s+total plots|\t|\s{3,}|$)/im.exec(joined)?.[1]?.trim() ?? null;
  const statedTotal = Number(/(\d+)\s+total plots/i.exec(joined)?.[1]) || null;
  const plots = parsePlots(lines);
  const nums = plots.map((p) => p.num);
  const max = Math.max(statedTotal ?? 0, ...nums, 0);
  const have = new Set(nums);
  const missingPlots = nums.length ? Array.from({ length: max }, (_, i) => i + 1).filter((n) => !have.has(n)) : [];
  return { siteName, statedTotal, plots, scaffolds: groupScaffolds(plots), missingPlots };
}
