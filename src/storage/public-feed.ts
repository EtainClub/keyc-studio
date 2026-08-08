export type PublicFeedItem = {
  id: string;
  title: string;
  hint: string;
  authorNick: string;
  avatarUrl: string | null;
  durationMs: number;
  createdAt: number;
};

const WORK_ID = /^[A-Za-z0-9_-]{12}$/;
const AVATAR_URL = /^\/avatar\/[A-Za-z0-9_-]{12}$/;

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
export type FeedCursor = { createdAt: number; id: string };

export type PublicFeedPage = {
  items: PublicFeedItem[];
  /** null이면 더 볼 것이 없다. */
  nextCursor: FeedCursor | null;
};

function parseCursor(value: unknown): FeedCursor | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (typeof c.createdAt !== 'number' || !Number.isFinite(c.createdAt) || c.createdAt <= 0) {
    return null;
  }
  if (typeof c.id !== 'string' || !WORK_ID.test(c.id)) return null;
  return { createdAt: c.createdAt, id: c.id };
}

export function parsePublicFeedPage(value: unknown): PublicFeedPage {
  const data = (value ?? {}) as Record<string, unknown>;
  return {
    items: parsePublicFeedItems(data.items),
    nextCursor: parseCursor(data.nextCursor),
  };
}
