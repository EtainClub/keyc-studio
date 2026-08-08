/**
 * 원격 저장 — "공유하기"를 누른 순간에만 실행된다.
 *
 * 그 전까지 아이 목소리와 그림은 이 기기 밖으로 나가지 않는다.
 *
 * ── 트랜잭션 순서가 곧 안전장치다 ──
 *   1. 익명 인증 확보 (여기서 처음 계정이 생긴다)
 *   2. Firestore에 visibility:'local'로 문서 선생성 → 소유권 확정
 *   3. 자산 업로드 (hash로 중복 스킵, 실패 시 재시도)
 *   4. 썸네일 업로드
 *   5. 문서 갱신: remotePath, visibility:'link', discoverable:true
 *
 * 2번을 먼저 하는 이유는 Storage 쓰기 규칙이 "작품 문서가 있고 내가 소유자인가"를
 * 검사하기 때문이다. 3~5 사이에 실패하면 문서는 'local'로 남고 링크는 열리지 않는다.
 * 미완성 상태가 공유되는 사고가 구조적으로 없다.
 */

import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { applyVoiceMode, type VoiceMode } from '../audio-engine/voice';
import { normalizeWork, validateWork } from '../work-model/validate';
import { parseWork } from '../work-model/serialize';
import { photoArtKeyNumbers, type AssetRef, type Work } from '../work-model/types';
import { getAssetBlob, getWorkRecord, localKeyOf, putWorkRecord } from './db';
import { firestore, functions, isAdminUser, isFirebaseConfigured, storage } from './firebase';
import { acquireUid } from './identity';
import { assetPath, thumbPath } from './paths';
import { parsePublicFeedPage, type FeedCursor, type PublicFeedPage } from './public-feed';
import { toPortableWork } from './portable-work';
import { renderShareThumb } from './thumbnail';

const MAX_ART_BYTES = 200 * 1024;
const MAX_SOUND_BYTES = 150 * 1024;

/**
 * Firestore 쓰기 타임아웃.
 *
 * Firestore SDK는 연결이 안 되면 **에러를 주지 않고 무한히 재시도한다** — 오프라인
 * 큐잉이 기본 동작이기 때문이다. 데이터베이스가 없거나 네트워크가 끊기면
 * `setDoc`이 영영 resolve되지 않고, 공유 버튼은 "올리는 중…"에서 멈춘 채로 남는다.
 * 아이는 뭐가 잘못됐는지 알 방법이 없다. 그래서 시간을 재서 끊는다.
 */
const WRITE_TIMEOUT_MS = 15000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`서버가 응답하지 않아요 (${what})`)), ms);
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

export function shareUrl(workId: string): string {
  return `${window.location.origin}/w/${workId}`;
}

/**
 * 공개 피드. 클라이언트는 works 컬렉션을 list하지 않고, 서버가 공개 작품을 골라
 * 최소 필드만 반환한다. 현재 공개 안내에 동의한 discoverable:true 작품만 포함된다.
 */
export type FeedQuery = {
  /** 제목·힌트·별명에 대한 부분 일치. 서버가 훑으며 거른다. */
  search?: string;
  /** 정확히 일치하는 별명만. 색인으로 걸러지므로 검색과 달리 비용이 늘지 않는다. */
  authorNick?: string;
  /** 이어보기 위치. 없으면 처음부터. */
  cursor?: FeedCursor | null;
};

export async function fetchPublicFeed(query: FeedQuery = {}): Promise<PublicFeedPage> {
  if (!isFirebaseConfigured) {
    throw new Error('키크 스테이지 설정이 아직 안 됐어요 (Firebase 설정 필요)');
  }
  const callable = httpsCallable(functions(), 'listPublicFeed');
  const response = await withTimeout(
    callable({
      search: query.search || '',
      authorNick: query.authorNick || '',
      cursor: query.cursor ?? null,
    }),
    WRITE_TIMEOUT_MS,
    '키크 스테이지 불러오기',
  );
  return parsePublicFeedPage(response.data);
}

export type { PublicFeedItem, PublicFeedPage, FeedCursor } from './public-feed';

export type ShareOptions = {
  /** 녹음한 목소리를 어떻게 올릴지. 게이트 화면에서 아이·보호자가 고른다. */
  voiceMode: VoiceMode;
  /** 공유 기간(일). null이면 계속. */
  expireDays: 7 | 30 | null;
  onProgress?: (step: string) => void;
};

