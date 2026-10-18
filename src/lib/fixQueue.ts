import { supabase } from './supabase';
import { uploadPhoto, type LocationSource } from './photo';
import { sendNotification } from './notify';
import type { Snag } from './types';

/** A fix photo taken on site, waiting to be sent (straight away, or later when there is signal). */
export interface FixJob {
  id: string;
  snagId: string;
  inspectionId: string;
  scaffoldName: string;
  photo: Blob;
  context: Blob | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  source: LocationSource;
  takenAt: string;
  note: string;
  queuedAt: string;
  lastError?: string;
}

export const FIX_QUEUE_EVENT = 'sc-fix-queue';

const DB_NAME = 'scaffold-checklist';
const STORE = 'fix-queue';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const listQueuedFixes = () => tx<FixJob[]>('readonly', (s) => s.getAll() as IDBRequest<FixJob[]>);
const putJob = (job: FixJob) => tx('readwrite', (s) => s.put(job));
const deleteJob = (id: string) => tx('readwrite', (s) => s.delete(id));

function changed() {
  window.dispatchEvent(new Event(FIX_QUEUE_EVENT));
}

export async function queueFix(job: FixJob): Promise<void> {
  await putJob(job);
  changed();
}

/** No signal / dropped connection, as opposed to the server refusing the fix. */
export function isNetworkError(e: unknown): boolean {
  if (!navigator.onLine) return true;
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
  return /fetch|network|load failed|timeout/i.test(msg);
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String((e as { message?: string })?.message ?? 'Could not send fix');
}

/** Uploads the photos, then the server checks GPS/time and either closes the snag or sends it for approval. */
export async function submitFix(job: FixJob): Promise<Snag> {
  const photoPath = await uploadPhoto(job.inspectionId, job.photo);
  const contextPath = job.context ? await uploadPhoto(job.inspectionId, job.context) : null;
  const { data, error } = await supabase.rpc('submit_snag_fix', {
    p_snag_id: job.snagId,
    p_photo_path: photoPath,
    p_context_photo_path: contextPath,
    p_latitude: job.latitude,
    p_longitude: job.longitude,
    p_accuracy_m: job.accuracy,
    p_location_source: job.source,
    p_taken_at: job.takenAt,
    p_note: job.note,
  });
  if (error) throw error;
  void sendNotification('fix_submitted', { snag_id: job.snagId });
  return data as Snag;
}

let running: Promise<{ sent: number; failed: number }> | null = null;

/**
 * Sends queued fixes. Jobs the server refused keep the reason and are only retried when asked,
 * so they don't re-upload photos on every pass.
 */
export function processFixQueue(retryRefused = false): Promise<{ sent: number; failed: number }> {
  if (running) return running;
  running = (async () => {
    let sent = 0;
    let failed = 0;
    if (!navigator.onLine) return { sent, failed };
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return { sent, failed };
    for (const job of await listQueuedFixes()) {
      if (job.lastError && !retryRefused) continue;
      try {
        await submitFix(job);
        await deleteJob(job.id);
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break;
        await putJob({ ...job, lastError: errorMessage(e) });
        failed++;
      }
    }
    if (sent || failed) changed();
    return { sent, failed };
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function discardQueuedFix(id: string): Promise<void> {
  await deleteJob(id);
  changed();
}
