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
 *   5. 문서 갱신: remotePath, visibility:'link', discoverable(옵션대로)
 *
 * 2번을 먼저 하는 이유는 Storage 쓰기 규칙이 "작품 문서가 있고 내가 소유자인가"를
 * 검사하기 때문이다. 3~5 사이에 실패하면 문서는 'local'로 남고 링크는 열리지 않는다.
 * 미완성 상태가 공유되는 사고가 구조적으로 없다.
 */

import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore/lite';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { applyVoiceMode, type VoiceMode } from '../audio-engine/voice';
import { t } from '../i18n';
import { normalizeWork, validateWork } from '../work-model/validate';
import { parseWork } from '../work-model/serialize';
import {
  photoArtKeyNumbers,
  revealNeedsAsset,
  type AssetRef,
  type Work,
} from '../work-model/types';
import { getAssetBlob, getWorkRecord, localKeyOf, putWorkRecord } from './db';
import { ensureSignedIn, firestore, functions, isAdminUser, isFirebaseConfigured, storage } from './firebase';
import { acquireUid } from './identity';
import { assetPath, thumbPath } from './paths';
import { parsePublicFeedPage, type FeedCursor, type PublicFeedPage } from './public-feed';
import { toPortableWork } from './portable-work';
import { renderShareThumb } from './thumbnail';
// groups.ts는 remote.ts를 import하지 않는다 — 순환 없음. 그룹 제출은 공유가 이미
// 끝난 뒤에 곁다리로 붙는 절차라, 이 파일 쪽에서만 한 방향으로 참조한다.
import { submitToGroups } from './groups';

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
    const timer = setTimeout(() => reject(new Error(t('remote.timeout', { what }))), ms);
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
/** 'popular'는 재생 수가 많은 순. 서버가 works.replayCount로 정렬한다. */
export type FeedSort = 'latest' | 'popular';

export type FeedQuery = {
  sort?: FeedSort;
  /** 제목·힌트·별명에 대한 부분 일치. 서버가 훑으며 거른다. */
  search?: string;
  /** 정확히 일치하는 별명만. 색인으로 걸러지므로 검색과 달리 비용이 늘지 않는다. */
  authorNick?: string;
  /** 이어보기 위치. 없으면 처음부터. */
  cursor?: FeedCursor | null;
};

export async function fetchPublicFeed(query: FeedQuery = {}): Promise<PublicFeedPage> {
  if (!isFirebaseConfigured) {
    throw new Error(t('remote.stageNotConfigured'));
  }
  const callable = httpsCallable(functions(), 'listPublicFeed');
  const response = await withTimeout(
    callable({
      sort: query.sort || 'latest',
      search: query.search || '',
      authorNick: query.authorNick || '',
      cursor: query.cursor ?? null,
    }),
    WRITE_TIMEOUT_MS,
    t('remote.op.feed'),
  );
  return parsePublicFeedPage(response.data);
}

export type { PublicFeedItem, PublicFeedPage, FeedCursor } from './public-feed';
export type { FeedSort as PublicFeedSort };

export type ShareOptions = {
  /** 녹음한 목소리를 어떻게 올릴지. 게이트 화면에서 아이·보호자가 고른다. */
  voiceMode: VoiceMode;
  /** 공유 기간(일). null이면 계속. */
  expireDays: 7 | 30 | null;
  /** 공개 스테이지(모두의 스테이지)에 노출할 것인가. */
  discoverable: boolean;
  /** 제출할 그룹. 비어 있으면 그룹 제출을 하지 않는다. */
  groupIds?: string[];
  onProgress?: (step: string) => void;
};

