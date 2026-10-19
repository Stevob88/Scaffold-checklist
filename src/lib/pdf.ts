import { jsPDF } from 'jspdf';
import type { Inspection, InspectionItem, SiteSettings, Snag } from './types';
import { addHours, fmtCoords, fmtDateTime, mapsLink, plotsLabel, safeFileName } from './format';
import { photoForPdf } from './photo';
import { liftGrid, resultLabel, shortLift } from './lifts';
import { closedSummary, isSnagOverdue, snagRef } from './snags';

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14;
const CONTENT_W = PAGE_W - M * 2;

interface ReportInput {
  inspection: Inspection;
  items: InspectionItem[];
  snags: Snag[];
  settings: SiteSettings | null;
  issuedAt: Date;
}

export function reportFileName(inspection: Inspection): string {
  const d = new Date(inspection.completed_at ?? inspection.started_at).toISOString().slice(0, 10);
  return safeFileName(`Scaffold_${inspection.scaffold_name}_${d}`) + '.pdf';
}

export function reportDeadline(inspection: Inspection, settings: SiteSettings | null, issuedAt: Date): Date {
  const base = inspection.sent_at ? new Date(inspection.sent_at) : issuedAt;
  return addHours(base, settings?.fix_hours ?? 48);
}

export async function buildInspectionPdf({ inspection, items, snags, settings, issuedAt }: ReportInput): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = M;

  const ensure = (h: number) => {
    if (y + h > PAGE_H - M - 6) {
      doc.addPage();
      y = M;
    }
  };

  const fixHours = settings?.fix_hours ?? 48;
  const openSnags = snags.filter((s) => s.status !== 'closed');
  const deadline = reportDeadline(inspection, settings, issuedAt);

  doc.setFillColor(31, 41, 55);
  doc.rect(0, 0, PAGE_W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Scaffold Inspection Report', M, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(settings?.site_name || 'Site', M, 20);
  doc.text(inspection.scaffold_name, PAGE_W - M, 20, { align: 'right' });
  y = 36;

  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  const pass = items.filter((i) => i.result === 'pass').length;
  const fail = items.filter((i) => i.result === 'fail').length;
  const na = items.filter((i) => i.result === 'na').length;
  const unchecked = items.length - pass - fail - na;
  const info: [string, string][] = [
    ['Scaffold', `${inspection.scaffold_name} (${plotsLabel(inspection.plot_numbers)})`],
    ['Inspected by', inspection.inspector_name || '-'],
    ['Inspection date', fmtDateTime(inspection.completed_at ?? inspection.started_at)],
    ['Report issued', fmtDateTime((inspection.sent_at ? new Date(inspection.sent_at) : issuedAt).toISOString())],
    ['For attention of', [settings?.manager_name, settings?.company_name].filter(Boolean).join(', ') || '-'],
    ['Checklist', `${pass} OK, ${fail} failed, ${na} N/A${unchecked ? `, ${unchecked} not checked` : ''}`],
  ];
  info.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(k, M, y);
    doc.setFont('helvetica', 'normal');
    doc.text(v, M + 38, y);
    y += 6;
  });
  y += 2;

  if (openSnags.length > 0) {
    doc.setFillColor(254, 226, 226);
    doc.setDrawColor(220, 38, 38);
    doc.roundedRect(M, y, CONTENT_W, 16, 2, 2, 'FD');
    doc.setTextColor(153, 27, 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${openSnags.length} open snag${openSnags.length === 1 ? '' : 's'} - to be closed within ${fixHours} hours`, M + 4, y + 6.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Deadline: ${fmtDateTime(deadline.toISOString())}`, M + 4, y + 12.5);
    y += 22;
  } else {
    doc.setFillColor(220, 252, 231);
    doc.setDrawColor(22, 163, 74);
    doc.roundedRect(M, y, CONTENT_W, 10, 2, 2, 'FD');
    doc.setTextColor(21, 128, 61);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('No open snags', M + 4, y + 6.5);
    y += 16;
  }
  doc.setTextColor(17, 24, 39);

  if (snags.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    ensure(10);
    doc.text('Snags', M, y);
    y += 6;

    for (let i = 0; i < snags.length; i++) {
      const s = snags[i];
      const photoW = 88;
      let photo: { dataUrl: string; width: number; height: number } | null = null;
      if (s.photo_path) {
        try {
          photo = await photoForPdf(s.photo_path);
        } catch {
          photo = null;
        }
      }
      const photoH = photo ? Math.min(110, (photo.height / photo.width) * photoW) : 0;
      const finalW = photo ? Math.min(photoW, (photo.width / photo.height) * photoH) : 0;

      const textX = M + photoW + 6;
      const textW = CONTENT_W - photoW - 6;
      doc.setFontSize(10);
      const descLines = doc.splitTextToSize(s.description || '-', textW) as string[];
      const textH = 8 + descLines.length * 5 + (s.status === 'open' ? 40 : 54);
      const blockH = Math.max(photoH, textH) + 6;

      ensure(blockH);
      doc.setDrawColor(209, 213, 219);
      doc.line(M, y, PAGE_W - M, y);
      y += 4;

      if (photo) doc.addImage(photo.dataUrl, 'JPEG', M, y, finalW, photoH);
      else {
        doc.setFillColor(243, 244, 246);
        doc.rect(M, y, photoW, 30, 'F');
        doc.setFontSize(9);
        doc.text('No photo', M + 4, y + 16);
      }

      let ty = y + 4;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(`Snag ${i + 1}`, textX, ty);
      const closed = s.status === 'closed';
      const pending = s.status === 'pending_approval';
      if (closed) doc.setTextColor(21, 128, 61);
      else if (pending) doc.setTextColor(29, 78, 216);
      else doc.setTextColor(185, 28, 28);
      doc.text(closed ? 'CLOSED' : pending ? 'AWAITING APPROVAL' : 'OPEN', PAGE_W - M, ty, { align: 'right' });
      doc.setTextColor(17, 24, 39);
      ty += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(descLines, textX, ty);
      ty += descLines.length * 5 + 2;

      const meta: [string, string][] = [
        ['Location', s.location || '-'],
        ['Photo taken', fmtDateTime(s.taken_at)],
        ['GPS', fmtCoords(s.latitude, s.longitude, s.accuracy_m)],
      ];
      if (closed) {
        const how = closedSummary(s);
        meta.push(['Closed', `${fmtDateTime(s.closed_at)} by ${s.closed_by_name ?? '-'}${how ? ` - ${how}` : ''}`]);
      } else if (pending) {
        meta.push(['Fix sent', `${fmtDateTime(s.close_submitted_at)} by ${s.closed_by_name ?? '-'}`]);
      }
      if (closed || pending) {
        meta.push(['Fix GPS', fmtCoords(s.close_latitude, s.close_longitude, s.close_accuracy_m)]);
      }
      meta.forEach(([k, v]) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.text(k, textX, ty);
        doc.setFont('helvetica', 'normal');
        const vl = doc.splitTextToSize(v, textW - 22) as string[];
        doc.text(vl, textX + 22, ty);
        ty += 4.5 * vl.length;
      });
      if (s.latitude != null && s.longitude != null) {
        doc.setTextColor(37, 99, 235);
        doc.textWithLink('Open location in Google Maps', textX, ty + 1, { url: mapsLink(s.latitude, s.longitude) });
        doc.setTextColor(17, 24, 39);
      }

      y += blockH;
    }
  }

  ensure(14);
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Checklist', M, y);
  y += 4;

  const grid = liftGrid(items);
  const resultColor = (r: InspectionItem['result']): [number, number, number] =>
    r === 'pass' ? [21, 128, 61] : r === 'fail' ? [185, 28, 28] : [107, 114, 128];
  const sectionBar = (title: string, rowH: number) => {
    ensure(8 + rowH);
    doc.setFillColor(243, 244, 246);
    doc.rect(M, y, CONTENT_W, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(17, 24, 39);
    doc.text(title, M + 2, y + 4.6);
    y += 6.5;
  };

  if (grid.once.length > 0) {
    let lastSection = '';
    for (const it of grid.once) {
      doc.setFontSize(9.5);
      const lines = doc.splitTextToSize(it.text + (it.note ? ` (${it.note})` : ''), CONTENT_W - 30) as string[];
      const rowH = lines.length * 4.6 + 2.4;
      if (it.section !== lastSection) {
        sectionBar(`${it.section} (whole scaffold)`, rowH);
        lastSection = it.section;
      } else {
        ensure(rowH);
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(lines, M + 2, y + 4.4);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...resultColor(it.result));
      doc.text(resultLabel(it.result), PAGE_W - M - 2, y + 4.4, { align: 'right' });
      doc.setTextColor(17, 24, 39);
      y += rowH;
      doc.setDrawColor(229, 231, 235);
      doc.line(M, y, PAGE_W - M, y);
    }
    y += 4;
  }

  if (grid.rows.length > 0) {
    const colW = 16;
    const textW = CONTENT_W - colW * grid.lifts.length;
    const colX = (i: number) => M + textW + colW * i + colW / 2;
    const header = () => {
      ensure(14);
      doc.setFillColor(31, 41, 55);
      doc.rect(M, y, CONTENT_W, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      doc.text('Check', M + 2, y + 4.8);
      grid.lifts.forEach((l, i) => doc.text(shortLift(l), colX(i), y + 4.8, { align: 'center' }));
      doc.setTextColor(17, 24, 39);
      y += 7;
    };
    header();
    let lastSection = '';
    for (const row of grid.rows) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(row.text, textW - 4) as string[];
      const rowH = lines.length * 4.3 + 2.4;
      if (y + rowH + (row.section !== lastSection ? 6 : 0) > PAGE_H - M - 6) {
        doc.addPage();
        y = M;
        header();
        lastSection = '';
      }
      if (row.section !== lastSection) {
        doc.setFillColor(243, 244, 246);
        doc.rect(M, y, CONTENT_W, 5.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.text(row.section, M + 2, y + 3.9);
        y += 5.5;
        lastSection = row.section;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(lines, M + 2, y + 4.2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      grid.lifts.forEach((l, i) => {
        const cell = row.cells.get(l);
        if (!cell) return;
        doc.setTextColor(...resultColor(cell.result));
        doc.text(resultLabel(cell.result), colX(i), y + 4.2, { align: 'center' });
      });
      doc.setTextColor(17, 24, 39);
      y += rowH;
      doc.setDrawColor(229, 231, 235);
      doc.line(M, y, PAGE_W - M, y);
    }
  }

  if (inspection.notes) {
    ensure(20);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Notes', M, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const nl = doc.splitTextToSize(inspection.notes, CONTENT_W) as string[];
    ensure(nl.length * 5);
    doc.text(nl, M, y);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(
      'Photos are time and GPS stamped at the moment of capture by Scaffold Checklist.',
      M,
      PAGE_H - 7,
    );
    doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 7, { align: 'right' });
  }

  return doc.output('blob');
}

interface SnagListInput {
  snags: Snag[];
  /** Plot numbers of each snag's inspection, keyed by inspection id. */
  plotsByInspection: Map<string, string[]>;
  /** Inspector name of each snag's inspection, keyed by inspection id. */
  inspectorByInspection: Map<string, string>;
  settings: SiteSettings | null;
  /** e.g. "Open snags" - shown under the title. */
  title: string;
  onProgress?: (msg: string) => void;
}

export function snagListFileName(settings: SiteSettings | null, title: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return safeFileName(`${title}_${settings?.site_name || 'Site'}_${d}`) + '.pdf';
}

type PdfPhoto = { dataUrl: string; width: number; height: number } | null;

async function loadPdfPhoto(path: string | null): Promise<PdfPhoto> {
  if (!path) return null;
  try {
    return await photoForPdf(path);
  } catch {
    return null;
  }
}

/** Every snag passed in, grouped by plot, with its photo, comment and status. */
export async function buildSnagListPdf({
  snags,
  plotsByInspection,
  inspectorByInspection,
  settings,
  title,
  onProgress,
}: SnagListInput): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = M;
  const ensure = (h: number) => {
    if (y + h > PAGE_H - M - 6) {
      doc.addPage();
      y = M;
    }
  };

  const plotsOf = (s: Snag) => plotsByInspection.get(s.inspection_id) ?? [];
  const firstPlot = (s: Snag) =>
    Math.min(...plotsOf(s).map((p) => parseInt(p, 10)).filter((n) => !Number.isNaN(n)), Infinity);
  const sorted = [...snags].sort(
    (a, b) =>
      firstPlot(a) - firstPlot(b) ||
      a.scaffold_name.localeCompare(b.scaffold_name, undefined, { numeric: true }) ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const open = snags.filter((s) => s.status === 'open').length;
  const pending = snags.filter((s) => s.status === 'pending_approval').length;
  const closed = snags.filter((s) => s.status === 'closed').length;

  doc.setFillColor(31, 41, 55);
  doc.rect(0, 0, PAGE_W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Snag List', M, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(settings?.site_name || 'Site', M, 20);
  doc.text(title, PAGE_W - M, 12, { align: 'right' });
  doc.text(fmtDateTime(new Date().toISOString()), PAGE_W - M, 20, { align: 'right' });
  y = 36;

  doc.setTextColor(17, 24, 39);
  doc.setFontSize(10);
  const summary = [
    `${snags.length} snag${snags.length === 1 ? '' : 's'}`,
    open && `${open} open`,
    pending && `${pending} awaiting approval`,
    closed && `${closed} closed`,
  ]
    .filter(Boolean)
    .join('  |  ');
  doc.text(summary, M, y);
  y += 8;

  let lastGroup = '';
  let n = 0;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    onProgress?.(`Adding snag ${i + 1} of ${sorted.length}...`);
    const plots = plotsOf(s);
    const plotLabel = plots.length ? plotsLabel(plots) : s.scaffold_name;
    const group = `${plotLabel}|${s.scaffold_name}`;

    const showFix = s.status !== 'open' && !!s.close_photo_path;
    const [photo, fix] = await Promise.all([loadPdfPhoto(s.photo_path), showFix ? loadPdfPhoto(s.close_photo_path) : null]);

    // Photos sit side by side (before / after) under the text, scaled to fit a box.
    const innerW = CONTENT_W - 5;
    const boxW = showFix ? (innerW - 6) / 2 : innerW * 0.6;
    const boxH = 56;
    const fit = (p: PdfPhoto) => {
      if (!p) return { w: boxW, h: 30 };
      const scale = Math.min(boxW / p.width, boxH / p.height);
      return { w: p.width * scale, h: p.height * scale };
    };
    const pSize = fit(photo);
    const fSize = showFix ? fit(fix) : { w: 0, h: 0 };
    const photosH = Math.max(pSize.h, fSize.h) + (showFix ? 5 : 0);

    doc.setFontSize(11);
    const descLines = doc.splitTextToSize(s.description || '-', innerW) as string[];
    const hasGps = s.latitude != null && s.longitude != null;
    const meta: [string, string][] = [
      ['Location', s.location || '-'],
      ['Logged', `${fmtDateTime(s.taken_at ?? s.created_at)}${inspectorByInspection.get(s.inspection_id) ? ` by ${inspectorByInspection.get(s.inspection_id)}` : ''}`],
    ];
    if (s.status === 'closed') {
      const how = closedSummary(s);
      meta.push(['Closed', `${fmtDateTime(s.closed_at)} by ${s.closed_by_name ?? '-'}${how ? ` - ${how}` : ''}`]);
    } else if (s.status === 'pending_approval') {
      meta.push(['Fix sent', `${fmtDateTime(s.close_submitted_at)} by ${s.closed_by_name ?? '-'}`]);
    } else {
      meta.push(['Due', fmtDateTime(s.due_at)]);
    }
    if (s.close_note) meta.push(['Fix note', s.close_note]);
    doc.setFontSize(9);
    const metaLines = meta.map(([k, v]) => [k, doc.splitTextToSize(v, innerW - 20) as string[]] as const);
    const metaH = metaLines.reduce((h, [, v]) => h + v.length * 4.4, 0) + (hasGps ? 4.4 : 0);
    const blockH = 9 + descLines.length * 5.2 + 2 + metaH + 3 + photosH + 8;

    if (group !== lastGroup) {
      ensure(12 + blockH);
      doc.setFillColor(31, 41, 55);
      doc.roundedRect(M, y, CONTENT_W, 9, 1.5, 1.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(plotLabel, M + 3, y + 6.2);
      // Show the scaffold name too when it says more than the plot numbers, e.g. "Apartments 135-143".
      if (plots.length && /[a-z]/i.test(s.scaffold_name)) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(s.scaffold_name, PAGE_W - M - 3, y + 6.2, { align: 'right' });
      }
      doc.setTextColor(17, 24, 39);
      y += 13;
      lastGroup = group;
      n = 0;
    } else {
      ensure(blockH);
    }
    n++;

    const top = y;
    // Status colour strip down the left edge of each snag.
    const status: [string, [number, number, number]] =
      s.status === 'closed'
        ? ['CLOSED', [21, 128, 61]]
        : s.status === 'pending_approval'
          ? ['AWAITING APPROVAL', [29, 78, 216]]
          : isSnagOverdue(s)
            ? ['OVERDUE', [185, 28, 28]]
            : ['OPEN', [217, 119, 6]];
    doc.setFillColor(...status[1]);
    doc.rect(M, top, 1.5, blockH - 6, 'F');

    const x = M + 5;
    y += 4.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${plotLabel} - Snag ${n}`, x, y);
    doc.setFontSize(10);
    doc.setTextColor(...status[1]);
    doc.text(status[0], PAGE_W - M, y, { align: 'right' });
    const statusW = doc.getTextWidth(status[0]);
    doc.setTextColor(107, 114, 128);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(snagRef(s), PAGE_W - M - statusW - 4, y, { align: 'right' });
    doc.setTextColor(17, 24, 39);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(descLines, x, y);
    y += descLines.length * 5.2 + 1;

    doc.setFontSize(9);
    for (const [k, v] of metaLines) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(75, 85, 99);
      doc.text(k, x, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(17, 24, 39);
      doc.text(v, x + 20, y);
      y += v.length * 4.4;
    }
    if (hasGps) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(75, 85, 99);
      doc.text('Map', x, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(37, 99, 235);
      doc.textWithLink('Open in Google Maps', x + 20, y, { url: mapsLink(s.latitude!, s.longitude!) });
      doc.setTextColor(17, 24, 39);
      y += 4.4;
    }
    y += 1;

    const drawPhoto = (p: PdfPhoto, size: { w: number; h: number }, px: number, caption: string | null) => {
      if (p) doc.addImage(p.dataUrl, 'JPEG', px, y, size.w, size.h);
      else {
        doc.setFillColor(243, 244, 246);
        doc.rect(px, y, size.w, size.h, 'F');
        doc.setFontSize(9);
        doc.setTextColor(107, 114, 128);
        doc.text('No photo', px + size.w / 2, y + size.h / 2 + 1, { align: 'center' });
        doc.setTextColor(17, 24, 39);
      }
      if (caption) {
        doc.setFontSize(8);
        doc.setTextColor(107, 114, 128);
        doc.text(caption, px, y + size.h + 3.5);
        doc.setTextColor(17, 24, 39);
      }
    };
    drawPhoto(photo, pSize, x, showFix ? 'Snag' : null);
    if (showFix) drawPhoto(fix, fSize, x + boxW + 6, 'Fix');

    y = top + blockH - 3;
    doc.setDrawColor(229, 231, 235);
    doc.line(M, y, PAGE_W - M, y);
    y += 4;
  }

  if (sorted.length === 0) {
    doc.setFontSize(11);
    doc.text('No snags.', M, y);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(`${settings?.site_name || 'Site'} - ${title}`, M, PAGE_H - 7);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 7, { align: 'right' });
  }

  return doc.output('blob');
}
