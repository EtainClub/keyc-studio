/**
 * 계정 프로필과 비공개 작품 백업. 공개 공유 경로와 완전히 분리한다.
 *
 * 예전에는 **Google 계정 전용**이었다. 지금은 복구 코드를 만든 익명 계정도 여기에
 * 들어온다(`canBackup` 참고) — 기기를 잃어도 작품이 남으려면 올라가 있어야 하고,
 * 토스 미니앱처럼 Google 로그인 팝업을 띄울 수 없는 자리가 있기 때문이다.
 */
import type { User } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore/lite';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { parseWork } from '../work-model/serialize';
import type { AssetRef } from '../work-model/types';
import { toPortableWork } from './portable-work';
import {
  deleteWorkRecord,
  getAssetBlob,
  getWorkRecord,
  listWorkRecords,
  localKeyOf,
  putAssetBlob,
  putWorkRecord,
  type WorkRecord,
} from './db';
import { auth, firestore, isFirebaseConfigured, isPermanentUser, storage } from './firebase';
import { isCloudBackupOptIn } from './recovery';
import {
  normalizeProfile,
  type CreatorProfile,
} from './identity';
import { backupAssetPath } from './paths';

type CloudRecord = WorkRecord;

/**
 * 이 사용자의 작품을 클라우드에 올려도 되는가.
 *
 * 두 경우다:
 *   · 비익명(Google) 계정 — 계정을 연결한 행위 자체가 백업하겠다는 뜻이다.
 *   · 복구 코드를 만든 익명 계정 — 코드를 발급받는 화면에서 백업을 함께 설명한다.
 *
 * **익명이면 무조건 올린다로 두면 안 된다.** 이 앱은 아이의 그림과 목소리를 다루고,
 * 공유하지 않은 작품은 이 기기 밖으로 나가지 않는다는 것이 기본 약속이다
 * (README "먼저, 정정 사항"). 백업은 사용자가 켜는 것이지 기본값이 아니다.
 */
function canBackup(user: User | null): user is User {
  if (!user) return false;
  return isPermanentUser(user) || isCloudBackupOptIn();
}

function profileRef(uid: string) {
  return doc(firestore(), 'users', uid);
}

function workRef(uid: string, workId: string) {
  return doc(firestore(), 'users', uid, 'works', workId);
}

/**
 * 지웠다는 사실을 남기는 자리. 내용은 시각 하나뿐이다.
 *
 * 백업 문서를 지우는 것만으로는 삭제가 지켜지지 않는다 — 삭제가 반쯤 실패하거나
 * 다른 기기가 아직 들고 있다가 도로 올리면, 동기화는 그것을 "클라우드에만 있는
 * 새 작품"으로 보고 되살린다. 무엇이 없는지로는 지운 것과 아직 안 올라온 것을
 * 구별할 수 없다. 그래서 있음으로 기록한다.
 */
