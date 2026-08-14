/**
 * 목소리 처리 — **공유 게이트에서 한 번만** 실행된다.
 *
 * 왜 재생 시점이 아니라 업로드 시점인가:
 *   ① 리플레이가 어느 기기에서든 같은 소리를 내야 한다.
 *   ② 아이 목소리를 바꿔서 올리기로 했다면, 원본이 서버에 올라가면 안 된다.
 *      재생 시 이펙트로 처리하면 원본이 그대로 업로드된다.
 *
 * 표기 주의: 이건 익명화가 아니다. UI에서도 "완전 익명"이라 쓰지 않고
 * "목소리를 바꿔서 올려요" 정도의 사실 서술만 한다.
 */

import { t } from '../i18n';
import { encodeWav, TARGET_SAMPLE_RATE } from './wav';

export type VoiceMode = 'asIs' | 'robot' | 'preset' | 'silent';

export const VOICE_MODES: { id: VoiceMode; label: string; detail: string }[] = [
  { id: 'asIs', label: t('voice.asIs.label'), detail: t('voice.asIs.detail') },
  { id: 'robot', label: t('voice.robot.label'), detail: t('voice.robot.detail') },
  { id: 'preset', label: t('voice.preset.label'), detail: t('voice.preset.detail') },
  { id: 'silent', label: t('voice.silent.label'), detail: t('voice.silent.detail') },
];

function offlineCtor(): typeof OfflineAudioContext | null {
  const w = window as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

/**
 * 링 변조로 목소리를 금속성으로 바꾼다.
 * 화자 식별을 어렵게 하려는 것이 목적이고, 그걸 보장한다고 말하지는 않는다.
 */
export async function toRobotWav(wav: ArrayBuffer): Promise<Blob> {
  const Ctor = offlineCtor();
  if (!Ctor) throw new Error(t('voice.unsupported'));

  // 디코드용으로만 잠깐 쓰는 컨텍스트.
  const probe = new Ctor(1, 1, TARGET_SAMPLE_RATE);
  const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
    const maybe = probe.decodeAudioData(wav.slice(0), resolve, reject);
    if (maybe && typeof (maybe as Promise<AudioBuffer>).then === 'function') {
      (maybe as Promise<AudioBuffer>).then(resolve, reject);
    }
  });

  const offline = new Ctor(1, decoded.length, decoded.sampleRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;

  // gain을 0으로 두고 오실레이터를 gain 파라미터에 직접 꽂으면 신호 × 사인파가 된다.
  const ring = offline.createGain();
  ring.gain.value = 0;
  const osc = offline.createOscillator();
  osc.frequency.value = 42;
  osc.connect(ring.gain);

  // 링 변조만 걸면 소리가 너무 얇아진다. 원본을 조금 섞는다.
  const dry = offline.createGain();
  dry.gain.value = 0.25;

  src.connect(ring).connect(offline.destination);
  src.connect(dry).connect(offline.destination);

  osc.start();
  src.start();
  const rendered = await offline.startRendering();

  return encodeWav(rendered.getChannelData(0), rendered.sampleRate);
}

/** 공유 게이트가 고른 모드대로 자산 바이트를 만든다. null이면 올리지 않는다. */
export async function applyVoiceMode(
  wav: ArrayBuffer,
  mode: VoiceMode,
): Promise<Blob | null> {
  switch (mode) {
    case 'asIs':
      return new Blob([wav], { type: 'audio/wav' });
    case 'robot':
      return toRobotWav(wav);
    case 'preset':
    case 'silent':
      return null;
  }
}
