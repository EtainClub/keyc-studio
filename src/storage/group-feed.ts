/**
 * 그룹 스테이지 응답 파서.
 *
 * `public-feed.ts`와 같은 이유로 존재한다 — `listGroupStage` callable이 돌려주는 값은
 * 신뢰 경계 밖이다. 서버가 실수로(혹은 나중에 스키마가 바뀌어) 이상한 필드를 얹어 보내도
 * 화면에 필요한 최소 모양만 통과시키고 나머지는 조용히 버린다.
 */

export type GroupRole = 'owner' | 'admin' | 'member';

const GROUP_ID = /^[A-Za-z0-9_-]{12}$/;
const WORK_ID = /^[A-Za-z0-9_-]{12}$/;
const AVATAR_URL = /^\/avatar\/[A-Za-z0-9_-]{12}$/;

const GROUP_ROLES: readonly GroupRole[] = ['owner', 'admin', 'member'];
const SUBMIT_POLICIES = ['members', 'admins'] as const;
const RANKING_METRICS = ['uniqueListeners', 'replayCount'] as const;

export type GroupSubmitPolicy = (typeof SUBMIT_POLICIES)[number];
export type GroupRankingMetric = (typeof RANKING_METRICS)[number];

export type GroupSummary = {
  id: string;
  name: string;
  role: GroupRole;
  memberCount: number;
  entryCount: number;
  submitPolicy: GroupSubmitPolicy;
  rankingMetric: GroupRankingMetric;
};

export type GroupStageItem = {
  id: string;
  title: string;
  hint: string;
  authorNick: string;
  avatarUrl: string | null;
  durationMs: number;
  replayCount: number;
  uniqueListeners: number;
  submittedAt: number;
  /** 내가 이미 들었는가. */
  listened: boolean;
  /** 내 작품인가. */
  mine: boolean;
};

/**
 * 다음 쪽을 가리키는 커서. `public-feed.ts`와 마찬가지로 서버가 준 값을 그대로
 * 되돌려주기만 하므로 클라이언트는 내용을 해석하지 않는다 — id가 진짜 존재하는
 * 작품을 가리키는지는 서버가 다음 조회에서 다시 판단할 몫이고, 클라이언트는
 * "그럴듯한 모양인가"만 확인해서 엉뚱한 값을 보내 페이지가 처음으로 되돌아가는
 * 사고를 막으면 된다.
 */
export type GroupStageCursor = { value: number; id: string };

export type GroupStagePage = {
  /** 파싱에 실패하면 null — 화면은 그룹 헤더 없이 목록만 비운 채로 보여준다. */
  group: GroupSummary | null;
  items: GroupStageItem[];
  nextCursor: GroupStageCursor | null;
  /** 내가 이 그룹에서 들어본 작품 수. 진행률 표시에 쓴다. */
  listenedCount: number;
};

function parseNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function parseGroupSummary(value: unknown): GroupSummary | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as Record<string, unknown>;
  if (
    typeof g.id !== 'string' ||
    !GROUP_ID.test(g.id) ||
    typeof g.name !== 'string' ||
    typeof g.role !== 'string' ||
    !(GROUP_ROLES as string[]).includes(g.role) ||
    typeof g.submitPolicy !== 'string' ||
    !(SUBMIT_POLICIES as readonly string[]).includes(g.submitPolicy) ||
    typeof g.rankingMetric !== 'string' ||
    !(RANKING_METRICS as readonly string[]).includes(g.rankingMetric)
  ) {
    return null;
  }
  return {
    id: g.id,
    name: g.name.slice(0, 30),
    role: g.role as GroupRole,
    memberCount: parseNonNegativeInt(g.memberCount),
    entryCount: parseNonNegativeInt(g.entryCount),
    submitPolicy: g.submitPolicy as GroupSubmitPolicy,
    rankingMetric: g.rankingMetric as GroupRankingMetric,
  };
}

function parseGroupStageItem(value: unknown): GroupStageItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    !WORK_ID.test(item.id) ||
    typeof item.title !== 'string' ||
    typeof item.hint !== 'string' ||
    typeof item.authorNick !== 'string' ||
    typeof item.durationMs !== 'number' ||
    !Number.isFinite(item.durationMs) ||
    item.durationMs <= 0 ||
    item.durationMs > 15_000 ||
    typeof item.submittedAt !== 'number' ||
    !Number.isFinite(item.submittedAt) ||
    item.submittedAt <= 0
  ) {
    return null;
  }
  return {
    id: item.id,
    title: item.title.slice(0, 20),
    hint: item.hint.slice(0, 40),
    authorNick: item.authorNick.slice(0, 30),
    avatarUrl: typeof item.avatarUrl === 'string' && AVATAR_URL.test(item.avatarUrl)
      ? item.avatarUrl
      : null,
    durationMs: Math.round(item.durationMs),
    replayCount: parseNonNegativeInt(item.replayCount),
    uniqueListeners: parseNonNegativeInt(item.uniqueListeners),
    submittedAt: Math.round(item.submittedAt),
    listened: item.listened === true,
    mine: item.mine === true,
  };
}

function parseGroupStageItems(value: unknown): GroupStageItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = parseGroupStageItem(item);
    return parsed ? [parsed] : [];
  });
}

function parseGroupStageCursor(value: unknown): GroupStageCursor | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  // 0도 정상이다 — 미청취 정렬에서 순번 0이 경계가 될 수 있다.
  if (typeof c.value !== 'number' || !Number.isFinite(c.value) || c.value < 0) return null;
  if (typeof c.id !== 'string' || !WORK_ID.test(c.id)) return null;
  return { value: c.value, id: c.id };
}

export function parseGroupStagePage(value: unknown): GroupStagePage {
  const data = (value ?? {}) as Record<string, unknown>;
  return {
    group: parseGroupSummary(data.group),
    items: parseGroupStageItems(data.items),
    nextCursor: parseGroupStageCursor(data.nextCursor),
    listenedCount: parseNonNegativeInt(data.listenedCount),
  };
}
