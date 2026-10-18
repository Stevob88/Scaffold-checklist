import JSZip from 'jszip';
import { PHOTO_BUCKET, supabase } from './supabase';
import type { Inspection, InspectionItem, SiteSettings, Snag } from './types';
import { buildInspectionPdf, reportFileName } from './pdf';
import { downloadPhoto, removePhotos } from './photo';

export interface ArchiveCounts {
  inspections: number;
  snags: number;
  openSnags: number;
}

export async function getArchiveCounts(): Promise<ArchiveCounts> {
  const [i, s, o] = await Promise.all([
    supabase.from('inspections').select('id', { count: 'exact', head: true }),
    supabase.from('snags').select('id', { count: 'exact', head: true }),
    supabase.from('snags').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);
  return { inspections: i.count ?? 0, snags: s.count ?? 0, openSnags: o.count ?? 0 };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function buildArchive(
  settings: SiteSettings | null,
  onProgress: (msg: string) => void,
): Promise<Blob> {
  onProgress('Loading data...');
  const [ins, its, sns] = await Promise.all([
    supabase.from('inspections').select('*').order('started_at'),
    supabase.from('inspection_items').select('*'),
    supabase.from('snags').select('*').order('created_at'),
  ]);
  if (ins.error) throw ins.error;
  if (its.error) throw its.error;
  if (sns.error) throw sns.error;
  const inspections = ins.data as Inspection[];
  const items = its.data as InspectionItem[];
  const snags = sns.data as Snag[];

  const zip = new JSZip();
  zip.file('data/inspections.json', JSON.stringify(inspections, null, 2));
  zip.file('data/inspection_items.json', JSON.stringify(items, null, 2));
  zip.file('data/snags.json', JSON.stringify(snags, null, 2));

  const header = [
    'scaffold', 'inspection_date', 'inspector', 'location', 'description', 'status',
    'photo_taken', 'latitude', 'longitude', 'accuracy_m', 'due', 'closed_at', 'closed_by', 'close_note',
  ];
  const insById = new Map(inspections.map((x) => [x.id, x]));
  const rows = snags.map((s) => {
    const i = insById.get(s.inspection_id);
    return [
      s.scaffold_name, i?.completed_at ?? i?.started_at, i?.inspector_name, s.location, s.description, s.status,
      s.taken_at, s.latitude, s.longitude, s.accuracy_m, s.due_at, s.closed_at, s.closed_by_name, s.close_note,
    ].map(csvCell).join(',');
  });
  zip.file('snags.csv', [header.join(','), ...rows].join('\n'));

  for (let n = 0; n < inspections.length; n++) {
    const insp = inspections[n];
    onProgress(`Building report ${n + 1} of ${inspections.length}...`);
    const pdf = await buildInspectionPdf({
      inspection: insp,
      items: items.filter((x) => x.inspection_id === insp.id),
      snags: snags.filter((x) => x.inspection_id === insp.id),
      settings,
      issuedAt: new Date(insp.sent_at ?? insp.completed_at ?? insp.started_at),
    });
    zip.file(`reports/${reportFileName(insp).replace('.pdf', `_${insp.id.slice(0, 6)}.pdf`)}`, pdf);
  }

  const photoPaths = snags
    .flatMap((s) => [s.photo_path, s.close_photo_path, s.close_context_photo_path])
    .filter((p): p is string => !!p);
  for (let n = 0; n < photoPaths.length; n++) {
    onProgress(`Downloading photo ${n + 1} of ${photoPaths.length}...`);
    try {
      zip.file(`photos/${photoPaths[n]}`, await downloadPhoto(photoPaths[n]));
    } catch {
      // Missing photo files are skipped; the PDF still records the snag.
    }
  }

  onProgress('Compressing archive...');
  return zip.generateAsync({ type: 'blob' });
}

async function listAllPhotoPaths(): Promise<string[]> {
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  const paths: string[] = [];
  const { data: top, error } = await bucket.list('', { limit: 1000 });
  if (error) throw error;
  for (const entry of top ?? []) {
    if (entry.id) {
      paths.push(entry.name);
      continue;
    }
    const { data: files } = await bucket.list(entry.name, { limit: 1000 });
    for (const f of files ?? []) if (f.id) paths.push(`${entry.name}/${f.name}`);
  }
  return paths;
}

/** Deletes every inspection, ticked item, snag and photo. Scaffolds, checklist, users and settings are kept. */
export async function purgeAll(onProgress: (msg: string) => void): Promise<void> {
  onProgress('Deleting photos...');
  let paths = await listAllPhotoPaths();
  while (paths.length > 0) {
    await removePhotos(paths);
    const remaining = await listAllPhotoPaths();
    if (remaining.length >= paths.length) break;
    paths = remaining;
  }

  onProgress('Deleting inspections and snags...');
  const { error } = await supabase.from('inspections').delete().not('id', 'is', null);
  if (error) throw error;

  await supabase.from('site_settings').update({ last_purged_at: new Date().toISOString() }).eq('id', 1);
  onProgress('Done');
}
