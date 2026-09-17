/**
 * 자산 해석 — assetId 하나로 로컬과 원격을 모두 가린다.
 *
 * 순서: IndexedDB(내가 만든 것) → Firebase Storage(남의 작품).
 * `remotePath`가 있으면 원격, 없으면 로컬. KeyDef는 경로를 절대 모른다.
 */

import { getDownloadURL, ref } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { t } from '../i18n';
import type { AssetRef, Work } from '../work-model/types';
import { getAssetBlob, localKeyOf } from './db';
import { functions, isFirebaseConfigured, storage } from './firebase';

/** 현재 화면이 다루는 작품의 자산 목록. 엔진의 resolver가 이걸 참조한다. */
let registry = new Map<string, { ref: AssetRef; workId: string }>();

export function registerAssets(work: Work): void {
  const next = new Map<string, { ref: AssetRef; workId: string }>();
  for (const a of work.assets) next.set(a.id, { ref: a, workId: work.id });
  registry = next;
}

export function lookupAsset(assetId: string): { ref: AssetRef; workId: string } | undefined {
  return registry.get(assetId);
}

const urlCache = new Map<string, string>();

async function remoteUrl(path: string): Promise<string> {
  const cached = urlCache.get(path);
  if (cached) return cached;
  if (!isFirebaseConfigured) throw new Error(t('asset.remoteUnavailable', { path }));
  const url = await getDownloadURL(ref(storage(), path));
  urlCache.set(path, url);
  return url;
}

function isGroupPath(path: string): boolean {
  return path.startsWith('groupWorks/');
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

async function groupBlob(workId: string, assetId: string, kind: AssetRef['kind'] | 'thumb'): Promise<Blob> {
  if (!isFirebaseConfigured) throw new Error(t('asset.remoteUnavailable', { path: `groupWorks/${workId}` }));
  const callable = httpsCallable(functions(), 'fetchGroupWorkFile');
  const response = await callable({ workId, assetId, kind });
  const data = response.data as { data?: unknown; mimeType?: unknown };
  if (typeof data.data !== 'string' || typeof data.mimeType !== 'string') {
    throw new Error(t('asset.fetchFailed', { id: assetId }));
  }
  return base64ToBlob(data.data, data.mimeType);
}

async function blobOf(entry: { ref: AssetRef; workId: string }): Promise<Blob> {
  const local = await getAssetBlob(entry.ref.localKey ?? localKeyOf(entry.workId, entry.ref.id));
  if (local) return local;
  if (!entry.ref.remotePath) throw new Error(t('asset.notFound', { id: entry.ref.id }));
  if (isGroupPath(entry.ref.remotePath)) return groupBlob(entry.workId, entry.ref.id, entry.ref.kind);
  const res = await fetch(await remoteUrl(entry.ref.remotePath));
  if (!res.ok) throw new Error(t('asset.fetchFailed', { id: entry.ref.id }));
  return res.blob();
}

/** 오디오 엔진용. assetId → ArrayBuffer. */
export async function resolveAsset(assetId: string): Promise<ArrayBuffer> {
  const entry = lookupAsset(assetId);
  if (!entry) throw new Error(t('asset.unknown', { id: assetId }));
  return (await blobOf(entry)).arrayBuffer();
}

const objectUrls = new Map<string, string>();

/** <img src>용. */
export async function resolveImageUrl(assetId: string): Promise<string> {
  const existing = objectUrls.get(assetId);
  if (existing) return existing;
  const entry = lookupAsset(assetId);
  if (!entry) throw new Error(t('asset.unknown', { id: assetId }));

  const local = await getAssetBlob(entry.ref.localKey ?? localKeyOf(entry.workId, entry.ref.id));
  if (local) {
    const url = URL.createObjectURL(local);
    objectUrls.set(assetId, url);
    return url;
  }
  if (!entry.ref.remotePath) throw new Error(t('asset.artNotFound', { id: assetId }));
  if (isGroupPath(entry.ref.remotePath)) {
    const url = URL.createObjectURL(await groupBlob(entry.workId, entry.ref.id, entry.ref.kind));
    objectUrls.set(assetId, url);
    return url;
  }
  return remoteUrl(entry.ref.remotePath);
}

/** 그룹 스테이지 카드의 전용 썸네일. 공개 `/thumb` 경로를 쓰면 비멤버에게 파일이
 * 노출되므로 동일한 멤버십 검사를 통과한 Blob URL만 사용한다. */
export async function resolveGroupThumbUrl(workId: string): Promise<string> {
  const cacheKey = `thumb:${workId}`;
  const existing = objectUrls.get(cacheKey);
  if (existing) return existing;
  const url = URL.createObjectURL(await groupBlob(workId, '', 'thumb'));
  objectUrls.set(cacheKey, url);
  return url;
}

/**
 * 같은 자산 자리에 새로 그렸을 때 호출.
 * objectURL은 id를 키로 캐시되므로, 지우지 않으면 예전 그림이 계속 보인다.
 */
export function invalidateAsset(assetId: string): void {
  const url = objectUrls.get(assetId);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(assetId);
  }
}

export function revokeImageUrls(): void {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}
