/**
 * "새로 만들기"를 처음 누른 사람은 사용법부터 보는지.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});

import { hasSeenAppGuide, markAppGuideSeen } from './first-guide';

beforeEach(() => {
  store.clear();
});

describe('hasSeenAppGuide', () => {
  it('처음에는 못 봤다', () => {
    expect(hasSeenAppGuide()).toBe(false);
  });

  it('한 번 표시하면 그 뒤로는 봤다고 기억한다', () => {
    markAppGuideSeen();
    expect(hasSeenAppGuide()).toBe(true);
  });
});

describe('저장소를 못 쓰는 환경', () => {
  it('localStorage가 막혀 있어도 던지지 않는다', () => {
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

    expect(() => markAppGuideSeen()).not.toThrow();
    expect(hasSeenAppGuide()).toBe(false);

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
});
