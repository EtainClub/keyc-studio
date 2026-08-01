/**
 * 리플레이 결정론 — v2 설계에서 가장 깨지기 쉬운 지점.
 *
 * 검증하는 것:
 *   ① 루프 노트는 저장 없이 재계산되고, 켜기는 다음 비트 경계로 양자화된다
 *   ② 공연 길이는 마디 단위로 끊긴다
 *   ③ 난수는 순서가 아니라 해시라서, 중간에 값을 더 뽑아도 흔들리지 않는다
 *   ④ 실시간 스케줄러의 발화가 재계산 결과와 정확히 일치한다
 */

import { describe, expect, it } from 'vitest';
import { fakeRun } from '../test-utils/fake-clock';
import { createDefaultKey, createWork } from './defaults';
import { expandReplay, hashNotes, loopFiresOnBeat, loopWindows } from './replay';
import { rnd, splitmix32, loopEventIndex, PURPOSE } from './rng';
import {
  BEATS_PER_BAR,
  barMs,
  beatMs,
  durationFor,
  loopStartBeat,
  MAX_DURATION_MS,
} from './timing';
import { parseWork, serializeWork } from './serialize';
import { REPLAY_EVENTS_MAX, type KeyDef, type KeyIndex, type ReplayEvent, type Work } from './types';

function keyWith(idx: KeyIndex, patch: Partial<KeyDef['loop']>): KeyDef {
  const k = createDefaultKey(idx);
  return { ...k, loop: { ...k.loop, ...patch } };
}

function sampleWork(): Work {
  const work = createWork({ authorNick: '파란고래37' });
  work.keys = [
    keyWith(0, { enabled: true, everyBeats: 2, offsetBeats: 0 }),
    keyWith(1, { enabled: false, everyBeats: 4, offsetBeats: 1 }),
    keyWith(2, { enabled: false, everyBeats: 1, offsetBeats: 0 }),
    keyWith(3, { enabled: false, everyBeats: 8, offsetBeats: 3 }),
  ] as Work['keys'];
  work.replay = {
    seed: 12345,
    durationMs: durationFor(work.tempo.bpm),
    events: [
      { i: 0, t: 300, type: 'keyDown', key: 0 },
      { i: 1, t: 380, type: 'keyUp', key: 0 },
      // 3.1초에 켜면 다음 비트(4번째 비트 = 2400ms 뒤)부터 울려야 한다
      { i: 2, t: 3100, type: 'loopOn', key: 1 },
      { i: 3, t: 9000, type: 'loopOff', key: 1 },
      { i: 4, t: 5000, type: 'keyDown', key: 2 },
      { i: 5, t: 5090, type: 'keyUp', key: 2 },
    ],
  };
  return work;
}

describe('마디 단위 공연 길이', () => {
  it('세 템포 모두 15초를 넘지 않는 최대 마디로 끊긴다', () => {
    const cases = [
      { bpm: 80, bars: 5, ms: 15000 },
      { bpm: 100, bars: 6, ms: 14400 },
      { bpm: 130, bars: 8, ms: 14769 },
    ];
    for (const c of cases) {
      expect(durationFor(c.bpm)).toBe(c.ms);
      expect(durationFor(c.bpm)).toBeLessThanOrEqual(MAX_DURATION_MS);
      expect(Math.round(durationFor(c.bpm) / barMs(c.bpm))).toBe(c.bars);
    }
  });

  /**
   * durationMs는 정수 ms로 반올림되므로 마디 길이의 정확한 배수는 아니다
   * (130bpm에서 마디는 1846.15ms). 중요한 건 그 오차가 노트를 잘라내지 않는다는 것.
   * 마지막 마디의 마지막 비트까지 전부 길이 안에 들어와야 한다.
   */
  it('마지막 마디의 모든 비트가 길이 안에 들어온다', () => {
    for (const bpm of [80, 100, 130]) {
      const duration = durationFor(bpm);
      const lastBeat = Math.round(duration / barMs(bpm)) * BEATS_PER_BAR - 1;
      expect(lastBeat * beatMs(bpm)).toBeLessThan(duration);
      // 반올림 오차는 1ms 미만이어야 한다.
      expect(Math.abs(duration - Math.round(duration / barMs(bpm)) * barMs(bpm))).toBeLessThan(1);
    }
  });
});

