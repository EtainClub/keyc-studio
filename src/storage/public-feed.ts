export type PublicFeedItem = {
  id: string;
  title: string;
  hint: string;
  authorNick: string;
  avatarUrl: string | null;
  durationMs: number;
  replayCount: number;
  createdAt: number;
};

const WORK_ID = /^[A-Za-z0-9_-]{12}$/;
// SPA 셸이 keyc.studio 밖(로컬 개발 서버, 토스 미니앱 웹뷰 등)에서 서빙될 수 있어
// 상대 경로가 아니라 절대 URL만 받는다 — 이 값은 항상 firebase.ts의 PUBLIC_ORIGIN과
// 맞아야 한다.
const AVATAR_URL = /^https:\/\/keyc\.studio\/avatar\/[A-Za-z0-9_-]{12}$/;

function parseItem(value: unknown): PublicFeedItem | null {
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
    typeof item.createdAt !== 'number' ||
    !Number.isFinite(item.createdAt) ||
    item.createdAt <= 0
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
    replayCount:
      typeof item.replayCount === 'number' &&
      Number.isFinite(item.replayCount) &&
      item.replayCount > 0
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(item.replayCount))
        : 0,
    createdAt: Math.round(item.createdAt),
  };
}

/** callable 응답은 신뢰 경계 밖이다. 카드에 필요한 최소 스키마만 통과시킨다. */
export function parsePublicFeedItems(value: unknown): PublicFeedItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = parseItem(item);
    return parsed ? [parsed] : [];
  });
}

/**
 * 다음 쪽을 가리키는 커서. 서버가 준 그대로 되돌려주기만 하므로 클라이언트는 내용을 해석하지 않는다.
 * 다만 모양은 검사한다 — 엉뚱한 값을 그대로 돌려보내면 서버에서 조용히 무시되고
 * 페이지가 처음으로 돌아가 버린다.
 */
export type FeedCursor = { value: number; id: string };

export type PublicFeedPage = {
  items: PublicFeedItem[];
  /** null이면 더 볼 것이 없다. */
  nextCursor: FeedCursor | null;
};

function parseCursor(value: unknown): FeedCursor | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  // 0도 정상이다 — 인기순에서 재생 수 0인 작품이 커서가 될 수 있다.
  if (typeof c.value !== 'number' || !Number.isFinite(c.value) || c.value < 0) return null;
  if (typeof c.id !== 'string' || !WORK_ID.test(c.id)) return null;
  return { value: c.value, id: c.id };
}

export function parsePublicFeedPage(value: unknown): PublicFeedPage {
  const data = (value ?? {}) as Record<string, unknown>;
  return {
    items: parsePublicFeedItems(data.items),
    nextCursor: parseCursor(data.nextCursor),
  };
}
