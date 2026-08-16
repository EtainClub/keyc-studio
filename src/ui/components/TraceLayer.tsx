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
import { resolveImageUrl } from '../../storage/assets';
import type { KeyDef, KeyIndex, TraceBehavior } from '../../work-model/types';
import {
  MAX_STAMPS,
  STAMP_LIFE_MS,
  TRACE_SHAPE_CLASS,
  isDrawable,
  traceSpot,
} from '../trace';

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

/*
 * 모양 명부는 trace.ts에 있다(`TRACE_SHAPE_CLASS`). 여기에 사본을 두지 않는 이유는
 * 하나다 — 두 벌이면 언젠가 한쪽만 늘어난다. 표에 없는 타입은 아무것도 찍지 않는다.
 */

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
  /**
   * 미리보기 한 장. 아이가 방금 고른 흔적을 편집 시트 밖에서 보여줄 때 쓴다.
   *
   * `stamp`와 달리 **그림을 기다린다.** 미리보기는 오디오와 같은 프레임에 끝날
   * 이유가 없고, 방금 그린 스탬프는 아직 URL이 안 잡혀 있는 것이 정상이다.
   * 여기서 안 기다리면 아이는 그리자마자 "아무 일도 안 일어났다"를 본다.
   */
  previewStamp: (keyDef: KeyDef, ev: { seed: number; eventIndex: number }) => void;
  /** 화면에 남은 것을 즉시 전부 지운다. 공연 시작·재시도처럼 판을 새로 까는 순간에 부른다. */
  clear: () => void;
};

type Props = {
  /**
   * 지금 화면의 키 4개.
   *
   * 흔적을 찍는 데는 필요 없다 — `stamp()`가 keyDef를 통째로 받는다. 이것이 있는
   * 유일한 이유는 **직접 그린 스탬프의 그림 URL을 미리 데워 두기 위해서**다.
   * `resolveImageUrl`은 비동기인데 `stamp()`는 오디오와 같은 프레임에 끝나야 하므로,
   * 누르는 순간에 URL을 받아올 방법이 없다.
   */
  keys?: readonly KeyDef[];
};

