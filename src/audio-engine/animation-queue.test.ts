/**
 * 애니메이션 큐.
 *
 * 실제 실패 사례에서 나온 요구사항이다: 화면이 가려지면 rAF는 멈추지만
 * 오디오 시계는 계속 간다. 돌아왔을 때 밀린 것을 전부 터뜨리면
 * "소리 없이 키캡만 우수수 튀는" 화면이 된다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationQueue, type VisualEvent } from './animation-queue';
import type { KeyIndex } from '../work-model/types';

let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

/** 대기 중인 rAF 콜백을 한 프레임 분량 실행한다. */
function frame() {
  const pending = rafQueue;
  rafQueue = [];
  for (const cb of pending) cb(0);
}

function ev(key: number, time: number, source: 'tap' | 'loop' = 'loop'): VisualEvent {
  return { key: key as KeyIndex, time, source, eventIndex: key, seed: 1 };
}

describe('AnimationQueue', () => {
  it('예약 시각이 되기 전에는 발화하지 않는다', () => {
    let now = 0;
    const fired: VisualEvent[] = [];
    const q = new AnimationQueue(
      () => now,
      (e) => fired.push(e),
    );

    q.push(ev(0, 1));
    frame();
    expect(fired).toHaveLength(0);

    now = 1;
    frame();
    expect(fired).toHaveLength(1);
  });

  it('시간순으로 발화한다(늦게 넣은 이른 이벤트 포함)', () => {
    let now = 0;
    const fired: VisualEvent[] = [];
    const q = new AnimationQueue(
      () => now,
      (e) => fired.push(e),
    );

    q.push(ev(0, 0.5));
    q.push(ev(1, 0.2, 'tap'));
    q.push(ev(2, 0.3));

    // 실제와 같이 시계를 조금씩 전진시키며 프레임을 돌린다.
    for (const t of [0.2, 0.3, 0.5]) {
      now = t;
      frame();
    }
    expect(fired.map((e) => e.key)).toEqual([1, 2, 0]);
  });

  it('화면이 가려진 사이 밀린 이벤트는 버린다', () => {
    let now = 0;
    const fired: VisualEvent[] = [];
    const q = new AnimationQueue(
      () => now,
      (e) => fired.push(e),
    );

    // 공연 중 화면이 가려졌다고 치고 10초치를 넣는다.
    for (let i = 0; i < 20; i++) q.push(ev(0, i * 0.5));

    // 10초 뒤 화면 복귀 — 마지막 0.2초 안쪽 것만 살아남아야 한다.
    now = 9.9;
    frame();
    expect(fired.length).toBeLessThanOrEqual(2);
    for (const e of fired) expect(now - e.time).toBeLessThanOrEqual(0.2);
  });

  it('가려진 동안에도 큐가 무한히 자라지 않는다', () => {
    const q = new AnimationQueue(
      () => 0,
      () => {},
    );
    for (let i = 0; i < 5000; i++) q.push(ev(0, i * 0.01));
    const queue = (q as unknown as { queue: VisualEvent[] }).queue;
    expect(queue.length).toBeLessThanOrEqual(256);
  });

  it('clear가 대기 중인 이벤트를 전부 없앤다', () => {
    let now = 0;
    const fired: VisualEvent[] = [];
    const q = new AnimationQueue(
      () => now,
      (e) => fired.push(e),
    );
    q.push(ev(0, 0.1));
    q.clear();
    now = 1;
    frame();
    expect(fired).toHaveLength(0);
  });

  it('pause 중에는 발화하지 않고 resume 후 같은 시점부터 이어간다', () => {
    let now = 0;
    const fired: VisualEvent[] = [];
    const q = new AnimationQueue(
      () => now,
      (e) => fired.push(e),
    );

    q.push(ev(0, 1));
    q.pause();
    now = 1;
    frame();
    expect(fired).toHaveLength(0);

    q.resume();
    frame();
    expect(fired.map((e) => e.key)).toEqual([0]);
  });
});