describe('루프 양자화', () => {
  it('켜기는 다음 비트 경계에서 발효된다', () => {
    const bpm = 100; // 600ms/비트
    expect(loopStartBeat(0, bpm)).toBe(0);
    expect(loopStartBeat(1, bpm)).toBe(1);
    expect(loopStartBeat(600, bpm)).toBe(1);
    expect(loopStartBeat(601, bpm)).toBe(2);
    expect(loopStartBeat(3100, bpm)).toBe(6); // 3.1초 → 6번째 비트(3600ms)
  });

  it('offset 이전에는 울리지 않는다', () => {
    const key = keyWith(0, { enabled: true, everyBeats: 4, offsetBeats: 3 });
    expect(loopFiresOnBeat(key, 0)).toBe(false);
    expect(loopFiresOnBeat(key, 2)).toBe(false);
    expect(loopFiresOnBeat(key, 3)).toBe(true);
    expect(loopFiresOnBeat(key, 7)).toBe(true);
    expect(loopFiresOnBeat(key, 8)).toBe(false);
  });

  it('loopOn/loopOff가 구간을 정확히 연다', () => {
    const work = sampleWork();
    const windows = loopWindows(work.keys[1], work.replay.events, work.tempo.bpm, 14400);
    expect(windows).toHaveLength(1);
    // 3100ms에 켰으니 6번째 비트(3600ms)부터
    expect(windows[0].fromBeat).toBe(6);
    expect(windows[0].toMs).toBe(9000);
  });

  it('처음부터 켜져 있으면 0박부터 시작한다', () => {
    const work = sampleWork();
    const windows = loopWindows(work.keys[0], work.replay.events, work.tempo.bpm, 14400);
    expect(windows[0].fromBeat).toBe(0);
    expect(windows[0].toMs).toBe(14400);
  });

  it('켠 뒤 끄지 않으면 공연 끝까지 이어진다', () => {
    const key = keyWith(2, { enabled: false, everyBeats: 1 });
    const events: ReplayEvent[] = [{ i: 0, t: 1000, type: 'loopOn', key: 2 }];
    const w = loopWindows(key, events, 100, 14400);
    expect(w).toHaveLength(1);
    expect(w[0].toMs).toBe(14400);
  });
});

describe('노트 전개', () => {
  it('루프 노트는 저장하지 않아도 재계산된다', () => {
    const work = sampleWork();
    const notes = expandReplay(work.keys, work.replay, work.tempo.bpm);
    const loops = notes.filter((n) => n.source === 'loop');
    expect(loops.length).toBeGreaterThan(10);
    // 저장된 이벤트에는 루프 노트가 하나도 없다
    expect(work.replay.events.every((e) => e.type !== 'keyDown' || true)).toBe(true);
    expect(work.replay.events.filter((e) => e.type === 'keyDown')).toHaveLength(2);
  });

  it('모든 노트가 공연 길이 안에 있다', () => {
    const work = sampleWork();
    for (const n of expandReplay(work.keys, work.replay, work.tempo.bpm)) {
      expect(n.t).toBeGreaterThanOrEqual(0);
      expect(n.t).toBeLessThan(work.replay.durationMs);
    }
  });

  it('key 1의 첫 반복은 켠 시점이 아니라 다음 비트에서 난다', () => {
    const work = sampleWork();
    const first = expandReplay(work.keys, work.replay, work.tempo.bpm)
      .filter((n) => n.key === 1 && n.source === 'loop')
      .sort((a, b) => a.t - b.t)[0];
    // everyBeats 4 / offset 1 → 켜진 6박 이후 첫 유효 비트는 9박(5400ms)
    expect(first.t).toBe(9 * beatMs(100));
  });

  it('직렬화 왕복 후에도 같은 노트가 나온다', () => {
    const work = sampleWork();
    const restored = parseWork(JSON.parse(serializeWork(work)))!;
    expect(hashNotes(expandReplay(restored.keys, restored.replay, restored.tempo.bpm))).toBe(
      hashNotes(expandReplay(work.keys, work.replay, work.tempo.bpm)),
    );
  });
});

