/**
 * 키캡 한 개.
 *
 * 실제 키캡 사진을 기준으로 만든 구조다:
 *   .keycap-unit
 *     └ .keycap            캡 본체 — 아래가 넓고 위가 좁은 사다리꼴
 *         └ .keycap-top    윗면 — 그림/얼굴이 각인처럼 얹히는 면
 *         └ .keycap-gloss  왼쪽 위 모서리를 타고 흐르는 광택 선
 *     └ .keycap-housing    투명 스위치 하우징 — 캡이 이 안으로 내려앉는다
 *
 * 그림을 그리면 기본 얼굴 대신 그림이 윗면에 올라간다.
 *
 * 발화는 React 상태를 거치지 않는다 — 누를 때마다 setState를 하면 리렌더가
 * 오디오보다 늦게 도착한다. 부모가 ref로 fire()를 직접 호출하고,
 * 이 컴포넌트는 DOM 클래스만 갈아끼운다.
 */

import { forwardRef, useImperativeHandle, useRef, type CSSProperties } from 'react';
import type { KeyDef, KeyIndex } from '../../work-model/types';
import { FEELS, tryVibrate } from '../feel';
import { useAssetUrl } from '../hooks';

export type KeycapHandle = {
  fire: (source: 'tap' | 'loop') => void;
};

type Props = {
  keyDef: KeyDef;
  /** 그림 자산의 표시 URL. 주지 않으면 keyDef에서 직접 찾는다. */
  artUrl?: string | null;
  /** pointerdown 즉시 호출된다. 여기서 await하지 말 것. */
  onPress?: (idx: KeyIndex) => void;
  onRelease?: (idx: KeyIndex) => void;
  onSelect?: (idx: KeyIndex) => void;
  badge?: string;
  disabled?: boolean;
  /**
   * "지금은 눌러도 소용없다"를 눈으로 알린다.
   *
   * disabled와 따로 두는 이유: 리플레이 중에도 키캡은 disabled지만 그때는
   * 키캡이 공연 그 자체다. 흐리게 만들면 볼거리를 죽인다.
   * 그래서 **기다리는 중**일 때만 켠다.
   */
  muted?: boolean;
};

/**
 * 아무것도 안 그렸을 때 윗면에 찍혀 있는 기본 각인.
 * 빈 키캡이 민무늬면 아이는 만들 마음이 안 생긴다.
 * 그림을 그리면 이 자리를 그림이 대신한다.
 */
export function CuteFace() {
  return (
    <span className="cute-face" aria-hidden>
      <span className="cf-eye cf-left" />
      <span className="cf-eye cf-right" />
      <span className="cf-blush cf-left" />
      <span className="cf-blush cf-right" />
      <span className="cf-mouth" />
    </span>
  );
}

/** 투명 하우징 안에 비치는 스위치 — 십자 스템과 금색 접점. */
function SwitchGuts() {
  return (
    <span className="housing-slot" aria-hidden>
      <span className="switch-stem" />
      <span className="switch-contact left" />
      <span className="switch-contact right" />
    </span>
  );
}

export const Keycap = forwardRef<KeycapHandle, Props>(function Keycap(
  { keyDef, artUrl: artUrlProp, onPress, onRelease, onSelect, badge, disabled, muted },
  ref,
) {
  const capRef = useRef<HTMLSpanElement>(null);
  const fallbackUrl = useAssetUrl(keyDef.appearance.artAssetId);
  const artUrl = artUrlProp !== undefined ? artUrlProp : fallbackUrl;
  const feel = FEELS[keyDef.haptic];

  useImperativeHandle(ref, () => ({
    fire(source) {
      const el = capRef.current;
      if (!el) return;
      // 애니메이션 재시작: 클래스를 뗐다 붙이고 그 사이에 리플로우를 강제한다.
      el.classList.remove('is-firing');
      void el.offsetWidth;
      el.dataset.source = source;
      el.classList.add('is-firing');
    },
  }));

  const press = (e: React.PointerEvent) => {
    if (disabled) return;
    // 두 번째 손가락으로 다른 키를 눌러도 각각 발음되게 한다.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    capRef.current?.classList.add('is-pressed');
    tryVibrate(keyDef.haptic);
    onPress?.(keyDef.idx);
  };

  const release = () => {
    if (!capRef.current?.classList.contains('is-pressed')) return;
    capRef.current.classList.remove('is-pressed');
    onRelease?.(keyDef.idx);
  };

  const style: CSSProperties = {
    ['--cap-color' as string]: keyDef.appearance.baseColor,
    ['--press-depth' as string]: `${feel.depth}px`,
    ['--press-scale' as string]: String(feel.scale),
    ['--rebound' as string]: `${feel.reboundMs}ms`,
    ['--rebound-ease' as string]: feel.easing,
  };

  return (
    <button
      type="button"
      className={`keycap-slot ${muted ? 'is-muted' : ''}`}
      style={style}
      aria-label={`키캡 ${keyDef.idx + 1}`}
      disabled={disabled}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onClick={() => onSelect?.(keyDef.idx)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="keycap-unit">
        {/* 투명 하우징이 먼저 — 캡이 그 위에 얹힌다 */}
        <span className="keycap-housing" aria-hidden>
          <SwitchGuts />
          <span className="housing-base" />
        </span>

        <span
          ref={capRef}
          className={`keycap motion-${keyDef.motion.split('@')[0]} led-${keyDef.led.split('@')[0]}`}
          data-source="tap"
        >
          <span className="keycap-top">
            {artUrl ? (
              <img className="keycap-art" src={artUrl} alt="" draggable={false} />
            ) : (
              <CuteFace />
            )}
          </span>
          <span className="keycap-gloss" aria-hidden />
          <span className="keycap-led" aria-hidden />
          {badge && <span className="keycap-badge">{badge}</span>}
        </span>
      </span>
    </button>
  );
});
