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

/* ── 순서 조건 ────────────────────────────────────────── */

function seq(id: string, keys: KeyIndex[]): Secret {
  return { id, trigger: { kind: 'sequence', keys }, reveal: { kind: 'finale' } };
}

/** 키를 차례로 누르고, 그동안 열린 비밀 id를 모아 돌려준다. */
function pressAll(tracker: SecretTracker, keys: KeyIndex[]): string[] {
  const opened: string[] = [];
  for (const k of keys) {
    for (const s of tracker.press(k)) opened.push(s.id);
  }
  return opened;
}

describe('SecretTracker — 순서 조건', () => {
  it('정해진 차례로 다 누르면 마지막 누름에 열린다', () => {
    // 탄지로 → 네즈코 → 젠이츠 → 이노스케
    const tracker = new SecretTracker([seq('a', [0, 1, 2, 3])]);

    expect(tracker.press(0)).toEqual([]);
    expect(tracker.press(1)).toEqual([]);
    expect(tracker.press(2)).toEqual([]);
    expect(tracker.press(3).map((s) => s.id)).toEqual(['a']);
  });

  it('차례가 틀리면 안 열린다', () => {
    const tracker = new SecretTracker([seq('a', [0, 1, 2, 3])]);

    expect(pressAll(tracker, [0, 2, 1, 3])).toEqual([]);
  });

  it('중간에 틀려도 처음부터 다시 하면 열린다', () => {
    /*
     * 아이는 반드시 틀린다. 한 번 어긋났다고 그 세션에서 영영 못 열게 되면
     * "안 열리는 비밀"이 되고, 그건 고장과 구별되지 않는다.
     */
    const tracker = new SecretTracker([seq('a', [0, 1, 2])]);

    expect(pressAll(tracker, [0, 3, 0, 1, 2]).length).toBe(1);
  });

  it('앞에 군더더기가 붙어도 마지막 차례만 맞으면 열린다', () => {
    const tracker = new SecretTracker([seq('a', [0, 1])]);

    expect(pressAll(tracker, [3, 3, 2, 0, 1]).map((s) => s)).toEqual(['a']);
  });

  it('같은 키가 반복되는 순서도 정확히 잡는다', () => {
    /*
     * 진행 인덱스를 세는 방식이 조용히 틀리는 자리다. 조건이 [0,0,1]인데 0을 세 번
     * 누르고 1을 누르면, 세 번째 0에서 어긋났다고 보고 처음으로 되돌아가 버린다.
     * 실제로는 마지막 세 번(0,0,1)이 조건과 정확히 같으므로 열려야 한다.
     */
    const tracker = new SecretTracker([seq('a', [0, 0, 1])]);

    expect(pressAll(tracker, [0, 0, 0, 1]).map((s) => s)).toEqual(['a']);
  });

  it('한 번 열린 순서는 다시 눌러도 또 열리지 않는다', () => {
    const tracker = new SecretTracker([seq('a', [0, 1])]);

    expect(pressAll(tracker, [0, 1, 0, 1, 0, 1])).toEqual(['a']);
  });

  it('빈 순서는 아무 누름에도 열리지 않는다', () => {
    /*
     * 파서가 막고 있지만 여기서도 막는다. 빈 조건이 통과하면 **첫 탭에** 열려서,
     * 감상자는 숨겨진 것을 찾은 적도 없이 다 찾은 상태가 된다.
     */
    const tracker = new SecretTracker([seq('a', [])]);

    expect(pressAll(tracker, [0, 1, 2, 3, 0])).toEqual([]);
  });

  it('세션을 갈아끼우면 진행 중이던 순서가 남지 않는다', () => {
    const tracker = new SecretTracker([seq('a', [0, 1])]);
    tracker.press(0);

    tracker.reset([seq('a', [0, 1])]);

    // 앞 세션의 0이 남아 있으면 여기서 바로 열린다.
    expect(tracker.press(1)).toEqual([]);
  });

  it('순서 조건과 횟수 조건이 한 누름에 함께 열릴 수 있다', () => {
    const tracker = new SecretTracker([seq('a', [0, 1]), secret('b', 1, 1)]);

    expect(pressAll(tracker, [0, 1]).sort()).toEqual(['a', 'b']);
  });
});