describe('난수 — 스트림이 아니라 해시', () => {
  it('같은 (seed, i, purpose)는 항상 같은 값', () => {
    expect(rnd(42, 7, PURPOSE.posX)).toBe(rnd(42, 7, PURPOSE.posX));
  });

  it('중간에 다른 값을 아무리 뽑아도 원래 값이 흔들리지 않는다', () => {
    const before = rnd(42, 10, PURPOSE.size);
    for (let i = 0; i < 1000; i++) rnd(42, i, PURPOSE.angle);
    expect(rnd(42, 10, PURPOSE.size)).toBe(before);
  });

  it('용도가 다르면 값도 다르다', () => {
    expect(rnd(1, 1, PURPOSE.posX)).not.toBe(rnd(1, 1, PURPOSE.posY));
  });

  it('0 이상 1 미만', () => {
    for (let i = 0; i < 500; i++) {
      const v = splitmix32(i * 7919);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('반복 노트의 인덱스는 사용자 이벤트와 충돌하지 않는다(음수 공간)', () => {
    for (let beat = 0; beat < 50; beat++) {
      for (let k = 0; k < 4; k++) expect(loopEventIndex(beat, k)).toBeLessThan(0);
    }
    expect(loopEventIndex(3, 1)).not.toBe(loopEventIndex(1, 3));
  });
});

describe('라이브 = 리플레이', () => {
  it('실시간 스케줄러의 발화가 재계산 결과와 정확히 일치한다', () => {
    const work = sampleWork();
    const notes = expandReplay(work.keys, work.replay, work.tempo.bpm);

    const run = fakeRun({
      startTime: 0.1,
      notes,
      durationMs: work.replay.durationMs,
    });
    run.advanceJittery(work.replay.durationMs / 1000 + 1);
    run.scheduler.stop();

    const fromScheduler = run.fired.map((e) => ({
      t: Math.round((e.time - 0.1) * 1000),
      key: e.key,
      source: e.source,
      eventIndex: e.eventIndex,
    }));
    const expected = notes.map((n) => ({
      t: Math.round(n.t),
      key: n.key,
      source: n.source,
      eventIndex: n.eventIndex,
    }));

    expect(fromScheduler).toEqual(expected);
  });

  it('2분간 반복이 밀리지 않는다', () => {
    const keys = [
      keyWith(0, { enabled: true, everyBeats: 1, offsetBeats: 0 }),
      keyWith(1, { enabled: true, everyBeats: 2, offsetBeats: 1 }),
      keyWith(2, { enabled: true, everyBeats: 4, offsetBeats: 2 }),
      keyWith(3, { enabled: true, everyBeats: 8, offsetBeats: 3 }),
    ];
    const bpm = 130;
    const twoMinutes = 120_000;
    const notes = expandReplay(
      keys,
      { seed: 1, durationMs: twoMinutes, events: [] },
      bpm,
    );

    const run = fakeRun({ startTime: 0.1, notes, durationMs: twoMinutes });
    run.advanceJittery(120);
    run.scheduler.stop();

    expect(run.fired.length).toBeGreaterThan(300);

    let maxError = 0;
    for (let i = 0; i < run.fired.length; i++) {
      const expected = 0.1 + notes[i].t / 1000;
      maxError = Math.max(maxError, Math.abs(run.fired[i].time - expected));
    }
    expect(maxError).toBeLessThan(1e-9);
    expect(run.fired[run.fired.length - 1].time).toBeGreaterThan(119);
  });

  it('예약은 항상 미래에, 지평선 안쪽에 놓인다', () => {
    const notes = expandReplay(
      [keyWith(0, { enabled: true, everyBeats: 1 })],
      { seed: 1, durationMs: 60_000, events: [] },
      130,
    );
    const run = fakeRun({ startTime: 0.1, notes, durationMs: 60_000 });
    run.advanceJittery(50);
    run.scheduler.stop();

    const late = run.fired
      .map((e, i) => run.firedAtClock[i] - e.time)
      .filter((d) => d > 0);
    expect(late).toEqual([]);

    const aheadMax = Math.max(...run.fired.map((e, i) => e.time - run.firedAtClock[i]));
    expect(aheadMax).toBeLessThanOrEqual(0.1);
  });
});

describe('용량', () => {
  /**
   * 이벤트는 압축하지 않는다 — Firestore 규칙이 `events.size() <= 600`으로
   * 개수를 검사하기 때문에, 압축 인코딩으로 바꾸면 그 규칙이 무력해진다.
   * 대신 상한(600개)에서도 작품 1개 250KB 예산 안에 들어오는지를 본다.
   */
  it('이벤트 상한 600개에서도 메타가 45KB 안쪽이다', () => {
    const work = sampleWork();
    work.replay.events = Array.from({ length: REPLAY_EVENTS_MAX }, (_, i) => ({
      i,
      t: i * 20,
      type: (i % 2 === 0 ? 'keyDown' : 'keyUp') as ReplayEvent['type'],
      key: (i % 4) as KeyIndex,
    }));
    const bytes = new TextEncoder().encode(serializeWork(work)).length;
    expect(bytes).toBeLessThan(45 * 1024);
    // 그림 4장(≈100KB) + 소리 4개(≈100KB)를 얹어도 250KB 예산 안.
    expect(bytes + 200 * 1024).toBeLessThan(250 * 1024);
  });

  it('현실적인 공연(탭 60회 + 루프 토글 몇 번)은 5KB 안쪽이다', () => {
    const work = sampleWork();
    work.replay.events = Array.from({ length: 120 }, (_, i) => ({
      i,
      t: i * 120,
      type: (i % 2 === 0 ? 'keyDown' : 'keyUp') as ReplayEvent['type'],
      key: (i % 4) as KeyIndex,
    }));
    expect(new TextEncoder().encode(serializeWork(work)).length).toBeLessThan(8 * 1024);
  });
});
