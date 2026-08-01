import { useEffect, useState } from 'react';

export function WorkThumbnail({ blob, className = 'work-thumb' }: { blob?: Blob; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    if (!blob) return;
    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [blob]);

  return url ? <img src={url} alt="" className={className} /> : <div className={className} aria-hidden="true" />;
}
