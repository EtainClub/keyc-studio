/**
 * 흔적 — 키를 누를 때 화면에 남는 스탬프.
 *
 * 이 모듈은 DOM을 모른다. **어디에 / 얼마만 하게 / 몇 도 기울여 / 어디로 걸어갈지**를
 * (seed, eventIndex)에서 유도하는 순수 함수와 목록뿐이다.
 *
 * 왜 순수 함수이고 왜 결정론인가:
 * 작품은 mp4가 아니라 리플레이다. 감상자의 기기에서 매번 다시 계산되므로,
 * Math.random()을 한 번이라도 쓰면 만든 아이가 본 그림과 남이 보는 그림이
 * 달라진다. 난수는 전부 rng.ts의 (seed, eventIndex, purpose) 해시에서 뽑는다.
 * v2.5의 이동형이 걸어가는 방향도 예외가 아니다.
 */

import { t } from '../i18n';
import { PURPOSE, rndRange } from '../work-model/rng';
import type { KeyIndex, TraceBehavior, TraceType } from '../work-model/types';

/**
 * 화면에 동시에 떠 있을 수 있는 스탬프 수 — **행동마다 다르다.**
 *
 * 하나의 숫자로 둘 수 없는 이유가 분명하다. 사라지는 흔적에서 밀도는 곧 지저분함이고
 * (v1.6에서 36개는 한 덩어리로 뭉쳐 보였다), 성장형에서 밀도는 곧 **작품 그 자체**다.
 * 빈 나무에 꽃이 28송이에서 멈추면 그건 성장이 아니다.
 *
 * 넘치면 **가장 오래된 것부터** 지운다 — 무작위로 지우면 같은 작품이 재생할 때마다
 * 다른 그림이 된다.
 */
export const MAX_STAMPS: Record<TraceBehavior, number> = {
  fade: 28,
  grow: 72,
  walk: 28,
};

/**
 * 스탬프 하나의 애니메이션 길이(ms). CSS 키프레임 길이와 **반드시** 같아야 한다 —
 * 이 값으로 animation-duration을 직접 넣고, animationend에서 노드를 뗀다.
 *
 * grow만 짧은 것은 그 애니메이션이 "사라지는 과정"이 아니라 **찍히는 순간**뿐이기
 * 때문이다. 끝난 뒤에도 노드는 남는다(TraceLayer가 grow는 animationend에서 안 뗀다).
 * walk가 가장 긴 것은 걸어갈 시간이 필요해서다.
 */
export const STAMP_LIFE_MS: Record<TraceBehavior, number> = {
  fade: 4200,
  grow: 900,
  walk: 5600,
};

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
 *
 * drift만 예외로 px다. 걸어가는 거리는 키캡 크기가 아니라 **화면에서 눈에 보이는
 * 거리**의 문제라, 상대값으로 두면 좁은 화면에서 제자리걸음이 된다.
 */
export type TraceSpot = {
  /** 누른 키캡 중심에서 좌우로 얼마나 벗어나는가. -1 ~ 1. */
  xOffset: number;
  /** 찍을 수 있는 세로 띠 안에서의 위치. 0 = 맨 위, 1 = 상판 바로 위. */
  yFrac: number;
  sizePx: number;
  angleDeg: number;
  /** 이동형이 걸어가는 거리(px). behavior가 'walk'가 아니면 쓰이지 않는다. */
  driftXPx: number;
  driftYPx: number;
};

const SIZE_MIN = 40;
const SIZE_MAX = 76;
const MAX_ANGLE = 34;
const DRIFT_MIN = 90;
const DRIFT_MAX = 220;
/** 가로로 간 만큼의 몇 배를 위로 오르는가. 0이면 옆으로만 미끄러진다. */
const DRIFT_RISE = 0.45;

/** 이 이벤트의 스탬프가 놓일 자리. 같은 입력이면 언제 어디서 계산해도 같은 값이다. */
export function traceSpot(seed: number, eventIndex: number, key: KeyIndex): TraceSpot {
  const dist = rndRange(seed, eventIndex, PURPOSE.driftDist, DRIFT_MIN, DRIFT_MAX);
  // -1 왼쪽 … 1 오른쪽. 0 근처면 거의 곧장 위로 걸어간다.
  const dirX = rndRange(seed, eventIndex, PURPOSE.driftAngle, -1, 1);

  return {
    // 키 번호를 용도에 섞는다. 안 그러면 같은 이벤트에서 네 키가 같은 값을 뽑는다.
    xOffset: rndRange(seed, eventIndex, PURPOSE.posX + key * 16, -1, 1),
    yFrac: rndRange(seed, eventIndex, PURPOSE.posY + key * 16, 0, 1),
    sizePx: rndRange(seed, eventIndex, PURPOSE.size, SIZE_MIN, SIZE_MAX),
    angleDeg: rndRange(seed, eventIndex, PURPOSE.angle, -MAX_ANGLE, MAX_ANGLE),
    driftXPx: dirX * dist,
    /*
     * **언제나 위로 간다.** 아래로 걸어가면 상판을 밟고 지나가며 아이가 그린
     * 키캡 그림을 가린다. 흔적이 주는 재미보다 그게 훨씬 크게 잃는 것이다.
     */
    driftYPx: -dist * DRIFT_RISE,
  };
}

