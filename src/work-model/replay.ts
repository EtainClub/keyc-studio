/**
 * 리플레이 전개 — 이 설계의 심장.
 *
 * `(keys, tempo, seed, events)` 하나로부터 공연 중 울린 **모든 노트**를 계산한다.
 * 순수 함수이므로 라이브 스케줄러와 리플레이가 같은 결과를 낼 수밖에 없고,
 * 테스트가 그 동치를 검증한다.
 *
 * 자동 반복 노트는 저장하지 않는다. loopOn~loopOff 구간과 bpm·everyBeats·offsetBeats만
 * 있으면 어느 비트에서 소리가 났는지는 순수 계산이다.
 */

import { loopEventIndex } from './rng';
import { beatMs, loopStartBeat } from './timing';
import type { KeyDef, KeyIndex, Replay, ReplayEvent, Work } from './types';

export type NoteSource = 'tap' | 'loop';

export type Note = {
  /** ms, 공연 시작 기준 */
  t: number;
  key: KeyIndex;
  source: NoteSource;
  /** 난수 유도용 인덱스. 탭은 이벤트 i, 반복은 음수 공간. */
  eventIndex: number;
};

/** 해당 절대 비트에서 이 키의 반복이 울리는가. */
export function loopFiresOnBeat(key: KeyDef, beat: number): boolean {
  if (beat < key.loop.offsetBeats) return false;
  return (beat - key.loop.offsetBeats) % key.loop.everyBeats === 0;
}

type Window = { fromBeat: number; toMs: number };

/**
 * 키 하나의 반복 활성 구간들.
 * 초기 상태(`loop.enabled`)에서 시작해 loopOn/loopOff 이벤트로 열고 닫는다.
 */
export function loopWindows(
  key: KeyDef,
  events: ReplayEvent[],
  bpm: number,
  durationMs: number,
): Window[] {
  const mine = events
    .filter((e) => e.key === key.idx && (e.type === 'loopOn' || e.type === 'loopOff'))
    .sort((a, b) => a.t - b.t || a.i - b.i);

  const windows: Window[] = [];
  let openFromBeat: number | null = key.loop.enabled ? 0 : null;

  for (const e of mine) {
    if (e.type === 'loopOn') {
      // 이미 열려 있으면 무시 — 중복 토글이 구간을 쪼개면 안 된다.
      if (openFromBeat === null) openFromBeat = loopStartBeat(e.t, bpm);
    } else {
      if (openFromBeat !== null) {
        windows.push({ fromBeat: openFromBeat, toMs: e.t });
        openFromBeat = null;
      }
    }
  }
  if (openFromBeat !== null) windows.push({ fromBeat: openFromBeat, toMs: durationMs });

  return windows.filter((w) => w.toMs > w.fromBeat * beatMs(bpm));
}

/** 반복으로 발생한 노트 전부. */
export function loopNotes(
  keys: readonly KeyDef[],
  events: ReplayEvent[],
  bpm: number,
  durationMs: number,
): Note[] {
  const notes: Note[] = [];
  const bMs = beatMs(bpm);

  for (const key of keys) {
    for (const w of loopWindows(key, events, bpm, durationMs)) {
      const endMs = Math.min(w.toMs, durationMs);
      for (let beat = w.fromBeat; ; beat++) {
        const t = beat * bMs;
        if (t >= endMs) break;
        if (loopFiresOnBeat(key, beat)) {
          notes.push({
            t,
            key: key.idx,
            source: 'loop',
            eventIndex: loopEventIndex(beat, key.idx),
          });
        }
      }
    }
  }
  return notes;
}

/** 직접 누른 노트. keyUp은 소리를 내지 않지만 기록은 남는다(길이·표정에 쓰인다). */
export function tapNotes(events: ReplayEvent[], durationMs: number): Note[] {
  return events
    .filter((e) => e.type === 'keyDown' && e.t >= 0 && e.t < durationMs)
    .map((e) => ({ t: e.t, key: e.key, source: 'tap' as const, eventIndex: e.i }));
}

/** 탭 + 반복을 합친, 시간순 정렬된 전체 노트 목록. */
export function expandReplay(
  keys: readonly KeyDef[],
  replay: Replay,
  bpm: number,
): Note[] {
  const { events, durationMs } = replay;
  return [...tapNotes(events, durationMs), ...loopNotes(keys, events, bpm, durationMs)].sort(
    (a, b) => a.t - b.t || a.key - b.key || a.eventIndex - b.eventIndex,
  );
}

export function expandWork(work: Work): Note[] {
  return expandReplay(work.keys, work.replay, work.tempo.bpm);
}

/**
 * 셀프체크용 해시.
 * 공연 저장 직후 무음 리플레이를 한 번 돌려 이 해시를 비교한다.
 * 불일치 = 결정론이 깨졌다는 뜻이고, 그건 사용자 신고 전에 알아야 한다.
 */
export function hashNotes(notes: Note[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const n of notes) {
    const parts = [Math.round(n.t), n.key, n.source === 'tap' ? 1 : 2, n.eventIndex];
    for (const p of parts) {
      h1 = Math.imul(h1 ^ (p & 0xffff), 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (p >>> 16), 0x85ebca6b) >>> 0;
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function hasAnyLoop(keys: readonly KeyDef[]): boolean {
  return keys.some((k) => k.loop.enabled);
}

/** 공연 중 이 시각에 키의 반복이 켜져 있는가 (UI 표시용). */
export function isLoopActiveAt(
  key: KeyDef,
  events: ReplayEvent[],
  tMs: number,
  bpm: number,
  durationMs: number,
): boolean {
  return loopWindows(key, events, bpm, durationMs).some(
    (w) => tMs >= w.fromBeat * beatMs(bpm) && tMs < w.toMs,
  );
}
