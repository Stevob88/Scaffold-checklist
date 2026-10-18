import { PHOTO_BUCKET, supabase } from './supabase';
import { fmtCoords, fmtStamp } from './format';

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export type LocationSource = 'gps' | 'last_known' | 'none';

const LAST_FIX_KEY = 'sc-last-fix';
/** A fix this recent (e.g. from the walk onto the plot) is trusted when a new one won't come. */
export const LAST_FIX_MAX_AGE_MS = 5 * 60_000;

function toFix(pos: GeolocationPosition): GeoFix {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    timestamp: pos.timestamp,
  };
}

function rememberFix(fix: GeoFix) {
  const prev = lastKnownFix();
  if (prev && prev.timestamp > fix.timestamp - 30_000 && prev.accuracy < fix.accuracy) return;
  localStorage.setItem(LAST_FIX_KEY, JSON.stringify(fix));
}

export function lastKnownFix(maxAgeMs = LAST_FIX_MAX_AGE_MS): GeoFix | null {
  try {
    const fix = JSON.parse(localStorage.getItem(LAST_FIX_KEY) ?? 'null') as GeoFix | null;
    return fix && Date.now() - fix.timestamp <= maxAgeMs ? fix : null;
  } catch {
    return null;
  }
}

/** Keeps GPS running while a photo screen is open so a fix is ready when the shutter is pressed. */
export function watchGps(onFix: (fix: GeoFix) => void, onError?: (message: string) => void): () => void {
  if (!('geolocation' in navigator)) {
    onError?.('This device does not support location.');
    return () => undefined;
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const fix = toFix(pos);
      rememberFix(fix);
      onFix(fix);
    },
    (err) =>
      onError?.(
        err.code === err.PERMISSION_DENIED
          ? 'Location permission is off. Turn on Location for this app/browser.'
          : 'Still searching for GPS...',
      ),
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export function getPosition(maxAgeMs = 10_000, timeoutMs = 20_000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This device does not support location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix = toFix(pos);
        rememberFix(fix);
        resolve(fix);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('Location permission is off. Turn on Location for this app/browser to take snag photos.'));
        } else if (err.code === err.TIMEOUT) {
          reject(new Error('Could not get a GPS fix in time. Step outside / wait a moment and try again.'));
        } else {
          reject(new Error('Location unavailable. Check Location Services are on.'));
        }
      },
      { enableHighAccuracy: true, maximumAge: maxAgeMs, timeout: timeoutMs },
    );
  });
}

/**
 * Plan A: fresh GPS fix. Plan B: a fix from the last few minutes on this phone.
 * Otherwise no location, and the photo is stamped "NO GPS" so it needs approval.
 * Turning location permission off is not a way round it: that is an error.
 */
export async function locateForPhoto(timeoutMs = 15_000): Promise<{ fix: GeoFix | null; source: LocationSource }> {
  try {
    return { fix: await getPosition(10_000, timeoutMs), source: 'gps' };
  } catch (e) {
    if (e instanceof Error && /permission/i.test(e.message)) throw e;
    const last = lastKnownFix();
    return last ? { fix: last, source: 'last_known' } : { fix: null, source: 'none' };
  }
}

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

export const fmtDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** Photos must have just been taken with the camera, not picked from an old camera roll. */
export const MAX_PHOTO_AGE_MINUTES = 5;

export function isFreshPhoto(file: File): boolean {
  if (!file.lastModified) return true;
  return Date.now() - file.lastModified < MAX_PHOTO_AGE_MINUTES * 60_000;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo.'));
    };
    img.src = url;
  });
}

export interface StampInfo {
  title: string;
  subtitle?: string;
  inspector: string;
  /** Short reference burned into the photo, e.g. the snag it belongs to. */
  code?: string;
}

const MAX_SIDE = 1600;

function gpsLine(fix: GeoFix | null, source: LocationSource): string {
  if (!fix) return 'GPS: NO SIGNAL - needs site manager approval';
  const base = `GPS ${fmtCoords(fix.latitude, fix.longitude, fix.accuracy)}`;
  if (source !== 'last_known') return base;
  const mins = Math.max(1, Math.round((Date.now() - fix.timestamp) / 60_000));
  return `${base} (last fix ${mins} min ago)`;
}

/** Resizes, compresses and burns time + GPS + plot details into the image. */
export async function stampPhoto(
  file: Blob,
  fix: GeoFix | null,
  info: StampInfo,
  takenAt = new Date(),
  source: LocationSource = 'gps',
): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process photo.');
  ctx.drawImage(img, 0, 0, w, h);

  const lines = [
    info.subtitle ? `${info.title} - ${info.subtitle}` : info.title,
    `${fmtStamp(takenAt)}${info.code ? `  ·  Ref ${info.code}` : ''}`,
    gpsLine(fix, source),
    `By ${info.inspector}`,
  ];
  const font = Math.max(14, Math.round(Math.min(w, h) / 32));
  const pad = Math.round(font * 0.6);
  const lineH = Math.round(font * 1.3);
  const band = lines.length * lineH + pad * 2;

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${font}px -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, pad, h - band + pad + i * lineH, w - pad * 2));

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save photo.'))), 'image/jpeg', 0.72),
  );
}

export async function uploadPhoto(folder: string, blob: Blob): Promise<string> {
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return path;
}

const urlCache = new Map<string, { url: string; expires: number }>();

export async function signedUrl(path: string): Promise<string> {
  const cached = urlCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) throw new Error(error?.message ?? 'Could not load photo');
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}

export async function downloadPhoto(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? 'Could not download photo');
  return data;
}

export async function photoForPdf(path: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const blob = await downloadPhoto(path);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Could not read photo'));
    r.readAsDataURL(blob);
  });
  const img = await loadImage(blob);
  return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}

export async function removePhotos(paths: string[]): Promise<void> {
  const list = paths.filter(Boolean);
  for (let i = 0; i < list.length; i += 100) {
    await supabase.storage.from(PHOTO_BUCKET).remove(list.slice(i, i + 100));
  }
}