export const TraceLayer = forwardRef<TraceLayerHandle, Props>(function TraceLayer({ keys }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * 붙은 순서 그대로, **행동별로** 따로 센다. 상한을 넘으면 앞에서부터
   * (= 가장 오래된 것부터) 뗀다.
   *
   * 한 줄로 합쳐 세면 안 된다: 쌓이는 흔적(grow)이 상한을 채우는 순간, 다른 키의
   * 갓 찍힌 발자국이 그 압력에 밀려 사라진다. 행동마다 상한이 다른 것도 같은 이유다.
   */
  const live = useRef(new Map<TraceBehavior, HTMLSpanElement[]>());

  /** assetId → objectURL. 미리 데워 둔 것만 들어 있다(위 keys prop 참고). */
  const stampUrls = useRef(new Map<string, string>());

  const listFor = (behavior: TraceBehavior) => {
    const found = live.current.get(behavior);
    if (found) return found;
    const made: HTMLSpanElement[] = [];
    live.current.set(behavior, made);
    return made;
  };

  const drop = (behavior: TraceBehavior, el: HTMLSpanElement) => {
    const list = listFor(behavior);
    const i = list.indexOf(el);
    if (i >= 0) list.splice(i, 1);
    el.remove();
  };

  /*
   * 직접 그린 스탬프의 그림을 미리 받아 둔다.
   *
   * 실패는 조용히 넘긴다. 그림을 못 받으면 그 키는 아무것도 안 찍고 지나가는데,
   * 그게 화면 한가운데에 깨진 이미지 아이콘이 뜨는 것보다 낫다.
   */
  useEffect(() => {
    if (!keys) return;
    let alive = true;
    for (const k of keys) {
      const id = k.trace.assetId;
      if (!id || k.trace.type !== 'myStamp@1' || stampUrls.current.has(id)) continue;
      void resolveImageUrl(id)
        .then((url) => {
          if (alive) stampUrls.current.set(id, url);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [keys]);

  // 화면을 떠날 때 남은 노드를 정리한다. 레이어가 사라져도 부모가 아직 ref를 쥐고 있을 수 있다.
  useEffect(() => {
    const lists = live.current;
    return () => {
      for (const list of lists.values()) {
        for (const el of list) el.remove();
        list.length = 0;
      }
    };
  }, []);

  /** 스탬프 하나를 실제로 붙이는 일. 동기다 — 오디오와 같은 프레임에 끝나야 한다. */
  const paint = (keyDef: KeyDef, ev: { seed: number; eventIndex: number }) => {
    const root = rootRef.current;
    if (!root || !isDrawable(keyDef.trace.type)) return;

    const shape = TRACE_SHAPE_CLASS[keyDef.trace.type];
    if (!shape) return;

    /*
     * 직접 그린 스탬프인데 그림이 없으면 찍지 않는다. 아직 안 그렸거나, 남의
     * 기기에서 그림을 못 받아왔거나 — 어느 쪽이든 찍을 것이 없다.
     */
    const artUrl = keyDef.trace.assetId ? stampUrls.current.get(keyDef.trace.assetId) : undefined;
    if (keyDef.trace.type === 'myStamp@1' && !artUrl) return;

    const behavior = keyDef.trace.behavior;
    const spot = traceSpot(ev.seed, ev.eventIndex, keyDef.idx);
    const at = placement(root, keyDef.idx);
    const half = spot.sizePx / 2;

    const el = document.createElement('span');
    el.className = `trace-stamp ${shape} trace-${behavior}`;
    el.style.left = `${clamp(
      at.centerX + spot.xOffset * at.spread,
      half + EDGE_PX,
      window.innerWidth - half - EDGE_PX,
    )}px`;
    el.style.top = `${at.top + spot.yFrac * at.height}px`;
    el.style.width = `${spot.sizePx}px`;
    el.style.height = `${spot.sizePx}px`;
    el.style.rotate = `${spot.angleDeg}deg`;
    el.style.animationDuration = `${STAMP_LIFE_MS[behavior]}ms`;

    if (artUrl) {
      // 아이가 색까지 정해 그린 그림이다. currentColor로 덧칠하지 않는다.
      el.style.backgroundImage = `url("${artUrl}")`;
    } else {
      // 기본 모양은 마스크로 오려 낸다 — 색은 이 한 줄이 전부다.
      el.style.color = keyDef.trace.color;
    }

    if (behavior === 'walk') {
      el.style.setProperty('--walk-x', `${spot.driftXPx}px`);
      el.style.setProperty('--walk-y', `${spot.driftYPx}px`);
    }

    /*
     * 성장형은 animationend에서 떼지 않는다. 애니메이션이 끝나도 **남아 있는 것**이
     * 이 흔적의 전부이기 때문이다 — 15초 뒤 화면에 남은 그림이 곧 아이가 그린 것이다.
     * 대신 상한을 넘길 때와 clear()에서만 사라진다.
     */
    if (behavior !== 'grow') {
      el.addEventListener('animationend', () => drop(behavior, el), { once: true });
    }

    root.appendChild(el);
    const list = listFor(behavior);
    list.push(el);
    // 상한 초과분은 즉시 뗀다. 애니메이션이 끝나기를 기다리지 않는다 —
    // 기다리면 연타 구간에서 노드가 계속 불어난다.
    while (list.length > MAX_STAMPS[behavior]) drop(behavior, list[0]);
  };

  useImperativeHandle(ref, () => ({
    stamp: paint,

    previewStamp(keyDef, ev) {
      const id = keyDef.trace.assetId;
      // 데워져 있거나 그림이 필요 없는 흔적이면 기다릴 것이 없다.
      if (!id || stampUrls.current.has(id)) {
        paint(keyDef, ev);
        return;
      }
      void resolveImageUrl(id)
        .then((url) => stampUrls.current.set(id, url))
        .catch(() => {})
        .finally(() => paint(keyDef, ev));
    },

    clear() {
      for (const list of live.current.values()) {
        for (const el of list) el.remove();
        list.length = 0;
      }
    },
  }));

  return <div ref={rootRef} className="trace-layer" aria-hidden />;
});