function tombstoneRef(uid: string, workId: string) {
  return doc(firestore(), 'users', uid, 'deletedWorks', workId);
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
  if (!ownerUid || !canBackup(user) || user.uid !== ownerUid) return;

  const previous = await getDoc(workRef(ownerUid, record.work.id));
  const previousRecord = previous.exists() ? cloudRecordOf(previous.data()) : null;
  /** 지난 백업에서 **실제로 올라가 있는** 자산의 해시. 경로가 없는 것은 안 올라간 것이다. */
  const storedHashes = new Map(
    previousRecord?.work.assets
      .filter((asset) => asset.remotePath)
      .map((asset) => [asset.id, asset.hash]),
  );
  const assets: AssetRef[] = [];

  for (const asset of record.work.assets) {
    const remotePath = backupAssetPath(ownerUid, record.work.id, asset.kind, asset.id);
    let stored = storedHashes.get(asset.id) === asset.hash;

    if (!stored) {
      const blob = await sourceBlob(record, asset);
      if (blob) {
        await uploadBytes(ref(storage(), remotePath), blob, {
          contentType: asset.mimeType,
          cacheControl: 'private, max-age=31536000, immutable',
          customMetadata: { hash: asset.hash },
        });
        stored = true;
      }
    }

    /*
     * **올라간 것에만 경로를 적는다.**
     *
     * 예전에는 blob을 못 찾아 업로드를 건너뛰고도 remotePath를 적었다. 그러면
     * 클라우드 문서가 없는 파일을 가리키게 되고, 그 거짓말이 두 군데서 터진다:
     *   - 복원할 때 getBytes가 실패해 그림이 영영 사라진다
     *   - 지울 때 없는 파일을 지우려다 404가 뜬다
     * 경로가 없으면 "이 기기에만 있는 자산"이라는 사실 그대로가 되고,
     * 나중에 blob을 찾을 수 있게 되면 그때 올라간다.
     */
    assets.push({ ...asset, localKey: undefined, remotePath: stored ? remotePath : undefined });
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
    let remotePath = asset.remotePath;
    if (remotePath) {
      try {
        const max = asset.kind === 'art' ? 200 * 1024 : 150 * 1024;
        const bytes = await getBytes(ref(storage(), remotePath), max);
        localKey = await putAssetBlob(
          record.work.id,
          asset.id,
          new Blob([bytes], { type: asset.mimeType }),
        );
      } catch (error) {
        /*
         * 파일이 없다. 예전 백업이 올리지도 않은 자산에 경로를 적어 둔 흔적이다.
         * 그 거짓말을 로컬로 옮겨 적지 않는다 — 남겨 두면 이 기기에서도 계속
         * 없는 파일을 받으러 가고, 지울 때 404를 낸다.
         */
        console.warn('[account] 백업 자산을 내려받지 못했어요', asset.id, error);
        remotePath = undefined;
      }
    }
    assets.push({ ...asset, localKey, remotePath });
  }
  /*
   * 썸네일은 로컬 전용이라 클라우드 문서에 없다(WorkRecord.thumb 참고).
   * 그냥 덮어쓰면 이미 만들어 둔 썸네일이 날아가고 홈 목록이 빈 카드가 된다.
   * 있으면 지키고, 없으면 홈이 나중에 다시 만든다.
   */
  const existing = await getWorkRecord(record.work.id).catch(() => undefined);
  await putWorkRecord({
    ...record,
    work: { ...record.work, assets },
    thumb: existing?.thumb,
  });
}

export type AccountSyncSummary = { uploaded: number; restored: number };

