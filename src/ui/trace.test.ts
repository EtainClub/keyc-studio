/**
 * 흔적 배치.
 *
 * 여기서 지키려는 것은 하나다: **같은 작품은 누가 몇 번을 재생해도 같은 그림이다.**
 * 작품은 mp4가 아니라 리플레이라, 배치가 조금이라도 흔들리면 만든 아이가 본 화면과
 * 남이 보는 화면이 달라진다.
 */

import { describe, expect, it } from 'vitest';
import { isDrawable, traceSpot, TRACES } from './trace';
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

describe('흔적 목록', () => {
  it('편집 시트에 내놓는 것은 전부 실제로 그릴 수 있는 것뿐이다', () => {
    for (const tr of TRACES) {
      if (tr.id === 'none') continue;
      expect(isDrawable(tr.id)).toBe(true);
    }
  });

  it('아직 구현하지 않은 v2.5 타입은 그리지 않는다', () => {
    expect(isDrawable('star@1')).toBe(false);
    expect(isDrawable('flower@1')).toBe(false);
    expect(isDrawable('none')).toBe(false);
  });
});
