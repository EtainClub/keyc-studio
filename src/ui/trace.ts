/**
 * 흔적 — 키를 누를 때 화면에 남는 스탬프.
 *
 * 이 모듈은 DOM을 모른다. **어디에 / 얼마만 하게 / 몇 도 기울여** 찍을지를
 * (seed, eventIndex)에서 유도하는 순수 함수와 목록뿐이다.
 *
 * 왜 순수 함수이고 왜 결정론인가:
 * 작품은 mp4가 아니라 리플레이다. 감상자의 기기에서 매번 다시 계산되므로,
 * Math.random()을 한 번이라도 쓰면 만든 아이가 본 그림과 남이 보는 그림이
 * 달라진다. 난수는 전부 rng.ts의 (seed, eventIndex, purpose) 해시에서 뽑는다.
 */

import { t } from '../i18n';
import { PURPOSE, rndRange } from '../work-model/rng';
import { DEFAULT_COLORS } from '../work-model/defaults';
import type { KeyIndex, TraceType } from '../work-model/types';

/**
 * 화면에 동시에 떠 있을 수 있는 스탬프 수.
 *
 * 130bpm 15초 공연에서 4개 키를 매 박자 반복시키면 스탬프는 100개를 넘는다.
 * 넘치면 **가장 오래된 것부터** 지운다 — 무작위로 지우면 같은 작품이
 * 재생할 때마다 다른 그림이 된다.
 */
export const MAX_STAMPS = 28;

/**
 * 스탬프 하나의 수명(ms). 이 안에서 나타나고, 머물고, 사라진다.
 * CSS의 `trace-pop` 길이와 반드시 같아야 한다 — 이 값으로
 * animation-duration을 직접 넣고, animationend에서 노드를 뗀다.
 */
export const STAMP_LIFE_MS = 4200;

/**
 * 스탬프 하나의 배치.
 *
 * 가로도 세로도 화면 좌표가 아니라 **누른 키캡을 기준으로 한 상대값**이다.
 * 화면 %로 잡으면 안 되는 이유가 둘 있다:
 *   - `.screen`은 `max-width: 520px`으로 가운데 정렬된다. 넓은 창에서 화면 %는
 *     키캡이 실제로 있는 자리와 어긋나, 발자국이 엉뚱한 데서 튀어나온다.
 *   - 키보드 상판은 `margin-block: auto`라 화면 높이에 따라 오르내린다.
 * 실제 픽셀은 키캡과 상판의 위치를 재서 TraceLayer가 정한다 —
 * 이 모듈은 끝까지 DOM을 모른다.
 */
export type TraceSpot = {
  /** 누른 키캡 중심에서 좌우로 얼마나 벗어나는가. -1 ~ 1. */
  xOffset: number;
  /** 찍을 수 있는 세로 띠 안에서의 위치. 0 = 맨 위, 1 = 상판 바로 위. */
  yFrac: number;
  sizePx: number;
  angleDeg: number;
};

const SIZE_MIN = 40;
const SIZE_MAX = 76;
const MAX_ANGLE = 34;

/** 이 이벤트의 스탬프가 놓일 자리. 같은 입력이면 언제 어디서 계산해도 같은 값이다. */
export function traceSpot(seed: number, eventIndex: number, key: KeyIndex): TraceSpot {
  return {
    // 키 번호를 용도에 섞는다. 안 그러면 같은 이벤트에서 네 키가 같은 값을 뽑는다.
    xOffset: rndRange(seed, eventIndex, PURPOSE.posX + key * 16, -1, 1),
    yFrac: rndRange(seed, eventIndex, PURPOSE.posY + key * 16, 0, 1),
    sizePx: rndRange(seed, eventIndex, PURPOSE.size, SIZE_MIN, SIZE_MAX),
    angleDeg: rndRange(seed, eventIndex, PURPOSE.angle, -MAX_ANGLE, MAX_ANGLE),
  };
}

/**
 * 실제로 그릴 수 있는 흔적인가.
 *
 * `TraceType`에는 v2.5용 `star@1` / `flower@1`이 이미 들어 있다(types.ts).
 * 그리는 법을 모르는 타입이 오면 **아무것도 찍지 않는다** — 빈 네모가
 * 화면에 떠다니는 것보다 없는 편이 낫다.
 */
export function isDrawable(type: TraceType): boolean {
  return type === 'catPaw@1';
}

/**
 * 편집 시트에 노출하는 목록.
 *
 * v1.6은 발자국 한 종만 낸다. 목록에 없는 타입은 화면에도 없다(isDrawable).
 * i18n 키가 `trail.*`인 이유: `trace.*`는 사진 선 따기가 이미 쓰고 있다.
 */
export const TRACES: { id: TraceType; label: string; emoji: string }[] = [
  { id: 'none', label: t('trail.none'), emoji: '⚪' },
  { id: 'catPaw@1', label: t('trail.catPaw'), emoji: '🐾' },
];

/**
 * 흔적 색. 어두운 보라 배경 위에서 그대로 보이는 것만 고른다.
 * 라벨은 키캡 색 라벨을 그대로 쓴다 — 아이에게 같은 색은 같은 이름이어야 한다.
 */
export const TRACE_COLORS: { c: string; label: string }[] = [
  { c: '#FFFFFF', label: t('edit.capColor.white') },
  { c: DEFAULT_COLORS[0], label: t('edit.capColor.pink') },
  { c: DEFAULT_COLORS[1], label: t('edit.capColor.yellow') },
  { c: DEFAULT_COLORS[2], label: t('edit.capColor.green') },
  { c: DEFAULT_COLORS[3], label: t('edit.capColor.blue') },
  { c: '#B98CFF', label: t('edit.capColor.purple') },
];