export async function syncAccountWorks(uid: string): Promise<AccountSyncSummary> {
  const [localRecords, cloudSnapshot, tombstoneSnapshot] = await Promise.all([
    listWorkRecords(),
    getDocs(collection(firestore(), 'users', uid, 'works')),
    /*
     * 묘비 목록. 못 읽어도 동기화 전체를 죽이지 않는다 — deletedWorks 규칙이
     * 아직 배포되지 않았으면 거부되는데, 그걸로 백업·복원까지 멎으면 안 된다.
     */
    getDocs(collection(firestore(), 'users', uid, 'deletedWorks')).catch((error) => {
      console.warn('[account] 삭제 표시를 읽지 못했어요', error);
      return null;
    }),
  ]);
  const localById = new Map(localRecords.map((record) => [record.work.id, record]));
  const cloudById = new Map<string, CloudRecord>();
  for (const snapshot of cloudSnapshot.docs) {
    const record = cloudRecordOf(snapshot.data());
    if (record) cloudById.set(record.work.id, record);
  }
  const deleted = new Set(tombstoneSnapshot?.docs.map((snapshot) => snapshot.id) ?? []);

  /*
   * 지운 작품 먼저 치운다. 올리기·내려받기보다 앞서야 한다 —
   * 뒤에 두면 이번 판에서 한 번 되살아났다가 다음 판에 사라진다.
   *
   * 묘비는 기기 사이에도 퍼진다. 다른 기기에서 지웠으면 이 기기의 사본도 따라
   * 사라지는 게 맞다. 그게 "지웠다"의 뜻이다.
   */
  for (const workId of deleted) {
    if (localById.has(workId)) {
      await deleteWorkRecord(workId).catch(() => {});
      localById.delete(workId);
    }
    if (cloudById.has(workId)) {
      // 예전 코드가 남긴 고아 문서. 이게 있는 한 매번 되살아난다.
      await deleteDoc(workRef(uid, workId)).catch(() => {});
      cloudById.delete(workId);
    }
  }

  let uploaded = 0;
  let restored = 0;
  for (const record of localRecords) {
    if (deleted.has(record.work.id)) continue;
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
  if (!canBackup(user)) return;
  const existing = backupTimers.get(record.work.id);
  if (existing !== undefined) clearTimeout(existing);
  const timer = window.setTimeout(() => {
    backupTimers.delete(record.work.id);
    void (async () => {
      /*
       * 백업 직전에 **아직 로컬에 있는지** 다시 본다.
       *
       * 예약과 실행 사이에 1.8초가 있고, 그 사이에 아이가 작품을 지울 수 있다.
       * 그러면 이 타이머가 방금 지운 작품을 클라우드에 되살리고, 다음 동기화가
       * 그것을 로컬로 되돌린다 — 지웠는데 새로고침하면 다시 나타나는 증상이
       * 정확히 이 경로였다.
       *
       * 로그인 직후 hydratePermanentAccount가 모든 로컬 작품을 한꺼번에 예약하므로
       * 이 창은 생각보다 자주 열린다.
       */
      const still = await getWorkRecord(record.work.id).catch(() => undefined);
      if (!still) return;
      await backupWorkRecord(record, user.uid);
    })().catch((error) =>
      console.warn('[account] 작품 백업에 실패했어요', record.work.id, error),
    );
  }, 1800);
  backupTimers.set(record.work.id, timer);
}

/** 예약된 백업을 취소한다. 지우기처럼 백업이 무의미해진 순간에 부른다. */
export function cancelWorkBackup(workId: string): void {
  const timer = backupTimers.get(workId);
  if (timer !== undefined) {
    clearTimeout(timer);
    backupTimers.delete(workId);
  }
}

/**
 * 계정 백업에서 작품 하나를 지운다.
 *
 * 지울 파일 목록은 **클라우드 문서에서 읽는다.** 로컬 레코드로 경로를 되짚으면
 * 백업에 올라간 적 없는 자산까지 지우려 들어 404가 쏟아진다 — 그 요청들은
 * allSettled가 삼키지만 콘솔에는 그대로 남아, 멀쩡히 지워진 삭제가 실패한 것처럼
 * 보인다. 게다가 로컬 자산의 remotePath는 **공개 공유 경로**라 백업 경로와 다르다.
 *
 * 문서를 먼저 지운다. 파일 삭제가 실패해 고아 파일이 남는 편이, 문서가 남아
 * 다음 동기화 때 작품이 통째로 되살아나는 것보다 낫다.
 */
export async function deleteAccountBackup(record: WorkRecord): Promise<void> {
  if (!isFirebaseConfigured) return;
  const user = auth().currentUser;
  if (!canBackup(user)) return;

  const snapshot = await getDoc(workRef(user.uid, record.work.id));
  const cloud = snapshot.exists() ? cloudRecordOf(snapshot.data()) : null;
  const paths = (cloud?.work.assets ?? [])
    .map((asset) => asset.remotePath)
    .filter((path): path is string => Boolean(path));

  /*
   * 묘비가 **가장 먼저**다. 이 뒤의 어느 단계가 실패해도 동기화는 이 작품을
   * 되살리지 않는다. 순서를 뒤집으면 문서만 지워지고 묘비가 없는 창이 열리고,
   * 하필 그 사이에 다른 기기가 백업을 올리면 삭제가 통째로 무효가 된다.
   *
   * 다만 **최선 노력**이다. deletedWorks 규칙이 아직 배포되지 않은 앱에서는 이
   * 쓰기가 거부되는데, 그것 때문에 지우기 자체가 막히면 안 된다. 묘비가 없으면
   * 예전만큼만 동작하고(문서를 지우는 것으로 끝), 있으면 확실해진다.
   */
  await setDoc(tombstoneRef(user.uid, record.work.id), { deletedAt: Date.now() }).catch(
    (error) => console.warn('[account] 삭제 표시를 남기지 못했어요', record.work.id, error),
  );
  await deleteDoc(workRef(user.uid, record.work.id));
  await Promise.allSettled(paths.map((path) => deleteObject(ref(storage(), path))));
}