async function uploadPath(path: string, blob: Blob, max: number): Promise<void> {
  if (blob.size > max) {
    throw new Error(t('remote.fileTooBig', { kb: Math.round(blob.size / 1024) }));
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
  throw lastError instanceof Error ? lastError : new Error(t('remote.uploadFailed'));
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
    return t('remote.err.anonDisabled');
  }
  if (code.includes('permission-denied') || msg.includes('PERMISSION_DENIED')) {
    return t('remote.err.permission');
  }
  if (code.includes('unavailable') || code.includes('storage/unknown')) {
    return t('remote.err.network');
  }
  if (code.includes('functions/not-found')) {
    return t('remote.err.functions');
  }
  if (code.includes('failed-precondition')) {
    return t('remote.err.index');
  }
  if (code.includes('storage/unauthorized')) {
    return t('remote.err.storageRules');
  }
  if (code.includes('storage/retry-limit-exceeded') || code.includes('storage/bucket-not-found')) {
    return t('remote.err.storageBucket');
  }
  if (msg.includes('has not been used in project') || msg.includes('is disabled')) {
    return t('remote.err.consoleSetup');
  }
  return msg || t('remote.err.generic');
}

export type PublishResult = {
  url: string;
  work: Work;
  /** 실제로 제출된 그룹. 일부만 됐을 수 있다. */
  submittedGroups?: string[];
  /** 그룹 제출이 통째로 실패했을 때의 사람이 읽을 수 있는 사유. */
  groupError?: string;
};

/**
 * 그룹 제출 skip 사유를 사람이 읽을 말로.
 *
 * 'already-submitted'는 이 함수로 안 들어온다 — 이미 올라가 있다는 뜻이라
 * 에러가 아니라서 호출부에서 미리 걸러낸다.
 */
function explainGroupSkipReason(reason: string): string {
  switch (reason) {
    case 'group-full':
      return t('remote.group.full');
    case 'not-member':
      return t('remote.group.notMember');
    case 'admins-only':
      return t('remote.group.adminOnly');
    case 'too-many-groups':
      return t('remote.group.limit');
    default:
      return t('remote.group.failed');
  }
}

