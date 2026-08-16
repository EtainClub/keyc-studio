/**
 * 재질 묶음 프리셋 (v2.5).
 *
 * 여기서 지키려는 것은 둘이다:
 *   ① 재질을 고르면 **정말로 묶음이 적용된다** — 표에만 있고 안 붙으면 아무 일도 안 난다
 *   ② 아이가 직접 녹음한 소리는 **어떤 경우에도** 사라지지 않는다
 */

import { describe, expect, it } from 'vitest';
import { MATERIALS, MATERIAL_BY_ID, materialPatch } from './material';
import { LEDS, MOTIONS, HAPTIC_ORDER } from './feel';
import { createDefaultKey } from '../work-model/defaults';
import { isPresetId } from '../work-model/presets';
import type { Material } from '../work-model/types';

const ALL: Material[] = [
  'plastic',
  'jelly',
  'ice',
  'metal',
  'water',
  'cotton',
  'wood',
  'sand',
];

describe('재질 표', () => {
  it('로드맵이 말한 8종이 빠짐없이 있다', () => {
    expect(MATERIALS.map((m) => m.id).sort()).toEqual([...ALL].sort());
  });

  it('묶음이 가리키는 값은 전부 실제로 있는 것이다', () => {
    /*
     * 오타 하나면 조용히 깨진다. motion이 틀리면 CSS 클래스가 안 붙어 키캡이
     * 안 움직이고, presetId가 틀리면 사운드 뱅크에서 못 찾아 소리가 사라진다.
     * 둘 다 화면에는 아무 오류도 안 낸다.
     */
    for (const m of MATERIALS) {
      expect(MOTIONS.some((x) => x.id === m.bundle.motion)).toBe(true);
      expect(LEDS.some((x) => x.id === m.bundle.led)).toBe(true);
      expect(HAPTIC_ORDER).toContain(m.bundle.haptic);
      expect(isPresetId(m.bundle.presetId)).toBe(true);
    }
  });

  it('음정은 소리 탭이 내놓는 단계 중 하나다', () => {
    // 목록에 없는 값을 쓰면 소리 탭에 켜진 칩이 하나도 없어, 아이 눈에는 고장이다.
    const STEPS = [0.6, 0.8, 1, 1.35, 1.8];
    for (const m of MATERIALS) {
      expect(STEPS).toContain(m.bundle.pitch);
    }
  });

  it('여덟 가지가 서로 다르다 — 같은 묶음이 둘이면 하나는 있으나 마나다', () => {
    const shapes = MATERIALS.map((m) => JSON.stringify(m.bundle));
    expect(new Set(shapes).size).toBe(MATERIALS.length);
  });
});

describe('materialPatch', () => {
  it('움직임·빛·느낌을 묶음 그대로 갈아끼운다', () => {
    const key = createDefaultKey(0);
    for (const id of ALL) {
      const patch = materialPatch(key, id);
      const { bundle } = MATERIAL_BY_ID[id];
      expect(patch.material).toBe(id);
      expect(patch.motion).toBe(bundle.motion);
      expect(patch.led).toBe(bundle.led);
      expect(patch.haptic).toBe(bundle.haptic);
    }
  });

  it('프리셋 소리를 쓰던 키는 재질의 소리로 바뀐다', () => {
    const key = createDefaultKey(0);
    const patch = materialPatch(key, 'ice');
    expect(patch.sound?.presetId).toBe(MATERIAL_BY_ID.ice.bundle.presetId);
    expect(patch.sound?.pitch).toBe(MATERIAL_BY_ID.ice.bundle.pitch);
  });

  it('직접 녹음한 소리는 재질을 바꿔도 그대로다', () => {
    /*
     * 이 앱에서 가장 되돌리기 어려운 손실이다. 아이 목소리는 다시 녹음해도
     * 같은 것이 안 나온다. 재질 칩 한 번에 그게 날아가면 사고다.
     */
    const key = createDefaultKey(0);
    const withVoice = { ...key, sound: { ...key.sound, assetId: 'myVoice1', presetId: null } };

    for (const id of ALL) {
      const patch = materialPatch(withVoice, id);
      expect(patch.sound?.assetId).toBe('myVoice1');
      expect(patch.sound?.presetId).toBeNull();
      // 음정도 건드리지 않는다 — 목소리는 아이 것이고 재질이 정할 것이 아니다.
      expect(patch.sound?.pitch).toBe(withVoice.sound.pitch);
      // 소리만 지키는 것이지, 나머지 묶음은 그대로 적용된다.
      expect(patch.motion).toBe(MATERIAL_BY_ID[id].bundle.motion);
    }
  });

  it('재질만 바꾸고 그림·반복·흔적은 손대지 않는다', () => {
    const patch = materialPatch(createDefaultKey(2), 'wood');
    expect(patch.appearance).toBeUndefined();
    expect(patch.loop).toBeUndefined();
    expect(patch.trace).toBeUndefined();
  });
});
