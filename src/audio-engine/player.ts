/**
 * 발음 — 이게 전부다.
 *
 * `<audio>` 태그 금지. AudioBufferSourceNode를 매번 새로 만들어 예약한다
 * (BufferSource는 일회용이다). pitch는 playbackRate로 구현하므로 속도도
 * 같이 변한다 — 야옹이 아기고양이가 되는 그 효과가 의도한 재미다.
 *
 * v2에서 per-key `transform`은 없앴다. 목소리 변형은 "공유할 때 한 번"
 * 처리하는 것이지, 재생할 때마다 거는 이펙트가 아니다(voice.ts 참조).
 * 그래야 리플레이가 어느 기기에서든 같은 소리를 낸다.
 */

import type { KeyDef } from '../work-model/types';

const RATE_MIN = 0.25;
const RATE_MAX = 4;

export type PlayOptions = {
  /** ctx.currentTime 기준 초. 0이면 "지금 즉시". */
  when?: number;
  /** 미리듣기 등에서 키의 gain을 무시하고 덮어쓰고 싶을 때. */
  gain?: number;
};

export function play(
  ctx: AudioContext,
  buffer: AudioBuffer,
  key: Pick<KeyDef, 'sound'>,
  opts: PlayOptions = {},
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.min(RATE_MAX, Math.max(RATE_MIN, key.sound.pitch));

  const out = ctx.createGain();
  out.gain.value = opts.gain ?? key.sound.gain;

  src.connect(out).connect(ctx.destination);

  const when = opts.when && opts.when > 0 ? opts.when : ctx.currentTime;
  src.start(when);
  return src;
}
