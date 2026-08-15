/**
 * 비밀 발동 판정.
 *
 * 이 판정이 틀리는 방식은 셋 다 화면으로는 안 보인다:
 *   - 조건을 넘긴 뒤에도 계속 터진다 (발견이 배경 효과가 된다)
 *   - 세션이 바뀌었는데 누름 횟수가 남아 첫 누름에 열린다
 *   - 영영 안 열린다
 * 그래서 여기서 잡는다.
 */

import { describe, expect, it } from 'vitest';
import { SecretTracker } from './secret-trigger';
import type { KeyIndex, Secret } from './types';

function secret(id: string, key: KeyIndex, count: number): Secret {
  return { id, trigger: { kind: 'pressCount', key, count }, reveal: { kind: 'led' } };
}

/** 같은 키를 n번 누르고, 그동안 열린 비밀 id를 모아 돌려준다. */
function pressTimes(tracker: SecretTracker, key: KeyIndex, n: number): string[] {
  const opened: string[] = [];
  for (let i = 0; i < n; i++) {
    for (const s of tracker.press(key)) opened.push(s.id);
  }
  return opened;
}

describe('SecretTracker', () => {
  it('정확히 N번째 누름에 열린다', () => {
    const tracker = new SecretTracker([secret('a', 0, 3)]);

    expect(tracker.press(0)).toEqual([]);
    expect(tracker.press(0)).toEqual([]);
    expect(tracker.press(0).map((s) => s.id)).toEqual(['a']);
  });

  it('조건을 넘겨 계속 눌러도 다시 열리지 않는다', () => {
    const tracker = new SecretTracker([secret('a', 0, 3)]);

    expect(pressTimes(tracker, 0, 20)).toEqual(['a']);
    expect(tracker.foundCount).toBe(1);
  });

  it('다른 키를 눌러도 진행되지 않는다', () => {
    const tracker = new SecretTracker([secret('a', 2, 3)]);

    pressTimes(tracker, 0, 10);
    pressTimes(tracker, 1, 10);

    expect(tracker.foundCount).toBe(0);
    expect(pressTimes(tracker, 2, 3)).toEqual(['a']);
  });

  it('키별로 따로 센다', () => {
    const tracker = new SecretTracker([secret('a', 0, 3), secret('b', 1, 3)]);

    // 두 키를 번갈아 누르면 각자 3번째에서 열린다.
    const opened: string[] = [];
    for (let i = 0; i < 3; i++) {
      for (const s of tracker.press(0)) opened.push(s.id);
      for (const s of tracker.press(1)) opened.push(s.id);
    }

    expect(opened.sort()).toEqual(['a', 'b']);
  });

  it('같은 키·같은 횟수의 비밀 둘은 한 번에 열린다', () => {
    const tracker = new SecretTracker([secret('a', 0, 3), secret('b', 0, 3)]);

    expect(pressTimes(tracker, 0, 3).sort()).toEqual(['a', 'b']);
  });

  it('reset하면 진행 상태가 0으로 돌아간다', () => {
    /*
     * 이게 안 되면 앞 감상자가 두 번 누르고 나간 뒤 다음 감상자가 한 번만 눌러도
     * 비밀이 열린다. 엔진은 세션이 바뀔 때마다 reset한다.
     */
    const tracker = new SecretTracker([secret('a', 0, 3)]);
    pressTimes(tracker, 0, 2);

    tracker.reset([secret('a', 0, 3)]);

    expect(tracker.foundCount).toBe(0);
    expect(tracker.press(0)).toEqual([]);
    expect(tracker.press(0)).toEqual([]);
    expect(tracker.press(0).map((s) => s.id)).toEqual(['a']);
  });

  it('reset으로 비밀을 비우면 아무것도 열리지 않는다', () => {
    const tracker = new SecretTracker([secret('a', 0, 1)]);

    tracker.reset();

    expect(pressTimes(tracker, 0, 20)).toEqual([]);
  });

  it('hasFound로 이미 찾은 비밀을 구별한다', () => {
    const tracker = new SecretTracker([secret('a', 0, 2), secret('b', 3, 2)]);

    pressTimes(tracker, 0, 2);

    expect(tracker.hasFound('a')).toBe(true);
    expect(tracker.hasFound('b')).toBe(false);
  });
});
