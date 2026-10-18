import { useEffect, useRef, useState } from 'react';
import { signedUrl } from '../lib/photo';

/**
 * Full-screen camera that only takes a photo from the live video feed, so nothing can be picked from the gallery.
 * Optionally shows the original snag photo faded over the view to line up the same shot.
 */
export default function LiveCamera({
  ghostPath,
  onCapture,
  onCancel,
  onUnavailable,
}: {
  ghostPath?: string | null;
  onCapture: (photo: Blob) => void;
  onCancel: () => void;
  onUnavailable: (reason: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [ghostUrl, setGhostUrl] = useState<string | null>(null);
  const [showGhost, setShowGhost] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
          setReady(true);
        }
      } catch (e) {
        if (alive) onUnavailable(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission is off.' : 'Camera could not start.');
      }
    })();
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onUnavailable]);

  useEffect(() => {
    if (!ghostPath) return;
    signedUrl(ghostPath)
      .then(setGhostUrl)
      .catch(() => setGhostUrl(null));
  }, [ghostPath]);

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onCapture(b), 'image/jpeg', 0.92);
  }

  return (
    <div className="live-camera">
      <video ref={videoRef} playsInline muted />
      {ghostUrl && showGhost && <img className="live-ghost" src={ghostUrl} alt="" />}
      {!ready && <div className="live-hint">Starting camera... allow camera access if asked.</div>}
      <div className="live-top">
        {ghostUrl && (
          <button type="button" className="btn btn-ghost btn-sm live-btn" onClick={() => setShowGhost((s) => !s)}>
            {showGhost ? 'Hide snag photo' : 'Line up with snag photo'}
          </button>
        )}
      </div>
      <div className="live-bottom">
        <button type="button" className="btn btn-ghost live-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="shutter" onClick={capture} disabled={!ready} aria-label="Take photo" />
        <span className="live-spacer" />
      </div>
    </div>
  );
}
