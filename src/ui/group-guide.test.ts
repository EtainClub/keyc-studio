/**
 * 그룹 안내를 언제 띄우는가.
 *
 * 두 가지가 동시에 지켜져야 한다: **한 세션에 한 번만** 뜨고(탭을 오갈 때마다
 * 뜨면 방해다), **"다음에 보지 않기"는 새로고침 뒤에도 유효**해야 한다.
 * 둘 중 하나만 지키는 구현은 둘 다 그럴듯해 보여서 눈으로는 구별되지 않는다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});

import {
  dismissGroupGuide,
  isGroupGuideDismissed,
  markGroupGuideShown,
  resetGroupGuideSession,
  shouldAutoShowGroupGuide,
} from './group-guide';

beforeEach(() => {
  store.clear();
  resetGroupGuideSession();
});

describe('shouldAutoShowGroupGuide', () => {
  it('처음 들어오면 띄운다', () => {
    expect(shouldAutoShowGroupGuide()).toBe(true);
  });

  it('한 번 띄운 뒤에는 같은 세션에서 다시 띄우지 않는다', () => {
    markGroupGuideShown();
    expect(shouldAutoShowGroupGuide()).toBe(false);
  });

  it('새 세션(새로고침)에서는 다시 띄운다 — 닫기만 한 사람은 아직 거절한 것이 아니다', () => {
    markGroupGuideShown();
    resetGroupGuideSession();
    expect(shouldAutoShowGroupGuide()).toBe(true);
  });

  it('"다음에 보지 않기"는 새 세션에서도 유효하다', () => {
    dismissGroupGuide();
    resetGroupGuideSession();

    expect(isGroupGuideDismissed()).toBe(true);
    expect(shouldAutoShowGroupGuide()).toBe(false);
  });
});

describe('저장소를 못 쓰는 환경', () => {
  it('localStorage가 막혀 있어도 던지지 않고, 그 세션 안에서는 기억한다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });

    expect(() => dismissGroupGuide()).not.toThrow();
    expect(isGroupGuideDismissed()).toBe(false);
    // 영구 저장은 실패했지만 이번 세션에는 다시 뜨지 않는다.
    expect(shouldAutoShowGroupGuide()).toBe(false);

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
});
