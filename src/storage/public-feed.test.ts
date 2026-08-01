import { describe, expect, it } from 'vitest';
import { parsePublicFeedItems } from './public-feed';

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
