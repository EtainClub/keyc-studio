import { describe, expect, it } from 'vitest';
import { parseGroupStagePage, parseGroupSummary } from './group-feed';
// 정규화 함수는 groups.ts가 소유하지만(콜러블 앞단 정리 로직), 파서와 같은
// "서버·사용자 입력 경계 다듬기" 성격이라 이 테스트 파일에서 함께 검증한다.
import { normalizeJoinCode } from './groups';

const validItem = {
  id: 'Abcdef123_-x',
  title: '고양이 공연',
  hint: '네 번째 키를 들어보세요',
  authorNick: '반짝고래12',
  avatarUrl: 'https://keyc.studio/avatar/Abcdef123_-x',
  durationMs: 14_400,
  replayCount: 27,
  uniqueListeners: 9,
  submittedAt: 1_754_000_000_000,
  listened: false,
  mine: false,
  private: false,
};

const validGroup = {
  id: 'Bbcdef123_-y',
  name: '3학년 2반',
  role: 'member' as const,
  memberCount: 24,
  entryCount: 11,
  submitPolicy: 'members' as const,
  rankingMetric: 'uniqueListeners' as const,
  phase: 'open' as const,
  roundNumber: 1,
  roundTitle: '',
};

describe('그룹 요약', () => {
  it('필요한 필드만 읽는다', () => {
    expect(parseGroupSummary({ ...validGroup, secret: 'hidden' })).toEqual(validGroup);
  });

  it('role이 허용값 밖이면 버린다', () => {
    expect(parseGroupSummary({ ...validGroup, role: 'teacher' })).toBeNull();
  });

  it('submitPolicy가 허용값 밖이면 버린다', () => {
    expect(parseGroupSummary({ ...validGroup, submitPolicy: 'everyone' })).toBeNull();
  });

  it('rankingMetric이 허용값 밖이면 버린다', () => {
    expect(parseGroupSummary({ ...validGroup, rankingMetric: 'likes' })).toBeNull();
  });

  it('멤버·제출 수가 음수/NaN이면 0으로 떨어진다', () => {
    expect(parseGroupSummary({ ...validGroup, memberCount: -3 })?.memberCount).toBe(0);
    expect(parseGroupSummary({ ...validGroup, entryCount: Number.NaN })?.entryCount).toBe(0);
  });

  it('이름이 30자로 잘린다', () => {
    const longName = '가'.repeat(40);
    expect(parseGroupSummary({ ...validGroup, name: longName })?.name).toBe(longName.slice(0, 30));
  });

  it('id 모양이 어긋나면 버린다', () => {
    expect(parseGroupSummary({ ...validGroup, id: 'short' })).toBeNull();
  });

  it('그룹 자체가 엉뚱해도 null', () => {
    for (const value of [null, undefined, 'x', 7, []]) {
      expect(parseGroupSummary(value)).toBeNull();
    }
  });
});

describe('그룹 스테이지 항목', () => {
  it('서버가 준 배열에 이상한 항목이 섞여도 그것만 버리고 나머지는 통과한다', () => {
    const page = parseGroupStagePage({
      group: validGroup,
      items: [validItem, { ...validItem, id: 'short' }, 'nope', null, { ...validItem, id: 'Cbcdef123_-z' }],
    });
    expect(page.items).toEqual([validItem, { ...validItem, id: 'Cbcdef123_-z' }]);
  });

  it('공연 길이가 0이면 버린다', () => {
    const page = parseGroupStagePage({ items: [{ ...validItem, durationMs: 0 }] });
    expect(page.items).toEqual([]);
  });

  it('공연 길이가 음수면 버린다', () => {
    const page = parseGroupStagePage({ items: [{ ...validItem, durationMs: -100 }] });
    expect(page.items).toEqual([]);
  });

  it('공연 길이가 15000을 넘으면 버린다', () => {
    const page = parseGroupStagePage({ items: [{ ...validItem, durationMs: 15_001 }] });
    expect(page.items).toEqual([]);
  });

  it('공연 길이가 문자열이면 버린다', () => {
    const page = parseGroupStagePage({ items: [{ ...validItem, durationMs: '14400' }] });
    expect(page.items).toEqual([]);
  });

  it('정해진 작품 기반 아바타 URL 외에는 null로 떨어진다', () => {
    const page = parseGroupStagePage({
      items: [{ ...validItem, avatarUrl: 'https://photos.google.com/private' }],
    });
    expect(page.items).toEqual([{ ...validItem, avatarUrl: null }]);
  });

  it('제목·힌트·별명이 최대 길이로 잘린다', () => {
    const page = parseGroupStagePage({
      items: [
        {
          ...validItem,
          title: '가'.repeat(30),
          hint: '나'.repeat(60),
          authorNick: '다'.repeat(50),
        },
      ],
    });
    expect(page.items[0]).toEqual({
      ...validItem,
      title: '가'.repeat(20),
      hint: '나'.repeat(40),
      authorNick: '다'.repeat(30),
    });
  });

  it('listened·mine은 명시적으로 true일 때만 true다', () => {
    const page = parseGroupStagePage({
      items: [{ ...validItem, listened: 'yes', mine: 1 }],
    });
    expect(page.items[0]).toEqual({ ...validItem, listened: false, mine: false });
  });

  it('제출 시각이 0 이하거나 NaN이면 항목을 버린다', () => {
    expect(parseGroupStagePage({ items: [{ ...validItem, submittedAt: 0 }] }).items).toEqual([]);
    expect(parseGroupStagePage({ items: [{ ...validItem, submittedAt: -1 }] }).items).toEqual([]);
    expect(parseGroupStagePage({ items: [{ ...validItem, submittedAt: Number.NaN }] }).items).toEqual([]);
  });
});

