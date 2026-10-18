import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isFreshPhoto,
  locateForPhoto,
  MAX_PHOTO_AGE_MINUTES,
  stampPhoto,
  type GeoFix,
  type LocationSource,
  type StampInfo,
} from '../lib/photo';
import { fmtCoords } from '../lib/format';
import LiveCamera from './LiveCamera';

export interface CapturedPhoto {
  blob: Blob;
  fix: GeoFix | null;
  source: LocationSource;
  takenAt: Date;
}

const canLiveCapture = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export default function CameraField({
  stamp,
  value,
  onChange,
  allowNoGps = false,
  ghostPath,
  label = '📷 Take photo',
}: {
  stamp: StampInfo;
  value: CapturedPhoto | null;
  onChange: (p: CapturedPhoto | null) => void;
  /** Plan B: still take the photo with no location (it will be stamped NO GPS). */
  allowNoGps?: boolean;
  /** Original snag photo to line up with in the live camera. */
  ghostPath?: string | null;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [liveFailed, setLiveFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return setPreview(null);
    const url = URL.createObjectURL(value.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  async function process(photo: Blob) {
    setError(null);
    setBusy(true);
    try {
      const { fix, source } = await locateForPhoto();
      if (!fix && !allowNoGps) {
        throw new Error('Could not get a GPS fix. Step outside / wait a moment and try again.');
      }
      const takenAt = new Date();
      const blob = await stampPhoto(photo, fix, stamp, takenAt, source);
      onChange({ blob, fix, source, takenAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process photo');
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    if (!isFreshPhoto(file)) {
      setError(`That photo is older than ${MAX_PHOTO_AGE_MINUTES} minutes. Take a new photo with the camera.`);
      return;
    }
    await process(file);
  }

  function open() {
    setError(null);
    if (canLiveCapture() && !liveFailed) setLive(true);
    else inputRef.current?.click();
  }

  const onUnavailable = useCallback((reason: string) => {
    setLive(false);
    setLiveFailed(reason);
  }, []);

  return (
    <div className="camera-field">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {live && (
        <LiveCamera
          ghostPath={ghostPath}
          onCancel={() => setLive(false)}
          onUnavailable={onUnavailable}
          onCapture={(b) => {
            setLive(false);
            void process(b);
          }}
        />
      )}
      {preview ? (
        <div className="camera-preview">
          <img src={preview} alt="Captured" />
          <div className={`small ${value!.fix ? 'muted' : 'warn-text'}`}>
            {value!.fix
              ? `GPS ${fmtCoords(value!.fix.latitude, value!.fix.longitude, value!.fix.accuracy)}${value!.source === 'last_known' ? ' (last fix)' : ''}`
              : 'No GPS - this photo will need site manager approval'}
          </div>
          <button type="button" className="btn btn-secondary" onClick={open} disabled={busy}>
            Retake photo
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-camera" onClick={open} disabled={busy}>
          {busy ? 'Getting GPS & stamping photo...' : label}
        </button>
      )}
      {liveFailed && !preview && (
        <div className="small muted">{liveFailed} Using the phone camera instead.</div>
      )}
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}
