/**
 * 로컬 저장소 (IndexedDB).
 *
 * 원칙: **로컬 우선.** 만들기 모드에서는 네트워크 전송이 한 번도 없고,
 * Firebase Auth도 호출하지 않는다. 아이는 여기서 시작해서 여기서 끝낼 수 있다.
 *
 * v2에서 바뀐 것: 자산 키가 Storage 경로가 아니라 **assetId**다.
 * 로컬에만 있는 자산도, 업로드된 자산도 같은 id로 참조된다.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AssetRef, Work } from '../work-model/types';

const DB_NAME = 'keycap-creator';
const DB_VERSION = 2;

export type WorkRecord = {
  work: Work;
  updatedAt: number;
  /** 원격에 올렸는가. 올렸으면 공유 링크가 산다. */
  published: boolean;
  /** 홈 목록에 보여줄 썸네일. 로컬에만 둔다. */
  thumb?: Blob;
};

type AssetRow = { key: string; blob: Blob; workId: string; assetId: string };

interface KeycapDB extends DBSchema {
  works: {
    key: string;
    value: WorkRecord;
    indexes: { updatedAt: number };
  };
  assets: {
    /** `${workId}/${assetId}` */
    key: string;
    value: AssetRow;
    indexes: { workId: string };
  };
}

let dbPromise: Promise<IDBPDatabase<KeycapDB>> | null = null;

/**
 * IndexedDB는 실패할 때 **에러를 던지지 않고 그냥 멈춘다**.
 * 다른 탭이 이전 버전을 붙들고 있거나, 브라우저 저장소가 꼬였거나,
 * 사생활 보호 모드이면 open이 영원히 pending으로 남는다.
 * 그 상태로 await하면 화면 전환까지 통째로 멎는다 — try/catch로는 못 잡는다.
 *
 * 그래서 열리지 않으면 시간을 재서 거절시킨다. 호출부는 전부 실패를 견디게 돼 있고,
 * 잃는 것은 "다음에 이어서 하기"뿐이다.
 */
const OPEN_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('저장소를 열지 못했어요 (시간 초과)')),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function db(): Promise<IDBPDatabase<KeycapDB>> {
  if (!dbPromise) {
    const opening = openDB<KeycapDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        // v1에서 올라온 경우 이전 스토어를 버린다.
        // 작품 자체는 serialize.migrateV1ToV2가 문서 단위로 올린다.
        if (oldVersion > 0) {
          for (const name of ['works', 'assets'] as const) {
            if (database.objectStoreNames.contains(name)) database.deleteObjectStore(name);
          }
        }
        const works = database.createObjectStore('works', { keyPath: 'work.id' });
        works.createIndex('updatedAt', 'updatedAt');
        const assets = database.createObjectStore('assets', { keyPath: 'key' });
        assets.createIndex('workId', 'workId');
      },
      /**
       * 다른 탭이 v1 연결을 붙들고 있으면 업그레이드가 영원히 멈춘다.
       * 그 탭에서 이 콜백이 불리므로, 여기서 연결을 놓아 준다.
       * 이게 없으면 "탭 두 개 열어둔 아이"에게 앱이 통째로 멎는다.
       */
      blocking() {
        console.warn('[db] 다른 탭의 업그레이드를 위해 연결을 닫습니다');
        const held = dbPromise;
        dbPromise = null;
        void held?.then((d) => d.close());
      },
      blocked() {
        console.warn('[db] 다른 탭이 이전 버전을 붙들고 있어 업그레이드를 기다립니다');
      },
    });
    dbPromise = withTimeout(opening, OPEN_TIMEOUT_MS).catch((e) => {
      // 다음 호출에서 다시 시도할 수 있게 캐시를 비운다.
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export function localKeyOf(workId: string, assetId: string): string {
  return `${workId}/${assetId}`;
}

export async function putWorkRecord(record: WorkRecord): Promise<void> {
  // put을 await하지 않으면 트랜잭션이 끝나기 전에 반환되고, 실패가 조용히 삼켜진다.
  await (await db()).put('works', record);
}

export async function getWorkRecord(id: string): Promise<WorkRecord | undefined> {
  return (await db()).get('works', id);
}

/** 최근 수정 순. 홈 화면의 "내 작품"이 이걸 쓴다(원격 컬렉션 쿼리는 열지 않는다). */
export async function listWorkRecords(): Promise<WorkRecord[]> {
  const all = await (await db()).getAllFromIndex('works', 'updatedAt');
  return all.reverse();
}

export async function renameLocalWorks(authorNick: string): Promise<WorkRecord[]> {
  const database = await db();
  const records = await database.getAll('works');
  const changed = records.filter((record) => record.work.authorNick !== authorNick);
  if (changed.length === 0) return records;
  const tx = database.transaction('works', 'readwrite');
  const now = Date.now();
  const renamed = changed.map((record) => ({
    ...record,
    work: { ...record.work, authorNick },
    updatedAt: now,
  }));
  await Promise.all(renamed.map((record) => tx.store.put(record)));
  await tx.done;
  const renamedById = new Map(renamed.map((record) => [record.work.id, record]));
  return records.map((record) => renamedById.get(record.work.id) ?? record);
}

export async function deleteWorkRecord(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['works', 'assets'], 'readwrite');
  await tx.objectStore('works').delete(id);
  const assets = tx.objectStore('assets');
  const keys = await assets.index('workId').getAllKeys(id);
  await Promise.all(keys.map((k) => assets.delete(k)));
  await tx.done;
}

export async function putAssetBlob(
  workId: string,
  assetId: string,
  blob: Blob,
): Promise<string> {
  const key = localKeyOf(workId, assetId);
  await (await db()).put('assets', { key, blob, workId, assetId });
  return key;
}

export async function getAssetBlob(localKey: string): Promise<Blob | undefined> {
  return (await db()).get('assets', localKey).then((r) => r?.blob);
}

export async function listAssetBlobs(workId: string): Promise<AssetRow[]> {
  return (await db()).getAllFromIndex('assets', 'workId', workId);
}

/** SHA-256 앞 16자 — 같은 바이트를 두 번 올리지 않기 위한 것. */
export async function hashBlob(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 작품 1개 총용량(완료 정의: 250KB 이하) 확인용. */
export async function workBytes(workId: string): Promise<number> {
  const rows = await listAssetBlobs(workId);
  const record = await getWorkRecord(workId);
  const metaSize = record ? new TextEncoder().encode(JSON.stringify(record.work)).length : 0;
  return rows.reduce((sum, r) => sum + r.blob.size, metaSize);
}

/** 참조가 끊긴 자산 blob 청소. 녹음을 여러 번 다시 하면 쌓인다. */
export async function pruneAssets(work: Work): Promise<void> {
  const keep = new Set(work.assets.map((a: AssetRef) => localKeyOf(work.id, a.id)));
  const database = await db();
  const tx = database.transaction('assets', 'readwrite');
  const store = tx.objectStore('assets');
  const rows = await store.index('workId').getAll(work.id);
  await Promise.all(rows.filter((r) => !keep.has(r.key)).map((r) => store.delete(r.key)));
  await tx.done;
}
