/**
 * 가짜 오디오 시계 + 가짜 타이머.
 *
 * 스케줄러가 시계와 타이머를 주입받는 유일한 이유가 이것이다 —
 * 2분짜리 드리프트 검증을 밀리초 안에 끝내기 위해서.
 */

import { NoteScheduler, type FireEvent, type StartParams } from '../audio-engine/scheduler';

export type FakeRun = {
  scheduler: NoteScheduler;
  fired: FireEvent[];
  /** 각 발화가 일어난 순간의 시계값. "예약이 미래인가"를 검증하는 데 쓴다. */
  firedAtClock: number[];
  /** 시계를 seconds만큼 전진시키며 stepSec 간격으로 틱을 돌린다. */
  advance: (seconds: number, stepSec?: number) => void;
  /** 지터가 있는 전진 — 실제 브라우저 타이머는 25ms를 지키지 않는다. */
  advanceJittery: (seconds: number) => void;
  now: () => number;
};

export function fakeRun(params: StartParams): FakeRun {
  let now = 0;
  // 객체에 담아 두지 않으면 TS가 클로저 안의 재할당을 못 보고 never로 좁힌다.
  const timer: { fn: (() => void) | null } = { fn: null };
  const fired: FireEvent[] = [];
  const firedAtClock: number[] = [];

  const scheduler = new NoteScheduler({
    now: () => now,
    onFire: (e) => {
      fired.push(e);
      firedAtClock.push(now);
    },
    setIntervalFn: (fn: () => void) => {
      timer.fn = fn;
      return 1;
    },
    clearIntervalFn: () => {
      timer.fn = null;
    },
  });

  scheduler.start(params);

  const advance = (seconds: number, stepSec = 0.025) => {
    const until = now + seconds;
    while (now < until) {
      now += stepSec;
      timer.fn?.();
    }
  };

  const advanceJittery = (seconds: number) => {
    const until = now + seconds;
    let i = 0;
    while (now < until) {
      now += 0.025 + (i % 7) * 0.008;
      i++;
      timer.fn?.();
    }
  };

  return { scheduler, fired, firedAtClock, advance, advanceJittery, now: () => now };
}
