/**
 * 박자와 길이.
 *
 * 두 가지가 여기 있고, 둘 다 라이브와 리플레이가 **같은 함수를 통과해야** 한다.
 * 라이브에서 A로 계산하고 리플레이에서 B로 계산하면 미세하게 어긋나는데,
 * 그 어긋남은 "가끔 다르게 들린다"로 나타나서 원인 추적이 거의 불가능하다.
 */

import type { Tempo, TempoBpm, TempoPreset } from './types';
import { TEMPO_BPM } from './types';

/** 한 마디 = 4비트 */
export const BEATS_PER_BAR = 4;

/** 공연은 이 시간을 넘지 않는 최대 마디 수만큼 지속된다. */
export const MAX_DURATION_MS = 15000;

/** 카운트인도 1마디 — 그래야 3·2·1이 박자에 맞는다. */
export const COUNT_IN_BEATS = BEATS_PER_BAR;

export function beatMs(bpm: number): number {
  return 60000 / bpm;
}

export function barMs(bpm: number): number {
  return beatMs(bpm) * BEATS_PER_BAR;
}

/**
 * 15초 벽시계로 자르면 마지막 루프가 어중간하게 잘린다.
 * 15초를 넘지 않는 최대 마디 수로 정의한다.
 *
 *   느리게 80  → 750.0ms/비트 → 5마디 → 15,000ms
 *   보통  100  → 600.0ms/비트 → 6마디 → 14,400ms
 *   빠르게 130 → 461.5ms/비트 → 8마디 → 14,769ms
 */
export function barsFor(bpm: number): number {
  return Math.floor(MAX_DURATION_MS / barMs(bpm));
}

export function durationFor(bpm: number): number {
  return Math.round(barsFor(bpm) * barMs(bpm));
}

export function durationForTempo(tempo: Tempo): number {
  return durationFor(tempo.bpm);
}

export function durationForPreset(preset: TempoPreset): number {
  return durationFor(TEMPO_BPM[preset]);
}

export function countInMs(bpm: number): number {
  return beatMs(bpm) * COUNT_IN_BEATS;
}

/**
 * 루프 켜기는 **다음 비트 경계**에서 발효된다.
 * 아이가 3.1초에 켰다고 그 순간 소리가 나면 박자가 무너진다.
 * 라이브에서 이 함수를 거쳐 예약하고, 리플레이에서도 같은 함수를 거치므로
 * 두 경로는 자동으로 일치한다.
 */
export function loopStartBeat(tMs: number, bpm: number): number {
  return Math.ceil(tMs / beatMs(bpm));
}

/** 루프 끄기는 즉시. 아이의 직관에 맞다. */
export function loopStopBeat(tMs: number, bpm: number): number {
  return tMs / beatMs(bpm);
}

export function beatAt(tMs: number, bpm: number): number {
  return Math.floor(tMs / beatMs(bpm));
}

export function barAt(tMs: number, bpm: number): number {
  return Math.floor(tMs / barMs(bpm));
}

export const ALL_TEMPOS: { preset: TempoPreset; bpm: TempoBpm }[] = [
  { preset: 'slow', bpm: 80 },
  { preset: 'normal', bpm: 100 },
  { preset: 'fast', bpm: 130 },
];
