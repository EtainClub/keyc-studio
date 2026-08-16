/**
 * 재질 8종 (v2.5).
 *
 * 재질은 외형 하나가 아니라 **소리·움직임·빛·느낌을 한꺼번에 갈아끼우는 묶음**이다.
 * 로드맵이 개별 옵션으로 풀지 말라고 못 박은 이유가 이것이다: 아이가 고르는 것은
 * "얼음"이지 "pop 애니메이션 + flash LED + 높은 음정"이 아니다. 여덟 가지를 따로
 * 고르게 하면 편집기가 설정 화면이 되고, 그 순간 아무도 안 만진다.
 *
 * ## 고를 때 적용된다. 재생할 때 해석하지 않는다.
 *
 * `materialPatch`는 motion/led/haptic/sound를 **키에 그대로 써 넣는다.** 재질에서
 * 파생해 렌더 시점에 계산하지 않는다 — 그렇게 하면 이 표를 한 줄 손보는 날
 * 과거 작품 전체가 다르게 재생된다. types.ts가 프리셋에 `@1`을 붙이라고 하는 것과
 * 같은 규칙이고, 여기서는 아예 값을 복사해 그 문제를 없앤다.
 *
 * 저장되는 것은 `material` 값 하나뿐이라 스키마 변경도 마이그레이션도 없다.
 * 재질이 화면에서 갖는 몫(표면 질감)만 `.mat-*` CSS가 `material`을 보고 그린다.
 */

import { t } from '../i18n';
import type { Haptic, KeyDef, Led, Material, Motion } from '../work-model/types';
import type { PresetId } from '../work-model/presets';

export type MaterialSpec = {
  id: Material;
  label: string;
  emoji: string;
  /** 이 재질을 고르는 순간 키에 함께 써 넣는 값들. */
  bundle: {
    motion: Motion;
    led: Led;
    haptic: Haptic;
    presetId: PresetId;
    /** SoundTab의 PITCH_STEPS에 있는 값만 쓴다 — 안 그러면 소리 탭에 켜진 칩이 없다. */
    pitch: number;
  };
};

/**
 * 순서는 아이가 아는 순서다. 플라스틱이 먼저인 것은 그것이 기본값이고,
 * "원래대로"로 돌아올 자리가 목록 맨 앞에 있어야 하기 때문이다.
 */
export const MATERIALS: MaterialSpec[] = [
  {
    id: 'plastic',
    label: t('material.plastic'),
    emoji: '⌨️',
    bundle: {
      motion: 'squish@1',
      led: 'flash@1',
      haptic: 'tok',
      presetId: 'realTactile9@1',
      pitch: 1,
    },
  },
  {
    id: 'jelly',
    label: t('material.jelly'),
    emoji: '🍮',
    // 말랑하니까 오래 튕긴다(tongtong). 빛도 깜빡이 아니라 속에서 배어 나온다.
    bundle: {
      motion: 'squish@1',
      led: 'breath@1',
      haptic: 'tongtong',
      presetId: 'ppyong@1',
      pitch: 1.35,
    },
  },
  {
    id: 'ice',
    label: t('material.ice'),
    emoji: '🧊',
    // 얼음은 눌리지 않고 **깨진다** — 그래서 squish가 아니라 pop이고, 소리가 가장 높다.
    bundle: {
      motion: 'pop@1',
      led: 'flash@1',
      haptic: 'tok',
      presetId: 'chak@1',
      pitch: 1.8,
    },
  },
  {
    id: 'metal',
    label: t('material.metal'),
    emoji: '🔩',
    bundle: {
      motion: 'shake@1',
      led: 'rainbow@1',
      haptic: 'kung',
      presetId: 'realMxBlue@1',
      pitch: 0.8,
    },
  },
  {
    id: 'water',
    label: t('material.water'),
    emoji: '💧',
    bundle: {
      motion: 'melt@1',
      led: 'breath@1',
      haptic: 'bureure',
      presetId: 'ttok@1',
      pitch: 1.35,
    },
  },
  {
    id: 'cotton',
    label: t('material.cotton'),
    emoji: '☁️',
    // 솜은 소리도 빛도 삼킨다. led를 끄는 유일한 이유가 그것이다.
    bundle: {
      motion: 'squish@1',
      led: 'none',
      haptic: 'bureure',
      presetId: 'tok@1',
      pitch: 0.8,
    },
  },
  {
    id: 'wood',
    label: t('material.wood'),
    emoji: '🪵',
    bundle: {
      motion: 'jump@1',
      led: 'none',
      haptic: 'kkuk',
      presetId: 'realTactile14@1',
      pitch: 0.8,
    },
  },
  {
    id: 'sand',
    label: t('material.sand'),
    emoji: '🏜️',
    bundle: {
      motion: 'melt@1',
      led: 'none',
      haptic: 'kkuk',
      presetId: 'dung@1',
      pitch: 0.6,
    },
  },
];

export const MATERIAL_BY_ID: Record<Material, MaterialSpec> = Object.fromEntries(
  MATERIALS.map((m) => [m.id, m]),
) as Record<Material, MaterialSpec>;

/**
 * 재질을 고르면 키가 어떻게 바뀌는가.
 *
 * **직접 녹음한 소리는 절대 건드리지 않는다.** 아이가 제 목소리를 넣어 둔 키에서
 * 재질을 한 번 눌렀다고 그 녹음이 사라지면, 그건 재미가 아니라 사고다.
 * 그 경우 음정도 그대로 둔다 — 목소리는 아이 것이고, 재질이 정할 것이 아니다.
 *
 * 나머지(움직임·빛·느낌)는 묶음의 핵심이라 언제나 함께 바뀐다. 아이가 그 뒤에
 * 움직임만 따로 바꾸는 것도 물론 된다 — 재질은 시작점이지 잠금이 아니다.
 */
export function materialPatch(keyDef: KeyDef, id: Material): Partial<KeyDef> {
  const { bundle } = MATERIAL_BY_ID[id];
  const ownRecording = keyDef.sound.assetId !== null;

  return {
    material: id,
    motion: bundle.motion,
    led: bundle.led,
    haptic: bundle.haptic,
    sound: ownRecording
      ? keyDef.sound
      : { ...keyDef.sound, assetId: null, presetId: bundle.presetId, pitch: bundle.pitch },
  };
}
