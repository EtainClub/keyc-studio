/**
 * 결정론적 난수.
 *
 * 핵심: **스트림이 아니라 해시다.**
 *
 * 순차 PRNG를 쓰면 공연 중 UI가 난수를 한 번이라도 더 뽑는 순간
 * (호버 반짝임, 로딩 애니메이션, 개발자가 나중에 추가한 파티클 하나)
 * 그 이후 모든 값이 밀려서 리플레이가 통째로 달라진다.
 * 그런 버그는 재현이 안 되고, 사용자 신고로만 알게 된다.
 *
 * 그래서 모든 무작위 값은 (seed, 이벤트 인덱스, 용도)에서 **직접 유도**한다.
 * 순서 의존성이 없으므로 리플레이 중간부터 탐색해도 값이 같다.
 */

export function splitmix32(x: number): number {
  x = (x + 0x9e3779b9) | 0;
  let z = x;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
}

/** 용도 상수. 새 용도가 필요하면 여기에 추가만 하고 기존 값은 절대 바꾸지 않는다. */
export const PURPOSE = {
  posX: 0,
  posY: 1,
  size: 2,
  angle: 3,
  hue: 4,
  variant: 5,
  /** 이동형 흔적이 걸어가는 방향과 거리 (v2.5). */
  driftAngle: 6,
  driftDist: 7,
} as const;

export type Purpose = (typeof PURPOSE)[keyof typeof PURPOSE];

/** 0 이상 1 미만. */
export function rnd(seed: number, eventIndex: number, purpose: number): number {
  return splitmix32(seed ^ Math.imul(eventIndex + 1, 0x2545f491) ^ (purpose * 0x27d4eb2f));
}

export function rndRange(
  seed: number,
  eventIndex: number,
  purpose: number,
  min: number,
  max: number,
): number {
  return min + rnd(seed, eventIndex, purpose) * (max - min);
}

export function rndInt(
  seed: number,
  eventIndex: number,
  purpose: number,
  minInclusive: number,
  maxExclusive: number,
): number {
  return (
    minInclusive +
    Math.floor(rnd(seed, eventIndex, purpose) * (maxExclusive - minInclusive))
  );
}

/**
 * 자동 반복으로 발생한 노트는 이벤트 인덱스가 없다.
 * 음수 공간을 써서 사용자 이벤트와 충돌하지 않게 한다.
 */
export function loopEventIndex(beatIndex: number, key: number): number {
  return -(beatIndex * 4 + key + 1);
}

/** 공연마다 새로 뽑는 seed. */
export function newSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
