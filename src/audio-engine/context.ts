/**
 * AudioContext 소유권.
 *
 * 규칙 하나: `<audio>` 태그는 어디에서도 쓰지 않는다.
 * 첫 사용자 제스처(pointerdown)에서 반드시 unlock한다 — iOS는 그 전엔 소리를 내지 않는다.
 */

import { t } from '../i18n';

let ctx: AudioContext | null = null;
let unlocked = false;

type Ctor = typeof AudioContext;

function getCtor(): Ctor {
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  const C = w.AudioContext ?? w.webkitAudioContext;
  if (!C) throw new Error(t('engine.noWebAudio'));
  return C;
}

export function getAudioContext(): AudioContext {
  if (!ctx) {
    // interactive: 브라우저에게 최소 지연을 요구한다. 목표는 pointerdown → 발음 30ms 이하.
    ctx = new (getCtor())({ latencyHint: 'interactive' });
  }
  return ctx;
}

export function isUnlocked(): boolean {
  return unlocked && ctx?.state === 'running';
}

/**
 * 첫 터치에서 호출. resume만으로 안 풀리는 옛 iOS를 위해
 * 길이 1의 무음 버퍼를 실제로 start()해 준다.
 */
export async function unlockAudio(): Promise<AudioContext> {
  const c = getAudioContext();
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      /* 사용자 제스처 밖에서 불린 경우. 다음 터치에서 다시 시도된다. */
    }
  }
  if (!unlocked) {
    const buf = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
    unlocked = true;
  }
  return c;
}

/** 탭이 백그라운드로 갔다 오면 suspended가 되기도 한다. 화면 복귀 시 호출. */
export async function resumeIfNeeded(): Promise<void> {
  const c = ctx;
  if (c && c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      /* 무시 — 다음 제스처에서 풀린다 */
    }
  }
}

export function nowSeconds(): number {
  return getAudioContext().currentTime;
}
