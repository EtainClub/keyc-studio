/**
 * 흔적 배치.
 *
 * 여기서 지키려는 것은 하나다: **같은 작품은 누가 몇 번을 재생해도 같은 그림이다.**
 * 작품은 mp4가 아니라 리플레이라, 배치가 조금이라도 흔들리면 만든 아이가 본 화면과
 * 남이 보는 화면이 달라진다.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_STAMPS,
  STAMP_LIFE_MS,
  TRACES,
  TRACE_BEHAVIORS,
  TRACE_SHAPE_CLASS,
  isDrawable,
  traceSpot,
} from './trace';
import type { KeyIndex } from '../work-model/types';

const KEYS: KeyIndex[] = [0, 1, 2, 3];

describe('traceSpot', () => {
  it('같은 (seed, eventIndex, key)는 언제 계산해도 같은 자리를 준다', () => {
    const a = traceSpot(123456, 7, 2);
    const b = traceSpot(123456, 7, 2);
    expect(a).toEqual(b);
  });

  it('이벤트가 다르면 자리도 다르다 — 같은 곳에 겹쳐 찍히지 않는다', () => {
    const spots = Array.from({ length: 40 }, (_, i) => traceSpot(99, i, 1));
    const unique = new Set(spots.map((s) => `${s.xOffset}:${s.yFrac}`));
    expect(unique.size).toBe(spots.length);
  });

  it('같은 이벤트라도 키가 다르면 다른 자리에 찍힌다', () => {
    // 두 키가 같은 비트에 함께 울릴 때 발자국이 정확히 포개지면 하나로 보인다.
    const spots = KEYS.map((k) => traceSpot(31337, 12, k));
    const unique = new Set(spots.map((s) => `${s.xOffset}:${s.yFrac}`));
    expect(unique.size).toBe(KEYS.length);
  });

  it('seed가 다르면 공연마다 다른 그림이 된다', () => {
    expect(traceSpot(1, 5, 0)).not.toEqual(traceSpot(2, 5, 0));
  });

  it('루프가 쓰는 음수 인덱스에서도 정상 동작한다', () => {
    // loopEventIndex()는 -1부터 내려가는 값을 준다. 여기서 NaN이 나오면 화면에서 사라진다.
    const spot = traceSpot(42, -17, 3);
    expect(Number.isFinite(spot.xOffset)).toBe(true);
    expect(Number.isFinite(spot.yFrac)).toBe(true);
  });

  it('배치 값은 정해진 범위를 벗어나지 않는다', () => {
    for (const key of KEYS) {
      for (let i = -50; i < 200; i++) {
        const s = traceSpot(7777, i, key);
        /*
         * 전부 누른 키캡 기준의 상대값이다. 실제 픽셀은 TraceLayer가 키캡과
         * 상판의 위치를 재서 정한다 — 이 모듈은 화면 크기를 모른다.
         */
        expect(s.xOffset).toBeGreaterThanOrEqual(-1);
        expect(s.xOffset).toBeLessThan(1);
        expect(s.yFrac).toBeGreaterThanOrEqual(0);
        expect(s.yFrac).toBeLessThan(1);
        expect(s.sizePx).toBeGreaterThanOrEqual(40);
        expect(s.sizePx).toBeLessThan(76);
        expect(Math.abs(s.angleDeg)).toBeLessThanOrEqual(34);
      }
    }
  });
});

describe('이동형 흔적의 방향 (v2.5)', () => {
  it('걸어가는 거리도 (seed, eventIndex)에서 나온다 — 다시 봐도 같은 길이다', () => {
    const a = traceSpot(555, 9, 1);
    const b = traceSpot(555, 9, 1);
    expect(a.driftXPx).toBe(b.driftXPx);
    expect(a.driftYPx).toBe(b.driftYPx);
  });

  it('언제나 위로 걸어간다 — 아래로 가면 키캡 그림을 밟는다', () => {
    for (const key of KEYS) {
      for (let i = -50; i < 200; i++) {
        expect(traceSpot(4242, i, key).driftYPx).toBeLessThan(0);
      }
    }
  });

  it('좌우 양쪽으로 모두 걸어간다 — 한쪽으로만 몰리면 흩어지지 않는다', () => {
    const xs = Array.from({ length: 120 }, (_, i) => traceSpot(8080, i, 2).driftXPx);
    expect(xs.some((x) => x < 0)).toBe(true);
    expect(xs.some((x) => x > 0)).toBe(true);
  });
});

describe('흔적 목록', () => {
  it('편집 시트에 내놓는 것은 전부 실제로 그릴 수 있는 것뿐이다', () => {
    for (const tr of TRACES) {
      if (tr.id === 'none') continue;
      expect(isDrawable(tr.id)).toBe(true);
    }
  });

  it('흔적 없음은 아무것도 찍지 않는다', () => {
    expect(isDrawable('none')).toBe(false);
  });

  /*
   * 목록과 모양 명부는 **정확히 같아야** 한다.
   *
   * 어긋나는 두 방향 모두 조용히 망가진다:
   *   · 목록에만 있으면 → 아이가 고를 수 있는데 눌러도 아무것도 안 찍힌다
   *   · 명부에만 있으면 → 그려 놓고 아무도 못 고르는 모양이 남는다
   * 흔적이 여덟 가지로 늘어난 지금은 하나 빠뜨리기가 충분히 쉽다.
   */
  it('목록과 모양 명부가 정확히 일치한다', () => {
    const listed = TRACES.map((tr) => tr.id).filter((id) => id !== 'none');
    expect([...listed].sort()).toEqual(Object.keys(TRACE_SHAPE_CLASS).sort());
  });

  it('CSS 클래스 이름이 겹치지 않는다', () => {
    // 둘이 같은 클래스를 쓰면 나중에 정의된 모양이 앞엣것을 덮어쓴다.
    const classes = Object.values(TRACE_SHAPE_CLASS);
    expect(new Set(classes).size).toBe(classes.length);
  });

  /*
   * 이 둘은 v1.6에서 "타입에만 있고 못 그리던" 것이었다. v2.5에서 열렸다.
   * 다시 닫히면 목록에는 남고 화면에는 안 나오는 상태가 되므로 여기서 잡는다.
   */
  it('v2.5에서 별과 꽃이 열렸다', () => {
    expect(isDrawable('star@1')).toBe(true);
    expect(isDrawable('flower@1')).toBe(true);
  });

  it('동물 발자국 네 종이 모두 그려진다', () => {
    for (const id of ['catPaw@1', 'dogPaw@1', 'birdFoot@1', 'dinoFoot@1'] as const) {
      expect(isDrawable(id)).toBe(true);
    }
  });

  it('행동 세 가지는 상한과 길이를 모두 갖고 있다', () => {
    // 하나라도 빠지면 그 행동으로 찍은 스탬프의 animation-duration이 undefined가 된다.
    for (const b of TRACE_BEHAVIORS) {
      expect(MAX_STAMPS[b.id]).toBeGreaterThan(0);
      expect(STAMP_LIFE_MS[b.id]).toBeGreaterThan(0);
    }
  });

  it('쌓이는 흔적의 상한이 사라지는 흔적보다 크다', () => {
    // 성장형에서 밀도는 지저분함이 아니라 작품 그 자체다.
    expect(MAX_STAMPS.grow).toBeGreaterThan(MAX_STAMPS.fade);
  });
});