/**
 * 모양마다 CSS 클래스가 하나씩.
 *
 * 여기가 **모양의 유일한 명부**다. `TraceType`에 값을 추가하고 이 표를 빠뜨리면
 * 편집 시트 목록에는 뜨는데 화면에는 아무것도 안 찍힌다 — 화면에 오류도 안 난다.
 * `trace.test.ts`가 목록과 이 표를 맞대어 그 실수를 잡는다.
 *
 * 클래스 이름 문자열이 이 순수 모듈에 있는 것이 어색해 보일 수 있지만, DOM을
 * 만지지는 않는다. 명부와 목록(`TRACES`)이 **한 파일 안에 있어야** 둘이 어긋난
 * 것을 시험으로 붙잡을 수 있다.
 */
export const TRACE_SHAPE_CLASS: Partial<Record<TraceType, string>> = {
  'catPaw@1': 'trace-cat-paw',
  'dogPaw@1': 'trace-dog-paw',
  'birdFoot@1': 'trace-bird-foot',
  'dinoFoot@1': 'trace-dino-foot',
  'star@1': 'trace-star',
  'flower@1': 'trace-flower',
  'flame@1': 'trace-flame',
  'bolt@1': 'trace-bolt',
  'myStamp@1': 'trace-my-stamp',
};

/**
 * 실제로 그릴 수 있는 흔적인가.
 *
 * "'none'이 아닌가"가 아니라 **"그릴 모양을 아는가"**를 묻는다. 그래야 모양을
 * 안 만든 채 타입만 늘렸을 때 여기서 걸린다.
 *
 * `myStamp@1`은 여기서 true지만 실제로 찍히려면 `trace.assetId`의 그림이 있어야
 * 한다. 그 판단은 그림 URL을 쥐고 있는 TraceLayer의 몫이다.
 */
export function isDrawable(type: TraceType): boolean {
  return TRACE_SHAPE_CLASS[type] !== undefined;
}

/**
 * 편집 시트에 노출하는 목록.
 *
 * 발자국 넷을 앞에 몰아 둔다 — 아이가 고르는 첫 질문은 "무슨 모양"이 아니라
 * **"누가 지나갔나"**이고, 그 넷이 서로의 대안이기 때문이다.
 *
 * i18n 키가 `trail.*`인 이유: `trace.*`는 사진 선 따기가 이미 쓰고 있다.
 */
export const TRACES: { id: TraceType; label: string; emoji: string }[] = [
  { id: 'none', label: t('trail.none'), emoji: '⚪' },
  { id: 'catPaw@1', label: t('trail.catPaw'), emoji: '🐾' },
  { id: 'dogPaw@1', label: t('trail.dogPaw'), emoji: '🐶' },
  { id: 'birdFoot@1', label: t('trail.birdFoot'), emoji: '🐦' },
  { id: 'dinoFoot@1', label: t('trail.dinoFoot'), emoji: '🦖' },
  { id: 'star@1', label: t('trail.star'), emoji: '⭐' },
  { id: 'flower@1', label: t('trail.flower'), emoji: '🌸' },
  { id: 'flame@1', label: t('trail.flame'), emoji: '🔥' },
  { id: 'bolt@1', label: t('trail.bolt'), emoji: '⚡' },
  { id: 'myStamp@1', label: t('trail.myStamp'), emoji: '✏️' },
];

/**
 * 흔적이 찍힌 뒤 무엇을 하는가.
 *
 * 아이에게는 "사라져요 / 쌓여요 / 걸어가요"로 보인다. 애니메이션 이름도 지속시간
 * 숫자도 노출하지 않는다 — 로드맵 5번이 반복 설정에서 정한 것과 같은 규칙이다.
 */
export const TRACE_BEHAVIORS: { id: TraceBehavior; label: string; emoji: string }[] = [
  { id: 'fade', label: t('trail.behavior.fade'), emoji: '💨' },
  { id: 'grow', label: t('trail.behavior.grow'), emoji: '🌱' },
  { id: 'walk', label: t('trail.behavior.walk'), emoji: '🚶' },
];

/*
 * 흔적 색은 `ui/palette.ts`의 목록을 그대로 쓴다 — 아이에게 같은 색은 같은
 * 이름이어야 하고, 그건 두 목록을 나란히 두는 것으로는 지켜지지 않는다.
 *
 * 직접 그린 스탬프에는 이 색이 적용되지 않는다. 그건 아이가 이미 색까지 정해
 * 그린 그림이라, 위에서 다시 칠하면 그 선택을 덮어쓰는 것이 된다.
 */
