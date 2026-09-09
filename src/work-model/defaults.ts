/**
 * 기본값.
 *
 * 설계 원칙: 빈 캔버스 금지.
 * 4개 키캡은 색·소리·움직임·느낌이 모두 채워진 상태로 시작하고,
 * 아이는 "바꾸고 싶은 것만" 바꾼다. 아무것도 안 바꿔도 공연으로 진행할 수 있다.
 */

import { customAlphabet } from 'nanoid';
import { newSeed } from './rng';
import { durationForTempo } from './timing';
import {
  ASSET_ID_LENGTH,
  ENGINE_VERSION,
  PRESET_VERSION,
  SCHEMA_VERSION,
  SECRET_ID_LENGTH,
  WORK_ID_LENGTH,
  tempoOf,
  type Haptic,
  type KeyDef,
  type KeyIndex,
  type Motion,
  type Work,
} from './types';
import type { PresetId } from './presets';

// URL에 그대로 들어가므로 헷갈리는 글자를 뺀 알파벳을 쓴다.
const ALPHABET = '346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtuvwxy';
const workId = customAlphabet(ALPHABET, WORK_ID_LENGTH);
const assetId = customAlphabet(ALPHABET, ASSET_ID_LENGTH);
const secretId = customAlphabet(ALPHABET, SECRET_ID_LENGTH);

export const DEFAULT_COLORS = ['#ED7088', '#DFB127', '#47B968', '#4FA3F4'] as const;

const DEFAULT_SOUNDS: PresetId[] = [
  'realTactile9@1',
  'realTactile8@1',
  'realTactile14@1',
  'realMxBlue@1',
];
const DEFAULT_MOTIONS: Motion[] = ['squish@1', 'jump@1', 'pop@1', 'shake@1'];
const DEFAULT_HAPTICS: Haptic[] = ['tok', 'kkuk', 'tongtong', 'kung'];

export function newWorkId(): string {
  return workId();
}

export function newAssetId(): string {
  return assetId();
}

export function newSecretId(): string {
  return secretId();
}

export function createDefaultKey(idx: KeyIndex): KeyDef {
  return {
    idx,
    appearance: {
      baseColor: DEFAULT_COLORS[idx],
      artAssetId: null,
      face: 'none',
    },
    material: 'plastic',
    sound: {
      assetId: null,
      presetId: DEFAULT_SOUNDS[idx],
      pitch: 1,
      gain: 0.9,
    },
    motion: DEFAULT_MOTIONS[idx],
    led: 'flash@1',
    loop: { enabled: false, everyBeats: 2, offsetBeats: 0 },
    haptic: DEFAULT_HAPTICS[idx],
    trace: { type: 'none', color: '#FFFFFF', behavior: 'fade', assetId: null },
  };
}

export function createDefaultKeys(): Work['keys'] {
  return [
    createDefaultKey(0),
    createDefaultKey(1),
    createDefaultKey(2),
    createDefaultKey(3),
  ];
}

/**
 * 새 작품은 **로컬 전용**으로 시작한다.
 * authorUid가 null이라는 것은 "아직 계정이 없다"는 사실 그대로의 표현이다.
 * 계정은 공유를 누르는 순간 처음 만들어진다.
 */
export function createWork(params: { authorNick: string; id?: string }): Work {
  const tempo = tempoOf('normal');
  return {
    id: params.id ?? newWorkId(),
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    presetVersion: PRESET_VERSION,
    title: '',
    hint: '',
    authorNick: params.authorNick,
    authorUid: null,
    createdAt: Date.now(),
    tempo,
    keys: createDefaultKeys(),
    assets: [],
    replay: { seed: newSeed(), durationMs: durationForTempo(tempo), events: [] },
    secrets: [],
    visibility: 'local',
  };
}

export { KEY_COUNT } from './types';
