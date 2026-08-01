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
