import type { AssetRef, Work } from '../work-model/types';

function portableAsset(asset: AssetRef): AssetRef {
  const portable: AssetRef = {
    id: asset.id,
    kind: asset.kind,
    mimeType: asset.mimeType,
    size: asset.size,
    hash: asset.hash,
  };
  if (asset.durationMs !== undefined) portable.durationMs = asset.durationMs;
  if (asset.remotePath !== undefined) portable.remotePath = asset.remotePath;
  return portable;
}

/** 기기 전용 IndexedDB 키와 undefined 필드를 공개 문서에서 제거한다. */
export function toPortableWork(work: Work): Work {
  return { ...work, assets: work.assets.map(portableAsset) };
}
