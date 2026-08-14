/**
 * 프리셋 소리 카탈로그 (순수 데이터).
 *
 * id에 `@1` 버전 접미사를 붙이는 규칙은 반드시 지킨다.
 * 소리를 고칠 때 기존 id의 내용을 바꾸지 말고 `tok@2`를 추가한다.
 * 안 지키면 과거 작품들이 어느 날 다르게 들린다.
 */

import { t } from '../i18n';

export type PresetId =
  | 'realTactile9@1'
  | 'realTactile8@1'
  | 'realTactile14@1'
  | 'realMxBlue@1'
  | 'keyLinear@1'
  | 'keyTactile@1'
  | 'keyClicky@1'
  | 'keyThock@1'
  | 'tok@1'
  | 'kkuk@1'
  | 'ppyong@1'
  | 'dung@1'
  | 'ttok@1'
  | 'chak@1'
  | 'bbiyong@1'
  | 'bung@1';

export type PresetInfo = {
  id: PresetId;
  label: string;
  emoji: string;
  kind: 'keycap' | 'effect' | 'legacy';
};

/**
 * label만 언어를 탄다. id는 절대 번역하지 않는다 — 저장된 작품이 참조하는 값이다.
 * 언어는 앱이 뜰 때 고정되므로 이 배열도 모듈 로드 시점에 한 번만 만들어진다.
 */
export const PRESETS: PresetInfo[] = [
  { id: 'realTactile9@1', label: t('preset.realTactile9'), emoji: '⌨️', kind: 'keycap' },
  { id: 'realTactile8@1', label: t('preset.realTactile8'), emoji: '⌨️', kind: 'keycap' },
  { id: 'realTactile14@1', label: t('preset.realTactile14'), emoji: '⌨️', kind: 'keycap' },
  { id: 'realMxBlue@1', label: t('preset.realMxBlue'), emoji: '🔵', kind: 'keycap' },
  // 합성 타건음은 기존 작품의 재생 호환성을 위해 보존하되 새 작품과 선택 목록에서는 숨긴다.
  { id: 'keyLinear@1', label: t('preset.keyLinear'), emoji: '🔴', kind: 'legacy' },
  { id: 'keyTactile@1', label: t('preset.keyTactile'), emoji: '🟤', kind: 'legacy' },
  { id: 'keyClicky@1', label: t('preset.keyClicky'), emoji: '🔵', kind: 'legacy' },
  { id: 'keyThock@1', label: t('preset.keyThock'), emoji: '⚫', kind: 'legacy' },
  { id: 'tok@1', label: t('preset.tok'), emoji: '👆', kind: 'effect' },
  { id: 'kkuk@1', label: t('preset.kkuk'), emoji: '🫵', kind: 'effect' },
  { id: 'ppyong@1', label: t('preset.ppyong'), emoji: '✨', kind: 'effect' },
  { id: 'dung@1', label: t('preset.dung'), emoji: '🥁', kind: 'effect' },
  { id: 'ttok@1', label: t('preset.ttok'), emoji: '👏', kind: 'effect' },
  { id: 'chak@1', label: t('preset.chak'), emoji: '🪄', kind: 'effect' },
  { id: 'bbiyong@1', label: t('preset.bbiyong'), emoji: '🚨', kind: 'effect' },
  { id: 'bung@1', label: t('preset.bung'), emoji: '🚗', kind: 'effect' },
];

export const KEYCAP_PRESETS = PRESETS.filter((preset) => preset.kind === 'keycap');
export const EFFECT_PRESETS = PRESETS.filter((preset) => preset.kind === 'effect');

const LEGACY_KEYCAP_REPLACEMENTS: Readonly<Record<string, PresetId>> = {
  'keyLinear@1': 'realTactile9@1',
  'keyTactile@1': 'realTactile8@1',
  'keyClicky@1': 'realMxBlue@1',
  'keyThock@1': 'realTactile14@1',
};

/** 거절된 초기 합성 타건음을 이미 저장한 작품도 실제 녹음으로 재생한다. */
export function playbackPresetId(id: PresetId | string): PresetId | string {
  return LEGACY_KEYCAP_REPLACEMENTS[id] ?? id;
}

export const PRESET_IDS = PRESETS.map((p) => p.id);

export function isPresetId(id: string): id is PresetId {
  return (PRESET_IDS as string[]).includes(id);
}

/** 'tok@1' → 'tok'. 합성기가 버전 접미사를 떼고 찾을 때 쓴다. */
export function presetBase(id: string): string {
  return id.split('@')[0];
}