export async function publishWork(input: Work, options: ShareOptions): Promise<PublishResult> {
  if (!isFirebaseConfigured) {
    throw new Error(t('remote.notConfigured'));
  }

  const { onProgress } = options;

  // 1. 여기서 처음으로 계정이 생긴다.
  onProgress?.(t('remote.step.connecting'));
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
      t('remote.photoBlocked', { keys: photoKeys.join(', ') }),
    );
  }

  let work = normalizeWork({ ...input, authorUid: uid, visibility: 'local' });
  const errors = validateWork(work);
  if (errors.length) throw new Error(errors[0].message);

  // 2. 소유권 먼저. 이 문서가 있어야 Storage 쓰기 규칙이 통과한다.
  onProgress?.(t('remote.step.creating'));
  await withTimeout(
    /*
     * merge를 쓰는 이유: 이 문서에는 클라이언트가 모르는 서버 전용 필드가 있다.
     * replayCount(정렬용 재생 수)는 Cloud Function만 올린다. 통째로 덮어쓰면
     * **다시 공유할 때마다 재생 수가 0으로 되돌아간다.**
     * 보내는 payload는 완전한 Work라 merge라도 우리가 아는 필드는 전부 갱신된다.
     */
    setDoc(doc(firestore(), 'works', work.id), toPortableWork(work), { merge: true }),
    WRITE_TIMEOUT_MS,
    t('remote.op.createWork'),
  );

  // 3. 자산 업로드. 목소리 처리 모드가 여기서 적용된다.
  const uploaded: AssetRef[] = [];
  const dropped = new Set<string>();

  for (const asset of work.assets) {
    onProgress?.(asset.kind === 'art' ? t('remote.step.uploadArt') : t('remote.step.uploadSound'));
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
  onProgress?.(t('remote.step.thumb'));
  const thumb = await renderShareThumb(work);
  await uploadPath(thumbPath(work.id), thumb, MAX_ART_BYTES);

  // 5. 이제서야 링크가 열린다.
  onProgress?.(t('remote.step.finishing'));
  const groupIds = options.groupIds ?? [];
  /*
   * 그룹이 하나라도 있으면 expiresAt은 무조건 null이다.
   * 참가자가 7일을 골라 두면 그룹 스테이지에서 작품이 조용히 사라진다. 서버
   * (submitToGroup)도 같은 값을 강제하지만, 여기서 먼저 맞춰 두면 제출이
   * 실패했을 때도 만료 상태가 어긋나지 않는다.
   */
  const expiresAt = groupIds.length
    ? null
    : options.expireDays
      ? Date.now() + options.expireDays * 86_400_000
      : null;
  const published: Work = { ...work, visibility: 'link' };
  const portablePublished = toPortableWork(published);
  await withTimeout(
    updateDoc(doc(firestore(), 'works', work.id), {
      assets: portablePublished.assets,
      keys: portablePublished.keys,
      /*
       * 비밀도 여기서 다시 쓴다. 2번 단계에서 올린 문서에는 **자산이 빠지기 전의**
       * 비밀이 들어 있다 — applyDroppedAssets가 그 뒤에 돌기 때문이다.
       * 빼먹으면 원격 문서에만 열리지 않는 비밀이 남는다.
       */
      secrets: portablePublished.secrets,
      visibility: 'link',
      // 공개 피드에 노출할지는 게이트 화면에서 고른 대로다. 그룹 전용으로
      // 올린 작품까지 무조건 공개 스테이지에 뜨던 게 이 필드를 하드코딩했던 문제였다.
      discoverable: options.discoverable,
      expiresAt,
    }),
    WRITE_TIMEOUT_MS,
    t('remote.op.openLink'),
  );

  const record = await getWorkRecord(work.id);
  await putWorkRecord({
    work: published,
    updatedAt: Date.now(),
    published: true,
    thumb: record?.thumb,
  });

  const result: PublishResult = { url: shareUrl(work.id), work: published };

  /*
   * 그룹 제출은 공유가 끝난 뒤에 곁다리로 붙인다. 실패해도 publishWork 전체를
   * 실패시키지 않는다 — 링크는 이미 열렸고 공유 자체는 성공했다. 대신 결과에
   * 담아 돌려줘서 화면이 "링크는 됐지만 그룹은 안 됐다"는 사실을 숨기지 않게 한다.
   */
  if (groupIds.length) {
    onProgress?.(t('remote.step.group'));
    try {
      const { submitted, skipped } = await submitToGroups(work.id, groupIds);
      result.submittedGroups = submitted;
      if (submitted.length === 0 && skipped.length > 0) {
        // 전부 skip됐을 때만 이유를 보여준다. already-submitted는 에러가 아니라서
        // 다른 이유가 하나라도 있을 때만 그걸 대표로 보여준다.
        const meaningful = skipped.filter((s) => s.reason !== 'already-submitted');
        if (meaningful.length > 0) {
          result.groupError = explainGroupSkipReason(meaningful[0].reason);
        }
      }
    } catch (e) {
      console.warn('[remote] 그룹 제출 실패', e);
      result.groupError = explainFirebaseError(e);
    }
  }

  return result;
}

