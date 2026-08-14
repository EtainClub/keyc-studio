/**
 * 느낌(haptic)의 웹 표현.
 *
 * 웹에서는 진동을 못 준다(Android Chrome의 navigator.vibrate 정도가 전부).
 * 대신 **눌림 깊이와 반동 곡선**의 차이로 표현한다. 아이는 "골랐다"고 느끼고,
 * 데이터(haptic 필드)는 네이티브를 위해 v1부터 쌓인다.
 */

import { t } from '../i18n';
import type { Haptic, Led, Motion } from '../work-model/types';

export type FeelSpec = {
  label: string;
  emoji: string;
  /** 눌렸을 때 내려가는 깊이(px) */
  depth: number;
  /** 눌렸을 때 줄어드는 비율 */
  scale: number;
  /** 손을 뗐을 때 되돌아오는 시간(ms) */
  reboundMs: number;
  /** 되돌아오는 곡선. 튕김 여부가 느낌을 가른다. */
  easing: string;
  /** Android에서만 실제로 동작하는 진동 패턴(ms). */
  vibrate: number | number[];
};

export const FEELS: Record<Haptic, FeelSpec> = {
  tok: {
    label: t('feel.tok'),
    emoji: '👆',
    depth: 6,
    scale: 0.96,
    reboundMs: 110,
    easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
    vibrate: 10,
  },
  kkuk: {
    label: t('feel.kkuk'),
    emoji: '🫳',
    depth: 13,
    scale: 0.92,
    reboundMs: 260,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    vibrate: 35,
  },
  tongtong: {
    label: t('feel.tongtong'),
    emoji: '🏀',
    depth: 9,
    scale: 0.94,
    reboundMs: 420,
    easing: 'cubic-bezier(0.18, 1.6, 0.4, 1)',
    vibrate: [10, 60, 10],
  },
  bureure: {
    label: t('feel.bureure'),
    emoji: '📳',
    depth: 4,
    scale: 0.98,
    reboundMs: 180,
    easing: 'cubic-bezier(0.3, 1.2, 0.2, 1)',
    vibrate: [8, 20, 8, 20, 8],
  },
  kung: {
    label: t('feel.kung'),
    emoji: '🪨',
    depth: 16,
    scale: 0.9,
    reboundMs: 200,
    easing: 'cubic-bezier(0.3, 0, 0.1, 1)',
    vibrate: 60,
  },
  dugeun: {
    label: t('feel.dugeun'),
    emoji: '💓',
    depth: 8,
    scale: 0.95,
    reboundMs: 340,
    easing: 'cubic-bezier(0.2, 1.4, 0.3, 1)',
    vibrate: [20, 100, 30],
  },
};

export const HAPTIC_ORDER: Haptic[] = ['tok', 'kkuk', 'tongtong', 'bureure', 'kung', 'dugeun'];

/** id의 `@1`은 프리셋 버전이다. 프리셋을 고치면 여기에 `@2`를 추가한다. */
export const MOTIONS: { id: Motion; label: string; emoji: string }[] = [
  { id: 'squish@1', label: t('motion.squish'), emoji: '🫠' },
  { id: 'jump@1', label: t('motion.jump'), emoji: '🦘' },
  { id: 'shake@1', label: t('motion.shake'), emoji: '🌀' },
  { id: 'spin@1', label: t('motion.spin'), emoji: '🎡' },
  { id: 'pop@1', label: t('motion.pop'), emoji: '🎈' },
  { id: 'melt@1', label: t('motion.melt'), emoji: '🍦' },
];

export const LEDS: { id: Led; label: string; emoji: string }[] = [
  { id: 'none', label: t('led.none'), emoji: '⚪' },
  { id: 'flash@1', label: t('led.flash'), emoji: '⚡' },
  { id: 'breath@1', label: t('led.breath'), emoji: '🫧' },
  { id: 'rainbow@1', label: t('led.rainbow'), emoji: '🌈' },
];

/** 웹에서 가능한 만큼의 진동. iOS Safari는 무시한다. */
export function tryVibrate(haptic: Haptic): void {
  const pattern = FEELS[haptic].vibrate;
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* 무시 */
    }
  }
}
