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
  // 사진 유래 태그는 공개 문서에서도 지우지 않는다. 공유 자체는 앞단에서 막지만,
  // 어쩌다 새어나간 자산이 있다면 그 사실이 문서에 남아 있어야 찾아낼 수 있다.
  if (asset.source !== undefined) portable.source = asset.source;
  if (asset.remotePath !== undefined) portable.remotePath = asset.remotePath;
  return portable;
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map(withoutUndefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, withoutUndefined(item)]),
    );
  }
  return value;
}

/** 기기 전용 IndexedDB 키와 모든 중첩 undefined 필드를 원격 문서에서 제거한다. */
export function toPortableWork(work: Work): Work {
  return withoutUndefined({ ...work, assets: work.assets.map(portableAsset) }) as Work;
}
