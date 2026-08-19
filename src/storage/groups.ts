/**
 * 그룹 스테이지 — 반/모둠처럼 닫힌 무리 안에서만 도는 작은 랭킹판.
 *
 * 공개 피드(`remote.ts`의 `fetchPublicFeed`)와 달리 여기 나오는 항목은 초대 코드로
 * 들어온 사람만 볼 수 있다. 그래서 클라이언트는 works 컬렉션이나 groups 컬렉션을
 * 직접 훑지 않고, 전부 Cloud Functions callable을 거친다 — 누가 어느 그룹에
 * 속하는지, 그 그룹에 뭐가 올라와 있는지 판단하는 규칙이 서버에만 있어야
 * "초대 코드 없이도 규칙 파일만 읽어서 남의 그룹을 들여다보는" 경로가 막힌다.
 *
 * 예외가 하나 있다: `listMyGroups`는 `users/{uid}/groups` 미러 문서를 Firestore에서
 * 직접 읽는다. 이건 "내 uid 아래" 경로라 보안 규칙으로 "본인만" 조건 하나면
 * 충분히 막을 수 있고, 컬렉션 그룹 인덱스 없이도 항상 빠르다 — 그룹 참여 여부를
 * 서버 왕복 없이 화면 진입 직후 바로 보여줘야 하는 요구와도 맞는다.
 */

import { collection, getDocs } from 'firebase/firestore/lite';
import { httpsCallable } from 'firebase/functions';
import { t } from '../i18n';
import { ensureSignedIn, firestore, functions, isFirebaseConfigured } from './firebase';
import { acquireUid } from './identity';
import { CALL_TIMEOUT_MS, withTimeout } from './with-timeout';
import {
  parseGroupStagePage,
  type GroupRole,
  type GroupStageCursor,
  type GroupStagePage,
} from './group-feed';

export type GroupStageSort = 'unheard' | 'latest' | 'popular';

export type GroupStageQuery = {
  groupId: string;
  sort?: GroupStageSort;
  /** 제목·힌트·별명에 대한 부분 일치. 서버가 훑으며 거른다. */
  search?: string;
  cursor?: GroupStageCursor | null;
};

const GROUP_ID = /^[A-Za-z0-9_-]{12}$/;

export const GROUP_NAME_MAX = 30;
/** 한 그룹의 정원. 서버가 판정하고(functions/index.js: GROUP_MEMBER_MAX) 여기서는 화면에만 쓴다. */
export const GROUP_MEMBER_MAX = 100;
/** 한 작품이 동시에 올라갈 수 있는 그룹 수. 서버도 같은 값으로 검사한다 — 여기 숫자만
 *  바꾼다고 상한이 바뀌지 않는다. UI가 미리 막아 헛수고를 줄이는 용도다. */
export const MAX_GROUPS_PER_WORK = 3;

/** 그룹 삭제만 예외. 하위 문서를 전부 지우고 오므로 15초로는 모자랄 수 있다. */
const DELETE_TIMEOUT_MS = 60000;

function requireConfigured(): void {
  if (!isFirebaseConfigured) {
    throw new Error(t('groups.notConfigured'));
  }
}

/**
 * 이 파일의 모든 쓰기·조회 callable은 로그인한 사람만 의미가 있다(서버가 uid로
 * 그룹 소속을 판별한다). `remote.ts`의 `recordPlay`처럼 실패를 삼키지 않고 사람이
 * 읽을 수 있는 원인을 그대로 던진다 — 로그인 실패를 숨기면 "그룹이 안 보여요"라는
 * 막연한 신고만 남는다.
 */