/** 올리지 않기로 한 소리를 참조하던 키를 프리셋으로 되돌린다. */
function applyDroppedAssets(work: Work, dropped: Set<string>): Work {
  if (dropped.size === 0) return work;
  const gone = (id: string | null) => !!id && dropped.has(id);

  /*
   * 세 자리를 **각각** 본다. 예전에는 자리마다 early return이라, 소리와 그림이
   * 함께 빠진 키에서는 소리만 고쳐지고 그림은 없는 자산을 계속 가리켰다.
   */
  const keys = work.keys.map((k) => ({
    ...k,
    sound: gone(k.sound.assetId)
      ? { ...k.sound, assetId: null, presetId: k.sound.presetId ?? 'tok@1' }
      : k.sound,
    appearance: gone(k.appearance.artAssetId)
      ? { ...k.appearance, artAssetId: null }
      : k.appearance,
    /*
     * 직접 그린 스탬프는 그림이 곧 흔적 그 자체다. 되돌릴 프리셋이 없으므로
     * 흔적을 끈다 — 켜 두면 눌러도 아무것도 안 찍히는 설정만 남는다.
     */
    trace: gone(k.trace.assetId)
      ? {
          ...k.trace,
          assetId: null,
          type: k.trace.type === 'myStamp@1' ? ('none' as const) : k.trace.type,
        }
      : k.trace,
  })) as Work['keys'];

  /*
   * 자산이 빠진 비밀은 **지운다**. 키처럼 프리셋으로 되돌릴 수가 없다 —
   * 비밀의 알맹이가 그 그림이거나 그 소리이기 때문이다.
   *
   * 남겨 두면 감상 화면에 "비밀 1개 있어요"가 뜨는데 아무리 눌러도 안 열린다.
   * 아이가 목소리를 안 올리기로 고른 순간 이 경로가 열리므로 드문 일이 아니다.
   * 개수에서 빠지면 애초에 찾지 않는다.
   */
  const secrets = work.secrets.filter(
    (s) =>
      !revealNeedsAsset(s.reveal.kind) || !s.reveal.assetId || !dropped.has(s.reveal.assetId),
  );

  return { ...work, keys, secrets };
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
    t('remote.op.fetchWork'),
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
  await withTimeout(fn({ workId }), WRITE_TIMEOUT_MS, t('remote.op.unshare'));
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
const reporting = new Set<string>();

export type RecordPlayOptions = {
  /** 그룹 스테이지에서 들어왔다면 그 그룹. 서버가 멤버십을 다시 확인한다. */
  groupId?: string | null;
  /**
   * 끝까지 들었는가. 그룹의 고유 청취자 한 표는 이 값이 true일 때만 등록된다.
   * 0.5초 눌렀다 나간 것을 "들었다"로 세면 전수 청취가 무의미해진다.
   */
  completed?: boolean;
};

/**
 * 재생/누름 카운트. 한 세션에서 같은 작품은 분당 한 번만 보고한다.
 *
 * 중복 방지 키에 groupId와 completed를 넣는 이유:
 * 한 번의 감상에서 이 함수는 **두 번** 불린다 — 재생 시작(재생 수)과 완주(표 등록).
 * 키가 workId와 분(minute)뿐이면 뒤에 오는 완주 보고가 앞의 것과 같은 키가 되어
 * 조용히 삼켜지고, **표가 영영 등록되지 않는다.**
 */
export async function recordPlay(
  workId: string,
  presses: number,
  options: RecordPlayOptions = {},
): Promise<void> {
  if (!isFirebaseConfigured) return;
  const groupId = options.groupId || '';
  const completed = options.completed === true;
  const key = `${workId}:${groupId}:${completed}:${Math.floor(Date.now() / 60_000)}`;
  if (reported.has(key) || reporting.has(key)) return;
  reporting.add(key);
  try {
    const { user, error } = await ensureSignedIn();
    if (!user) throw error ?? new Error(t('remote.playSigninFailed'));
    const fn = httpsCallable(functions(), 'recordPlay');
    const response = await fn({ workId, presses, groupId, completed });
    // 서버가 반영한 뒤에만 완료 처리한다. 실패한 호출은 같은 분 안에도 다시 시도할 수 있다.
    reported.add(key);

    /*
     * 그룹 집계가 왜 안 잡혔는지는 서버만 안다(참가자가 아님·내 작품·내려간 작품…).
     * 삼켜 버리면 "그룹 리플레이 숫자가 안 올라요"라는 신고만 남고 원인을 물어볼
     * 데가 없다. 사용자를 방해하지 않도록 화면에는 띄우지 않고 콘솔에만 남긴다.
     */
    const group = (response.data as { group?: { reason?: string } } | null)?.group;
    if (groupId && group?.reason) {
      console.info('[remote] 그룹 집계에 반영되지 않았어요', groupId, workId, group.reason);
    }
  } catch (e) {
    // 통계는 실패해도 감상 경험을 막지 않는다.
    console.warn('[remote] 재생 집계 실패', e);
  } finally {
    reporting.delete(key);
  }
}
