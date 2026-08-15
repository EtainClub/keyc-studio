/**
 * 흔적 레이어 — 누를 때 화면에 스탬프를 찍는 전면 오버레이.
 *
 * Keycap.fire()와 같은 이유로 **React 상태를 쓰지 않는다.** 스탬프 하나마다
 * setState를 하면 리렌더가 오디오보다 늦게 도착해 "소리 뒤에 그림이 오는"
 * 화면이 된다. 여기서는 DOM 노드를 직접 붙이고 animationend에서 뗀다.
 *
 * 손가락은 통과시킨다(pointer-events: none). 발자국이 키캡을 덮어도
 * 누르는 데는 아무 지장이 없어야 한다.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { KeyDef, KeyIndex } from '../../work-model/types';
import { MAX_STAMPS, STAMP_LIFE_MS, isDrawable, traceSpot } from '../trace';

/** 화면 맨 위 여백. 발자국이 상태바에 붙어 잘려 보이지 않게 한다. */
const BAND_TOP_PX = 40;
/** 상판과 발자국 사이 숨 쉴 틈. */
const BAND_GAP_PX = 14;
/**
 * 상판 위로 발자국이 올라갈 수 있는 최대 높이.
 *
 * 상한이 없으면 데스크톱처럼 세로로 긴 창에서 발자국이 화면 꼭대기까지
 * 흩어져 "어느 키에서 나왔는지"가 안 보인다. 키 근처에 모여 있어야 인과가 읽힌다.
 */
const BAND_MAX_PX = 340;
/** 화면 가장자리에서 스탬프가 잘리지 않게 남기는 여백. */
const EDGE_PX = 6;
/** 키캡을 못 찾았을 때 쓸 대략적인 캡 너비. */
const FALLBACK_CAP_PX = 72;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 이 키의 발자국이 놓일 기준 — **누른 키캡 바로 위**다.
 *
 * 화면 %로 잡지 않는 이유: `.screen`은 `max-width: 520px`으로 가운데 정렬되고
 * 상판은 `margin-block: auto`로 오르내린다. 넓거나 긴 창에서 화면 %는 키캡이
 * 실제로 있는 자리와 어긋나, 발자국이 누르지도 않은 키 위에서 튀어나온다.
 * 그래서 매번 잰다.
 *
 * 세로 띠는 상판 **위**에서 끝난다. 상판을 덮으면 아이가 그린 그림이 가려지는데,
 * 그건 이 기능이 주는 재미보다 훨씬 크게 잃는 것이다.
 */
function placement(root: HTMLElement, key: KeyIndex) {
  const screen = root.parentElement;
  const cap = screen?.querySelectorAll('.keycap-slot')[key]?.getBoundingClientRect();
  const plateTop =
    screen?.querySelector('.keyboard-plate')?.getBoundingClientRect().top ??
    window.innerHeight * 0.5;

  const bottom = plateTop - BAND_GAP_PX;
  const top = Math.max(BAND_TOP_PX, bottom - BAND_MAX_PX);
  return {
    centerX: cap ? cap.left + cap.width / 2 : window.innerWidth / 2,
    // 이웃 열과 살짝 겹치는 폭. 좁히면 한 키를 반복할 때 한 덩어리로 뭉친다.
    spread: (cap?.width ?? FALLBACK_CAP_PX) * 0.95,
    top,
    height: Math.max(0, bottom - top),
  };
}

export type TraceLayerHandle = {
  /** 이 키의 흔적 설정대로 스탬프 하나를 찍는다. 흔적이 'none'이면 아무 일도 없다. */
  stamp: (keyDef: KeyDef, ev: { seed: number; eventIndex: number }) => void;
  /** 화면에 남은 것을 즉시 전부 지운다. 공연 시작·재시도처럼 판을 새로 까는 순간에 부른다. */
  clear: () => void;
};

export const TraceLayer = forwardRef<TraceLayerHandle>(function TraceLayer(_props, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** 붙은 순서 그대로. 상한을 넘으면 앞에서부터(= 가장 오래된 것부터) 뗀다. */
  const live = useRef<HTMLSpanElement[]>([]);

  const drop = (el: HTMLSpanElement) => {
    const i = live.current.indexOf(el);
    if (i >= 0) live.current.splice(i, 1);
    el.remove();
  };

  // 화면을 떠날 때 남은 노드를 정리한다. 레이어가 사라져도 부모가 아직 ref를 쥐고 있을 수 있다.
  useEffect(() => {
    const nodes = live.current;
    return () => {
      for (const el of nodes) el.remove();
      nodes.length = 0;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    stamp(keyDef, ev) {
      const root = rootRef.current;
      if (!root || !isDrawable(keyDef.trace.type)) return;

      const spot = traceSpot(ev.seed, ev.eventIndex, keyDef.idx);
      const at = placement(root, keyDef.idx);
      const half = spot.sizePx / 2;

      const el = document.createElement('span');
      el.className = 'trace-stamp trace-cat-paw';
      el.style.left = `${clamp(
        at.centerX + spot.xOffset * at.spread,
        half + EDGE_PX,
        window.innerWidth - half - EDGE_PX,
      )}px`;
      el.style.top = `${at.top + spot.yFrac * at.height}px`;
      el.style.width = `${spot.sizePx}px`;
      el.style.height = `${spot.sizePx}px`;
      // 발자국은 currentColor로 그려진다 — 색은 이 한 줄이 전부다.
      el.style.color = keyDef.trace.color;
      el.style.rotate = `${spot.angleDeg}deg`;
      el.style.animationDuration = `${STAMP_LIFE_MS}ms`;
      el.addEventListener('animationend', () => drop(el), { once: true });

      root.appendChild(el);
      live.current.push(el);
      // 상한 초과분은 즉시 뗀다. 애니메이션이 끝나기를 기다리지 않는다 —
      // 기다리면 연타 구간에서 노드가 계속 불어난다.
      while (live.current.length > MAX_STAMPS) drop(live.current[0]);
    },
    clear() {
      for (const el of live.current) el.remove();
      live.current.length = 0;
    },
  }));

  return <div ref={rootRef} className="trace-layer" aria-hidden />;
});
