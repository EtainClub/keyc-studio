import { useEffect, useState } from 'react';
import { resolveImageUrl } from '../storage/assets';

/** assetId → 실제 표시 가능한 URL. 없으면 null. */
export function useAssetUrl(assetId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!assetId) {
      setUrl(null);
      return;
    }
    resolveImageUrl(assetId)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [assetId]);
  return url;
}

/** 화면이 다시 보일 때 오디오 컨텍스트를 되살린다. */
export function useResumeOnVisible(resume: () => void): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [resume]);
}