/*
 * 커서는 서버가 준 값을 그대로 되돌려주는 것이라 모양만 검사한다.
 * value: 0은 정상값이다 — 미청취 정렬에서 순번 0이 경계가 될 수 있다.
 */
describe('그룹 스테이지 쪽 나누기', () => {
  it('그룹·항목·커서·청취 수를 함께 읽는다', () => {
    const page = parseGroupStagePage({
      group: validGroup,
      items: [validItem],
      nextCursor: { value: 5, id: 'Cbcdef123_-z' },
      listenedCount: 3,
    });
    expect(page.group).toEqual(validGroup);
    expect(page.items).toEqual([validItem]);
    expect(page.nextCursor).toEqual({ value: 5, id: 'Cbcdef123_-z' });
    expect(page.listenedCount).toBe(3);
  });

  it('커서 값 0도 정상으로 받는다', () => {
    expect(
      parseGroupStagePage({ items: [], nextCursor: { value: 0, id: 'Abcdef123_-x' } }).nextCursor,
    ).toEqual({ value: 0, id: 'Abcdef123_-x' });
  });

  it('모양이 어긋난 커서는 null로 떨어진다', () => {
    const bad: unknown[] = [
      { value: 1, id: 'short' },
      { value: -1, id: 'Abcdef123_-x' },
      { value: Number.NaN, id: 'Abcdef123_-x' },
      { value: '5', id: 'Abcdef123_-x' },
      { id: 'Abcdef123_-x' },
      'nope',
      42,
    ];
    for (const nextCursor of bad) {
      expect(parseGroupStagePage({ items: [], nextCursor }).nextCursor).toBeNull();
    }
  });

  it('그룹 파싱이 실패하면 group은 null이지만 items는 살아남는다', () => {
    const page = parseGroupStagePage({ group: { id: 'short' }, items: [validItem] });
    expect(page.group).toBeNull();
    expect(page.items).toEqual([validItem]);
  });

  it('청취 수가 없거나 이상하면 0이다', () => {
    expect(parseGroupStagePage({ items: [] }).listenedCount).toBe(0);
    expect(parseGroupStagePage({ items: [], listenedCount: -5 }).listenedCount).toBe(0);
  });

  it('응답 자체가 엉뚱해도 빈 쪽으로 떨어진다', () => {
    for (const value of [null, undefined, 'x', 7, []]) {
      const page = parseGroupStagePage(value);
      expect(page.group).toBeNull();
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
      expect(page.listenedCount).toBe(0);
    }
  });
});

describe('입장 코드 정규화', () => {
  it('소문자를 대문자로 올린다', () => {
    expect(normalizeJoinCode('ab3d4f7h')).toBe('AB3D4F7H');
  });

  it('하이픈과 공백을 지운다', () => {
    expect(normalizeJoinCode('ab3d-4f7h')).toBe('AB3D4F7H');
    expect(normalizeJoinCode('ab3d 4f7h')).toBe('AB3D4F7H');
  });

  it('알파벳이 아닌 문자를 지우면서 8자로 자른다', () => {
    expect(normalizeJoinCode('  a-b3d4f7h9x!!')).toBe('AB3D4F7H');
  });

  it('헷갈리는 문자(0/O, 1/I/L)도 걸러내지 않고 그대로 둔다 — 판정은 서버 몫이다', () => {
    expect(normalizeJoinCode('o0i1l')).toBe('O0I1L');
  });
});
