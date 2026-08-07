/** Google 계정 전용 프로필과 비공개 작품 백업. 공개 공유 경로와 완전히 분리한다. */
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { parseWork } from '../work-model/serialize';
import type { AssetRef } from '../work-model/types';
import { toPortableWork } from './portable-work';
import {
  getAssetBlob,
  listWorkRecords,
  localKeyOf,
  putAssetBlob,
  putWorkRecord,
  type WorkRecord,
} from './db';
import { auth, firestore, isFirebaseConfigured, isPermanentUser, storage } from './firebase';
import {
  normalizeProfile,
  type CreatorProfile,
} from './identity';
import { backupAssetPath } from './paths';

type CloudRecord = WorkRecord;

function profileRef(uid: string) {
  return doc(firestore(), 'users', uid);
}

function workRef(uid: string, workId: string) {
  return doc(firestore(), 'users', uid, 'works', workId);
}

export async function loadCloudProfile(uid: string): Promise<CreatorProfile | null> {
  const snapshot = await getDoc(profileRef(uid));
  return snapshot.exists() ? normalizeProfile(snapshot.data()) : null;
}

export async function saveCloudProfile(uid: string, profile: CreatorProfile): Promise<void> {
  const normalized = normalizeProfile(profile);
  await setDoc(profileRef(uid), { ...normalized, updatedAt: Date.now() }, { merge: true });
}

function cloudRecordOf(value: unknown): CloudRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const work = parseWork(raw.work);
  if (!work || typeof raw.updatedAt !== 'number') return null;
  return { work, updatedAt: raw.updatedAt, published: raw.published === true };
}

async function sourceBlob(record: WorkRecord, asset: AssetRef): Promise<Blob | null> {
  const local = await getAssetBlob(asset.localKey ?? localKeyOf(record.work.id, asset.id));
  if (local) return local;
  if (!asset.remotePath) return null;
  const max = asset.kind === 'art' ? 200 * 1024 : 150 * 1024;
  const bytes = await getBytes(ref(storage(), asset.remotePath), max);
  return new Blob([bytes], { type: asset.mimeType });
}

export async function backupWorkRecord(record: WorkRecord, uid?: string): Promise<void> {
  if (!isFirebaseConfigured) return;
  const user = auth().currentUser;
  const ownerUid = uid ?? user?.uid;
  if (!ownerUid || !isPermanentUser(user) || user.uid !== ownerUid) return;

  const previous = await getDoc(workRef(ownerUid, record.work.id));
  const previousRecord = previous.exists() ? cloudRecordOf(previous.data()) : null;
  const previousHashes = new Map(previousRecord?.work.assets.map((asset) => [asset.id, asset.hash]));
  const assets: AssetRef[] = [];

  for (const asset of record.work.assets) {
    const remotePath = backupAssetPath(ownerUid, record.work.id, asset.kind, asset.id);
    if (previousHashes.get(asset.id) !== asset.hash) {
      const blob = await sourceBlob(record, asset);
      if (blob) {
        await uploadBytes(ref(storage(), remotePath), blob, {
          contentType: asset.mimeType,
          cacheControl: 'private, max-age=31536000, immutable',
          customMetadata: { hash: asset.hash },
        });
      }
    }
    assets.push({ ...asset, localKey: undefined, remotePath });
  }

  // IndexedDB 전용 localKey와 선택 필드의 undefined를 Firestore에 보내지 않는다.
  const work = toPortableWork({ ...record.work, authorUid: ownerUid, assets });
  await setDoc(workRef(ownerUid, work.id), {
    work,
    updatedAt: record.updatedAt,
    published: record.published,
  });
}

async function restoreWorkRecord(record: CloudRecord): Promise<void> {
  const assets: AssetRef[] = [];
  for (const asset of record.work.assets) {
    let localKey: string | undefined;
    if (asset.remotePath) {
      try {
        const max = asset.kind === 'art' ? 200 * 1024 : 150 * 1024;
        const bytes = await getBytes(ref(storage(), asset.remotePath), max);
        localKey = await putAssetBlob(
          record.work.id,
          asset.id,
          new Blob([bytes], { type: asset.mimeType }),
        );
      } catch (error) {
        console.warn('[account] 백업 자산을 내려받지 못했어요', asset.id, error);
      }
    }
    assets.push({ ...asset, localKey });
  }
  await putWorkRecord({ ...record, work: { ...record.work, assets } });
}

export type AccountSyncSummary = { uploaded: number; restored: number };

export async function syncAccountWorks(uid: string): Promise<AccountSyncSummary> {
  const [localRecords, cloudSnapshot] = await Promise.all([
    listWorkRecords(),
    getDocs(collection(firestore(), 'users', uid, 'works')),
  ]);
  const localById = new Map(localRecords.map((record) => [record.work.id, record]));
  const cloudById = new Map<string, CloudRecord>();
  for (const snapshot of cloudSnapshot.docs) {
    const record = cloudRecordOf(snapshot.data());
    if (record) cloudById.set(record.work.id, record);
  }

  let uploaded = 0;
  let restored = 0;
  for (const record of localRecords) {
    const cloud = cloudById.get(record.work.id);
    if (!cloud || record.updatedAt >= cloud.updatedAt) {
      await backupWorkRecord(record, uid);
      uploaded++;
    }
  }
  for (const record of cloudById.values()) {
    const local = localById.get(record.work.id);
    if (!local || record.updatedAt > local.updatedAt) {
      await restoreWorkRecord(record);
      restored++;
    }
  }
  return { uploaded, restored };
}

export async function renamePublishedCreator(records: WorkRecord[], name: string): Promise<void> {
  if (!isFirebaseConfigured) return;
  const user = auth().currentUser;
  if (!user) return;
  await Promise.allSettled(
    records
      .filter((record) => record.published)
      .map((record) => updateDoc(doc(firestore(), 'works', record.work.id), { authorNick: name })),
  );
}

const backupTimers = new Map<string, number>();

export function scheduleWorkBackup(record: WorkRecord): void {
  if (!isFirebaseConfigured) return;
  const user = auth().currentUser;
  if (!isPermanentUser(user)) return;
  const existing = backupTimers.get(record.work.id);
  if (existing !== undefined) clearTimeout(existing);
  const timer = window.setTimeout(() => {
    backupTimers.delete(record.work.id);
    void backupWorkRecord(record, user.uid).catch((error) =>
      console.warn('[account] 작품 백업에 실패했어요', record.work.id, error),
    );
  }, 1800);
  backupTimers.set(record.work.id, timer);
}

export async function deleteAccountBackup(record: WorkRecord): Promise<void> {
  if (!isFirebaseConfigured) return;
  const user = auth().currentUser;
  if (!isPermanentUser(user)) return;
  await deleteDoc(workRef(user.uid, record.work.id));
  await Promise.allSettled(
    record.work.assets.map((asset) =>
      deleteObject(ref(storage(), backupAssetPath(user.uid, record.work.id, asset.kind, asset.id))),
    ),
  );
}