async function requireUid(): Promise<string> {
  requireConfigured();
  return acquireUid();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * 그룹 만들기. 로그인만 있으면 된다 — 익명 계정도 주최자가 될 수 있다.
 *
 * 예전에는 Google 계정을 요구했다. 기기를 바꾸면 사라지는 익명 주최자가 그룹을
 * 고아로 만든다는 걱정이었는데, 해법을 복구 코드(`recovery.ts`)로 옮겼다.
 * 서버도 같은 판단이다(functions/index.js: createGroup).
 */
export async function createGroup(name: string): Promise<{ groupId: string; code: string; name: string }> {
  await requireUid();
  const callable = httpsCallable(functions(), 'createGroup');
  const response = await withTimeout(
    callable({ name }),
    CALL_TIMEOUT_MS,
    t('groups.op.create'),
  );
  const data = asRecord(response.data);
  if (
    typeof data.groupId !== 'string' ||
    !GROUP_ID.test(data.groupId) ||
    typeof data.code !== 'string' ||
    !data.code ||
    typeof data.name !== 'string'
  ) {
    throw new Error(t('groups.createBadResponse'));
  }
  return { groupId: data.groupId, code: data.code, name: data.name.slice(0, GROUP_NAME_MAX) };
}

/** 그룹을 만든 사람이 초대 코드를 다시 확인한다. 다른 멤버는 서버가 permission-denied로 막는다. */
export async function fetchGroupInviteCode(groupId: string): Promise<string> {
  await requireUid();
  const callable = httpsCallable(functions(), 'getGroupCode');
  const response = await withTimeout(
    callable({ groupId }),
    CALL_TIMEOUT_MS,
    t('groups.op.invite'),
  );
  const data = asRecord(response.data);
  if (typeof data.code !== 'string' || !data.code) {
    throw new Error(t('groups.inviteBadResponse'));
  }
  return data.code;
}

/** 코드로 입장. 이미 멤버면 alreadyMember: true로 조용히 성공한다. */
export async function joinGroup(code: string): Promise<{ groupId: string; name: string; alreadyMember: boolean }> {
  await requireUid();
  const callable = httpsCallable(functions(), 'joinGroup');
  const response = await withTimeout(
    callable({ code: normalizeJoinCode(code) }),
    CALL_TIMEOUT_MS,
    t('groups.op.join'),
  );
  const data = asRecord(response.data);
  if (typeof data.groupId !== 'string' || !GROUP_ID.test(data.groupId) || typeof data.name !== 'string') {
    throw new Error(t('groups.joinBadResponse'));
  }
  return {
    groupId: data.groupId,
    name: data.name.slice(0, GROUP_NAME_MAX),
    alreadyMember: data.alreadyMember === true,
  };
}

export async function fetchGroupStage(query: GroupStageQuery): Promise<GroupStagePage> {
  await requireUid();
  const callable = httpsCallable(functions(), 'listGroupStage');
  const response = await withTimeout(
    callable({
      groupId: query.groupId,
      // '미청취' 항목을 먼저 보여주는 편이 "다들 뭘 올렸는지" 둘러보게 만드는
      // 그룹 스테이지 본연의 목적에 맞아서 기본값으로 골랐다 — 명세에 없던 판단이라
      // 다른 기본값이 필요하면 여기 한 줄만 바꾸면 된다.
      sort: query.sort || 'unheard',
      search: query.search || '',
      cursor: query.cursor ?? null,
    }),
    CALL_TIMEOUT_MS,
    t('groups.op.stage'),
  );
  return parseGroupStagePage(response.data);
}

/** 여러 그룹에 한 번에 제출. 상한을 넘긴 그룹은 skipped에 이유와 함께 돌아온다. */
export async function submitToGroups(
  workId: string,
  groupIds: string[],
): Promise<{ submitted: string[]; skipped: { groupId: string; reason: string }[] }> {
  await requireUid();
  const callable = httpsCallable(functions(), 'submitToGroup');
  const response = await withTimeout(
    callable({ workId, groupIds }),
    CALL_TIMEOUT_MS,
    t('groups.op.submit'),
  );
  const data = asRecord(response.data);
  const submitted = Array.isArray(data.submitted)
    ? data.submitted.filter((id): id is string => typeof id === 'string' && GROUP_ID.test(id))
    : [];
  const skipped = Array.isArray(data.skipped)
    ? data.skipped.flatMap((entry) => {
        const e = asRecord(entry);
        return typeof e.groupId === 'string' && GROUP_ID.test(e.groupId) && typeof e.reason === 'string'
          ? [{ groupId: e.groupId, reason: e.reason }]
          : [];
      })
    : [];
  return { submitted, skipped };
}

/**
 * 그룹 삭제. 만든 사람만 된다(서버가 ownerUid를 다시 검사한다).
 *
 * 다른 callable보다 오래 걸릴 수 있어 타임아웃을 따로 잡는다 — 서버가 멤버·작품·
 * 청취 기록을 전부 훑어 지우기 때문이다. 여기서 15초에 끊어 버리면 사용자는
 * "실패했다"고 읽지만 삭제는 계속 진행돼, 화면과 실제가 어긋난다.
 */
export async function deleteGroup(groupId: string): Promise<void> {
  await requireUid();
  const callable = httpsCallable(functions(), 'deleteGroup');
  await withTimeout(callable({ groupId }), DELETE_TIMEOUT_MS, t('groups.op.delete'));
}

export async function withdrawEntry(groupId: string, workId: string): Promise<void> {
  await requireUid();
  const callable = httpsCallable(functions(), 'withdrawEntry');
  await withTimeout(callable({ groupId, workId }), CALL_TIMEOUT_MS, t('groups.op.withdraw'));
}

const GROUP_ROLES: readonly GroupRole[] = ['owner', 'admin', 'member'];

/**
 * 내가 속한 그룹 목록.
 * callable이 아니라 users/{uid}/groups 미러 문서를 직접 읽는다 — 자기 것만 읽는
 * 경로라 규칙으로 안전하게 막을 수 있고, collectionGroup 인덱스가 필요 없다.
 */
export type MyGroup = { id: string; name: string; role: GroupRole; joinedAt: number };

export async function listMyGroups(): Promise<MyGroup[]> {
  if (!isFirebaseConfigured) return [];
  // 로그인 실패는 여기서는 에러가 아니라 "아직 그룹이 없는 상태"와 같다 — 목록 화면은
  // 빈 목록을 그냥 보여주면 되고, 로그인 자체는 다른 진입점(공유 등)이 요구한다.
  const { user } = await ensureSignedIn();
  if (!user) return [];

  const snapshot = await getDocs(collection(firestore(), 'users', user.uid, 'groups'));
  return snapshot.docs.flatMap((snap) => {
    if (!GROUP_ID.test(snap.id)) return [];
    const data = snap.data();
    if (
      typeof data.name !== 'string' ||
      typeof data.role !== 'string' ||
      !(GROUP_ROLES as string[]).includes(data.role) ||
      typeof data.joinedAt !== 'number' ||
      !Number.isFinite(data.joinedAt)
    ) {
      return [];
    }
    return [
      {
        id: snap.id,
        name: data.name.slice(0, GROUP_NAME_MAX),
        role: data.role as GroupRole,
        joinedAt: Math.round(data.joinedAt),
      },
    ];
  });
}

/**
 * 입장 코드 정규화: 대문자로 올리고 하이픈·공백 등 알파벳/숫자가 아닌 문자를 지운다.
 * 화면 입력을 서버가 기대하는 형식으로 맞추는 용도다.
 *
 * 코드 알파벳은 Crockford Base32 스타일로 `0/O`, `1/I/L`을 뺀
 * `23456789ABCDEFGHJKMNPQRSTVWXYZ`이지만, 여기서 그 알파벳으로 한 번 더 거르지는
 * 않는다 — 그러면 사용자가 실수로 `O`나 `1`을 입력했을 때 조용히 다른 문자로
 * 바뀌어 버려서, 정작 틀린 코드를 넣고도 "왜 안 되지"라는 혼란만 남긴다.
 * 판정은 언제나 서버가 한다.
 */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/**
 * 서버가 주는 코드는 8자다. 4-4로 끊어 보여주면 한눈에 읽고 옮겨 적기 쉽다.
 * 혹시 길이가 다르게 와도(서버 스키마가 바뀌는 등) slice는 범위를 벗어나면 그냥
 * 짧아질 뿐이라 화면이 깨지지 않는다.
 */
export function formatGroupCode(code: string): string {
  const head = code.slice(0, 4);
  const tail = code.slice(4, 8);
  return tail ? `${head}-${tail}` : head;
}
