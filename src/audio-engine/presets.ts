/**
 * 프리셋 소리 — 파일이 아니라 코드로 합성한다.
 *
 * 이유: 저장소에 바이너리를 두지 않아도 되고, 네트워크 왕복 없이 첫 화면부터
 * 즉시 발음할 수 있다. 어차피 전부 0.5초 이하의 짧은 효과음이다.
 *
 * **여기 있는 파형을 절대 수정하지 말 것.** 고치고 싶으면 `tok@2`를 새로 추가한다.
 * 기존 파형을 바꾸면 그 소리를 쓴 과거 작품 전체가 다르게 들린다.
 */

import { presetBase, type PresetId } from '../work-model/presets';

type Synth = (ctx: BaseAudioContext) => AudioBuffer;

function make(
  ctx: BaseAudioContext,
  seconds: number,
  fill: (i: number, t: number, sr: number) => number,
) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = fill(i, i / sr, sr);
  // 마지막 3ms 페이드아웃 — 뚝 끊길 때 나는 클릭 잡음 제거
  const fade = Math.min(len, Math.floor(sr * 0.003));
  for (let i = 0; i < fade; i++) data[len - 1 - i] *= i / fade;
  return buf;
}

const decay = (t: number, tau: number) => Math.exp(-t / tau);
const TAU = Math.PI * 2;

/**
 * 프리셋 합성에는 Math.random()을 쓰지 않는다.
 * 노이즈가 필요하면 결정론적 의사난수를 쓴다 — 같은 프리셋은 어느 기기에서든
 * 똑같은 파형이어야 한다.
 */
function noiseAt(i: number): number {
  let x = Math.imul(i + 1, 0x9e3779b9);
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  return ((x ^ (x >>> 13)) >>> 0) / 2147483648 - 1;
}

/** 키캡 충돌에 가까운 얇고 날카로운 성분. DC가 많은 백색 잡음보다 타건음에 어울린다. */
function brightNoiseAt(i: number): number {
  return (noiseAt(i) - noiseAt(Math.max(0, i - 1))) * 0.5;
}

const after = (t: number, start: number): number => Math.max(0, t - start);
const gate = (t: number, start: number): number => (t >= start ? 1 : 0);
const softClip = (sample: number): number => Math.tanh(sample);