async function uploadPath(path: string, blob: Blob, max: number): Promise<void> {
  if (blob.size > max) {
    throw new Error(`파일이 너무 커요 (${Math.round(blob.size / 1024)}KB)`);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await uploadBytes(ref(storage(), path), blob, {
        cacheControl: 'public, max-age=31536000, immutable',
      });
      return;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('업로드에 실패했어요');
}

/**
 * Firebase 오류를 사람이 읽을 수 있는 말로.
 *
 * 프로젝트가 아직 덜 준비된 상태(익명 로그인 미설정, Firestore 미생성, 버킷 없음)에서
 * 날것의 코드가 그대로 아이 화면에 뜨면 아무도 원인을 모른다.
 * 화면에는 쉬운 말을, 콘솔에는 원래 오류를 남긴다.
 */
export function explainFirebaseError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const msg = e instanceof Error ? e.message : String(e);

  if (code.includes('configuration-not-found') || msg.includes('CONFIGURATION_NOT_FOUND')) {
    return '공유 기능이 아직 준비되지 않았어요 (익명 로그인 미설정)';
  }
  if (code.includes('permission-denied') || msg.includes('PERMISSION_DENIED')) {
    return '공유 권한이 없어요 (보안 규칙 배포 필요)';
  }
  if (code.includes('unavailable') || code.includes('storage/unknown')) {
    return '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요';
  }
  if (code.includes('functions/not-found')) {
    return '키크 스테이지 서버가 아직 준비되지 않았어요 (Functions 배포 필요)';
  }
  if (code.includes('failed-precondition')) {
    return '키크 스테이지를 준비하는 중이에요 (Firestore 인덱스 배포 필요)';
  }
  if (code.includes('storage/unauthorized')) {
    return '파일을 올릴 권한이 없어요 (Storage 규칙 배포 필요)';
  }
  if (code.includes('storage/retry-limit-exceeded') || code.includes('storage/bucket-not-found')) {
    return '저장 공간이 준비되지 않았어요 (Storage 버킷 필요)';
  }
  if (msg.includes('has not been used in project') || msg.includes('is disabled')) {
    return '서버 기능이 아직 켜지지 않았어요 (Firebase 콘솔 설정 필요)';
  }
  return msg || '공유하지 못했어요';
}

export type PublishResult = { url: string; work: Work };

export async function publishWork(input: Work, options: ShareOptions): Promise<PublishResult> {
  if (!isFirebaseConfigured) {
    throw new Error('공유 설정이 아직 안 됐어요 (Firebase 설정 필요)');
  }

  const { onProgress } = options;

  // 1. 여기서 처음으로 계정이 생긴다.
  onProgress?.('연결하는 중…');
  const uid = await acquireUid();

  /*
   * 사진에서 딴 그림은 관리자 계정에서만 인터넷으로 내보낼 수 있다.
   *
   * 사진을 넣을 수 있는 계정도 관리자뿐이라 보통은 여기 걸릴 일이 없지만,
   * 표식이 붙은 자산은 백업 복원 같은 경로로도 들어올 수 있다. 그래서 계정을 확인한다.
   * UI에서도 미리 막지만 이 검사가 진짜 방어선이다 — 어떤 화면을 거쳐 들어와도 여기서 걸린다.
   *
   * 로그인이 끝난 **직후**, 첫 Firestore 쓰기 **전에** 던진다.
   * 그래야 반쯤 올라간 작품이 남지 않는다.
   */
  const photoKeys = photoArtKeyNumbers(input);
  if (photoKeys.length && !isAdminUser()) {
    throw new Error(
      `사진으로 만든 그림이 있어서 공유할 수 없어요 (키캡 ${photoKeys.join(', ')}번). ` +
        '직접 그린 그림으로 바꾸면 공유할 수 있어요.',
    );
  }

  let work = normalizeWork({ ...input, authorUid: uid, visibility: 'local' });
  const errors = validateWork(work);
  if (errors.length) throw new Error(errors[0].message);

  // 2. 소유권 먼저. 이 문서가 있어야 Storage 쓰기 규칙이 통과한다.
  onProgress?.('작품 자리를 만드는 중…');
  await withTimeout(
    setDoc(doc(firestore(), 'works', work.id), toPortableWork(work)),
    WRITE_TIMEOUT_MS,
    '작품 자리 만들기',
  );

  // 3. 자산 업로드. 목소리 처리 모드가 여기서 적용된다.
  const uploaded: AssetRef[] = [];
  const dropped = new Set<string>();

  for (const asset of work.assets) {
    onProgress?.(asset.kind === 'art' ? '그림을 올리는 중…' : '소리를 올리는 중…');
    const blob = await getAssetBlob(asset.localKey ?? localKeyOf(work.id, asset.id));
    if (!blob) {
      dropped.add(asset.id);
      continue;
    }

    let outgoing: Blob | null = blob;
    if (asset.kind === 'sound') {
      outgoing = await applyVoiceMode(await blob.arrayBuffer(), options.voiceMode);
    }
    if (!outgoing) {
      // 목소리를 올리지 않기로 한 경우. 키는 프리셋 소리로 되돌린다.
      dropped.add(asset.id);
      continue;
    }

    const path = assetPath(work.id, asset.kind, asset.id);
    await uploadPath(path, outgoing, asset.kind === 'art' ? MAX_ART_BYTES : MAX_SOUND_BYTES);
    uploaded.push({ ...asset, size: outgoing.size, remotePath: path });
  }

  work = applyDroppedAssets({ ...work, assets: uploaded }, dropped);

  // 4. 썸네일
  onProgress?.('미리보기를 만드는 중…');
  const thumb = await renderShareThumb(work);
  await uploadPath(thumbPath(work.id), thumb, MAX_ART_BYTES);

  // 5. 이제서야 링크가 열린다.
  onProgress?.('마무리하는 중…');
  const expiresAt = options.expireDays
    ? Date.now() + options.expireDays * 86_400_000
    : null;
  const published: Work = { ...work, visibility: 'link' };
  const portablePublished = toPortableWork(published);
  await withTimeout(
    updateDoc(doc(firestore(), 'works', work.id), {
      assets: portablePublished.assets,
      keys: portablePublished.keys,
      visibility: 'link',
      // 공개 피드 안내가 포함된 현재 ShareGate에서 보호자 확인을 받은 작품만 true다.
      discoverable: true,
      expiresAt,
    }),
    WRITE_TIMEOUT_MS,
    '링크 열기',
  );

  const record = await getWorkRecord(work.id);
  await putWorkRecord({
    work: published,
    updatedAt: Date.now(),
    published: true,
    thumb: record?.thumb,
  });

  return { url: shareUrl(work.id), work: published };
}

