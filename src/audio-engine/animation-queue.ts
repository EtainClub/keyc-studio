/**
 * 예약된 시각에 시각 효과를 터뜨리는 큐.
 *
 * onFire 안에서 곧바로 DOM을 건드리면 최대 100ms 앞서 터진다(예약은 미래니까).
 * 그래서 예약 시각을 큐에 넣고, rAF에서 오디오 시계와 비교해 발화시킨다.
 * 애니메이션과 소리가 어긋나면 아이는 "고장났다"고 느낀다.
 */

import type { KeyIndex } from '../work-model/types';

export type VisualEvent = {
  key: KeyIndex;
  /** 오디오 시계 기준 절대 시각(초) */
  time: number;
  source: 'loop' | 'tap';
  /** 결정론적 난수용. rnd(seed, eventIndex, purpose)로 파티클 위치 등을 뽑는다. */
  eventIndex: number;
  seed: number;
};

/**
 * 이미 이만큼 지난 이벤트는 발화시키지 않고 버린다.
 * 화면이 가려지면(폰 잠금, 앱 전환) rAF가 멈추고 오디오만 계속 흐른다.
 * 돌아왔을 때 밀린 것을 전부 터뜨리면 소리 없는 애니메이션 폭죽이 된다.
 */
const STALE_S = 0.2;

/** 화면이 가려진 동안 큐가 무한히 자라지 않도록. 15초 공연에 필요한 양보다 넉넉하다. */
const MAX_QUEUED = 256;

export class AnimationQueue {
  private queue: VisualEvent[] = [];
  private rafId: number | null = null;
  private paused = false;

  constructor(
    private now: () => number,
    private onDue: (e: VisualEvent) => void,
  ) {}

  push(e: VisualEvent): void {
    // 대부분 시간순으로 들어오므로 뒤에서부터 삽입 위치를 찾는 편이 빠르다.
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].time > e.time) i--;
    this.queue.splice(i, 0, e);
    // 화면이 가려진 동안에는 rAF가 멈춰 큐가 계속 자란다. 오래된 쪽부터 버린다.
    if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED);
    this.ensureRunning();
  }

  private ensureRunning(): void {
    if (this.paused || this.rafId !== null) return;
    const step = () => {
      this.rafId = null;
      if (this.paused) return;
      const t = this.now();
      while (this.queue.length && this.queue[0].time <= t) {
        const due = this.queue.shift()!;
        if (t - due.time <= STALE_S) this.onDue(due);
      }
      if (this.queue.length) this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  pause(): void {
    this.paused = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume(): void {
    this.paused = false;
    if (this.queue.length) this.ensureRunning();
  }

  clear(): void {
    this.queue.length = 0;
    this.paused = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