/** 버전 접미사를 뗀 기본 이름으로 등록한다. */
const SYNTHS: Record<string, Synth> = {
  // 실제 기계식 키의 짧은 작동음, 보강판/하우징 바닥 충돌, 키캡 공명,
  // 손을 뗄 때의 복귀음을 순서대로 겹친다. 네 프로필은 같은 음의 피치 변경이 아니라
  // 각기 다른 충돌 시점과 공명 구조를 가진 독립 파형이다.
  keyLinear: (ctx) =>
    make(ctx, 0.115, (i, t) => {
      const bottom =
        brightNoiseAt(i) * 0.58 * decay(t, 0.0038) +
        Math.sin(TAU * 165 * t + 0.7) * 0.62 * decay(t, 0.025) +
        Math.sin(TAU * 920 * t + 0.2) * 0.27 * decay(t, 0.011) +
        Math.sin(TAU * 2550 * t) * 0.12 * decay(t, 0.006);
      const upT = after(t, 0.058);
      const release = gate(t, 0.058) * (
        brightNoiseAt(i + 811) * 0.19 * decay(upT, 0.003) +
        Math.sin(TAU * 480 * upT + 0.5) * 0.17 * decay(upT, 0.014)
      );
      return softClip((bottom + release) * 1.05);
    }),

  keyTactile: (ctx) =>
    make(ctx, 0.13, (i, t) => {
      const bumpT = after(t, 0.006);
      const bump = gate(t, 0.006) * (
        brightNoiseAt(i + 173) * 0.34 * decay(bumpT, 0.0024) +
        Math.sin(TAU * 1450 * bumpT + 0.9) * 0.26 * decay(bumpT, 0.006)
      );
      const bottomT = after(t, 0.012);
      const bottom = gate(t, 0.012) * (
        brightNoiseAt(i) * 0.45 * decay(bottomT, 0.0045) +
        Math.sin(TAU * 188 * bottomT + 0.4) * 0.63 * decay(bottomT, 0.03) +
        Math.sin(TAU * 760 * bottomT) * 0.3 * decay(bottomT, 0.016)
      );
      const upT = after(t, 0.072);
      const release = gate(t, 0.072) * (
        brightNoiseAt(i + 997) * 0.21 * decay(upT, 0.0035) +
        Math.sin(TAU * 390 * upT) * 0.2 * decay(upT, 0.016)
      );
      return softClip((bump + bottom + release) * 1.08);
    }),

  keyClicky: (ctx) =>
    make(ctx, 0.12, (i, t) => {
      const clickT = after(t, 0.0035);
      const click = gate(t, 0.0035) * (
        brightNoiseAt(i + 347) * 0.72 * decay(clickT, 0.0021) +
        Math.sin(TAU * 3100 * clickT + 0.3) * 0.45 * decay(clickT, 0.004) +
        Math.sin(TAU * 1750 * clickT) * 0.28 * decay(clickT, 0.006)
      );
      const bottomT = after(t, 0.011);
      const bottom = gate(t, 0.011) * (
        brightNoiseAt(i) * 0.38 * decay(bottomT, 0.0035) +
        Math.sin(TAU * 205 * bottomT + 0.8) * 0.47 * decay(bottomT, 0.023) +
        Math.sin(TAU * 1050 * bottomT) * 0.22 * decay(bottomT, 0.01)
      );
      const upT = after(t, 0.061);
      const releaseClick = gate(t, 0.061) * (
        brightNoiseAt(i + 1201) * 0.38 * decay(upT, 0.0022) +
        Math.sin(TAU * 2250 * upT + 0.4) * 0.25 * decay(upT, 0.005)
      );
      return softClip((click + bottom + releaseClick) * 1.08);
    }),

  keyThock: (ctx) =>
    make(ctx, 0.155, (i, t) => {
      const shell =
        brightNoiseAt(i) * 0.27 * decay(t, 0.005) +
        Math.sin(TAU * 118 * t + 0.75) * 0.72 * decay(t, 0.045) +
        Math.sin(TAU * 238 * t + 0.2) * 0.42 * decay(t, 0.038) +
        Math.sin(TAU * 610 * t) * 0.25 * decay(t, 0.023) +
        Math.sin(TAU * 1320 * t) * 0.09 * decay(t, 0.01);
      const upT = after(t, 0.086);
      const release = gate(t, 0.086) * (
        brightNoiseAt(i + 1543) * 0.14 * decay(upT, 0.004) +
        Math.sin(TAU * 305 * upT + 0.6) * 0.18 * decay(upT, 0.02)
      );
      return softClip((shell + release) * 1.08);
    }),

  tok: (ctx) =>
    make(ctx, 0.08, (i, t) => (noiseAt(i) * 0.5 + Math.sin(TAU * 1400 * t) * 0.5) * decay(t, 0.012)),

  kkuk: (ctx) => make(ctx, 0.2, (_, t) => Math.sin(TAU * 110 * t) * decay(t, 0.05) * 0.9),

  ppyong: (ctx) =>
    make(ctx, 0.22, (_, t) => {
      const f = 380 + 1500 * Math.min(1, t / 0.18);
      return Math.sin(TAU * f * t) * decay(t, 0.07) * 0.8;
    }),

  dung: (ctx) =>
    make(ctx, 0.4, (_, t) => {
      const f = 60 + 110 * decay(t, 0.03);
      return Math.sin(TAU * f * t) * decay(t, 0.11);
    }),

  ttok: (ctx) =>
    make(ctx, 0.07, (i, t) => (Math.sin(TAU * 900 * t) * 0.7 + noiseAt(i) * 0.3) * decay(t, 0.008)),

  chak: (ctx) => make(ctx, 0.14, (i, t) => noiseAt(i) * decay(t, 0.03) * 0.7),

  bbiyong: (ctx) =>
    make(ctx, 0.45, (_, t) => {
      const f = t % 0.2 < 0.1 ? 760 : 1040;
      return Math.sin(TAU * f * t) * 0.5 * Math.min(1, (0.45 - t) / 0.1);
    }),

  bung: (ctx) =>
    make(ctx, 0.4, (_, t) => {
      const vib = Math.sin(TAU * 6 * t) * 6;
      const phase = (t * (130 + vib)) % 1;
      return (phase * 2 - 1) * decay(t, 0.14) * 0.6;
    }),
};

const cache = new Map<string, AudioBuffer>();

export function synthPreset(ctx: BaseAudioContext, id: PresetId | string): AudioBuffer {
  const base = presetBase(id);
  const cacheKey = `${base}@${ctx.sampleRate}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const synth = SYNTHS[base] ?? SYNTHS.tok;
  const buf = synth(ctx);
  cache.set(cacheKey, buf);
  return buf;
}

export function isPresetSynthAvailable(id: string): boolean {
  return presetBase(id) in SYNTHS;
}