/** 올리지 않기로 한 소리를 참조하던 키를 프리셋으로 되돌린다. */
function applyDroppedAssets(work: Work, dropped: Set<string>): Work {
  if (dropped.size === 0) return work;
  const keys = work.keys.map((k) => {
    if (k.sound.assetId && dropped.has(k.sound.assetId)) {
      return { ...k, sound: { ...k.sound, assetId: null, presetId: k.sound.presetId ?? 'tok@1' } };
    }
    if (k.appearance.artAssetId && dropped.has(k.appearance.artAssetId)) {
      return { ...k, appearance: { ...k.appearance, artAssetId: null } };
    }
    return k;
  }) as Work['keys'];
  return { ...work, keys };
}

/**
 * 감상 화면은 서버 공개본을 먼저 쓴다.
 * 제작 기기만 로컬 초안을 재생하면 원격 자산 누락을 숨겨 다른 기기와 결과가 달라진다.
 */
export async function fetchWork(id: string): Promise<Work | null> {
  const local = await getWorkRecord(id);
  if (!isFirebaseConfigured) return local?.work ?? null;
  try {
    // 감상 화면도 마찬가지 — 무한 대기 대신 로컬 폴백을 택한다.
    const snap = await withTimeout(
      getDoc(doc(firestore(), 'works', id)),
      WRITE_TIMEOUT_MS,
      '작품 불러오기',
    );
    if (snap.exists()) {
      const remote = parseWork(snap.data());
      if (remote) return remote;
    }
  } catch (error) {
    if (!local) throw error;
  }
  return local?.work ?? null;
}

/**
 * 공유 중단 — 문서와 자산을 **실제로 삭제**한다.
 * Storage 읽기를 열어 둔 대가로, 이 삭제는 확실해야 한다.
 */
export async function unshareWork(workId: string): Promise<void> {
  if (!isFirebaseConfigured) return;
  await acquireUid();
  // 문서와 Storage 자산은 반드시 서버에서 함께 지운다. Function 호출이 실패했을 때
  // 문서만 지우면 공유 링크는 깨지고 목소리·그림 파일은 고아로 남는다.
  const fn = httpsCallable(functions(), 'unshareWork');
  await withTimeout(fn({ workId }), WRITE_TIMEOUT_MS, '공유 멈추기');
  const record = await getWorkRecord(workId);
  if (record) {
    await putWorkRecord({
      ...record,
      work: { ...record.work, visibility: 'local' },
      published: false,
      updatedAt: Date.now(),
    });
  }
}

const reported = new Set<string>();

/** 재생/누름 카운트. 한 세션에서 같은 작품은 분당 한 번만 보고한다. */
export async function recordPlay(workId: string, presses: number): Promise<void> {
  if (!isFirebaseConfigured) return;
  const key = `${workId}:${Math.floor(Date.now() / 60_000)}`;
  if (reported.has(key)) return;
  reported.add(key);
  try {
    const fn = httpsCallable(functions(), 'recordPlay');
    await fn({ workId, presses });
  } catch (e) {
    // 통계는 실패해도 감상 경험을 막지 않는다.
    console.warn('[remote] 재생 집계 실패', e);
  }
}
