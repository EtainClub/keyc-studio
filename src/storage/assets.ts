/**
 * 자산 해석 — assetId 하나로 로컬과 원격을 모두 가린다.
 *
 * 순서: IndexedDB(내가 만든 것) → Firebase Storage(남의 작품).
 * `remotePath`가 있으면 원격, 없으면 로컬. KeyDef는 경로를 절대 모른다.
 */

import { getDownloadURL, ref } from 'firebase/storage';
import type { AssetRef, Work } from '../work-model/types';
import { getAssetBlob, localKeyOf } from './db';
import { isFirebaseConfigured, storage } from './firebase';

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
  if (!isFirebaseConfigured) throw new Error(`원격 자산을 가져올 수 없어요: ${path}`);
  const url = await getDownloadURL(ref(storage(), path));
  urlCache.set(path, url);
  return url;
}

async function blobOf(entry: { ref: AssetRef; workId: string }): Promise<Blob> {
  const local = await getAssetBlob(entry.ref.localKey ?? localKeyOf(entry.workId, entry.ref.id));
  if (local) return local;
  if (!entry.ref.remotePath) throw new Error(`자산을 찾을 수 없어요: ${entry.ref.id}`);
  const res = await fetch(await remoteUrl(entry.ref.remotePath));
  if (!res.ok) throw new Error(`자산을 가져오지 못했어요: ${entry.ref.id}`);
  return res.blob();
}

/** 오디오 엔진용. assetId → ArrayBuffer. */
export async function resolveAsset(assetId: string): Promise<ArrayBuffer> {
  const entry = lookupAsset(assetId);
  if (!entry) throw new Error(`알 수 없는 자산: ${assetId}`);
  return (await blobOf(entry)).arrayBuffer();
}

const objectUrls = new Map<string, string>();

/** <img src>용. */
export async function resolveImageUrl(assetId: string): Promise<string> {
  const existing = objectUrls.get(assetId);
  if (existing) return existing;
  const entry = lookupAsset(assetId);
  if (!entry) throw new Error(`알 수 없는 자산: ${assetId}`);

  const local = await getAssetBlob(entry.ref.localKey ?? localKeyOf(entry.workId, entry.ref.id));
  if (local) {
    const url = URL.createObjectURL(local);
    objectUrls.set(assetId, url);
    return url;
  }
  if (!entry.ref.remotePath) throw new Error(`그림을 찾을 수 없어요: ${assetId}`);
  return remoteUrl(entry.ref.remotePath);
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
