import { useEffect, useState } from 'react';
import { signedUrl } from '../lib/photo';

export default function PhotoImg({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    signedUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path]);

  if (failed) return <div className={`photo-missing ${className ?? ''}`}>Photo unavailable</div>;
  if (!url) return <div className={`photo-loading ${className ?? ''}`} />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={alt} className={className} loading="lazy" />
    </a>
  );
}
