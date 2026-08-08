import { describe, expect, it } from 'vitest';
import { parsePublicFeedItems, parsePublicFeedPage } from './public-feed';

const valid = {
  id: 'Abcdef123_-x',
  title: '고양이 공연',
  hint: '네 번째 키를 들어보세요',
  authorNick: '반짝고래12',
  avatarUrl: '/avatar/Abcdef123_-x',
  durationMs: 14_400,
  createdAt: 1_754_000_000_000,
};

describe('공개 피드 응답', () => {
  it('카드에 필요한 안전한 필드만 읽는다', () => {
    expect(parsePublicFeedItems([{ ...valid, authorUid: 'secret', assets: ['hidden'] }])).toEqual([
      valid,
    ]);
  });

  it('잘못된 id와 공연 길이를 버린다', () => {
    expect(
      parsePublicFeedItems([
        valid,
        { ...valid, id: 'short' },
        { ...valid, durationMs: 99_999 },
      ]),
    ).toEqual([valid]);
  });

  it('정해진 작품 기반 아바타 URL 외에는 버린다', () => {
    expect(parsePublicFeedItems([{ ...valid, avatarUrl: 'https://photos.google.com/private' }]))
      .toEqual([{ ...valid, avatarUrl: null }]);
  });

  it('배열이 아닌 응답은 빈 피드로 처리한다', () => {
    expect(parsePublicFeedItems({ items: valid })).toEqual([]);
  });
});

/*
 * 커서는 서버가 준 값을 그대로 되돌려주는 것이라 조용히 망가지기 쉽다.
 * 망가진 커서를 그대로 보내면 서버가 무시하고 1쪽을 다시 주므로, 사용자에게는
 * "더 보기를 눌렀는데 같은 게 또 나오는" 무한 루프로 보인다.
 * 그래서 모양이 어긋나면 여기서 null로 떨어뜨려 처음부터 다시 받게 한다.
 */
describe('공개 피드 쪽 나누기', () => {
  it('항목과 커서를 함께 읽는다', () => {
    const page = parsePublicFeedPage({
      items: [valid],
      nextCursor: { createdAt: 1_754_000_000_000, id: 'Bbcdef123_-y' },
    });

    expect(page.items).toEqual([valid]);
    expect(page.nextCursor).toEqual({ createdAt: 1_754_000_000_000, id: 'Bbcdef123_-y' });
  });

  it('커서가 없으면 null — 더 볼 것이 없다는 뜻이다', () => {
    expect(parsePublicFeedPage({ items: [valid], nextCursor: null }).nextCursor).toBeNull();
    expect(parsePublicFeedPage({ items: [valid] }).nextCursor).toBeNull();
  });

  it('모양이 어긋난 커서는 버린다', () => {
    const bad: unknown[] = [
      { createdAt: 1, id: 'short' },
      { createdAt: 1, id: '../../etc/passwd' },
      { createdAt: 0, id: 'Abcdef123_-x' },
      { createdAt: -1, id: 'Abcdef123_-x' },
      { createdAt: Number.NaN, id: 'Abcdef123_-x' },
      { createdAt: '1754000000000', id: 'Abcdef123_-x' },
      { id: 'Abcdef123_-x' },
      'nope',
      42,
    ];
    for (const nextCursor of bad) {
      expect(parsePublicFeedPage({ items: [], nextCursor }).nextCursor).toBeNull();
    }
  });

  it('응답 자체가 엉뚱해도 빈 쪽으로 떨어진다', () => {
    for (const value of [null, undefined, 'x', 7, []]) {
      const page = parsePublicFeedPage(value);
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    }
  });
});
