import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { VisualEvent } from '../../audio-engine/animation-queue';
import { t } from '../../i18n';
import type { KeyDef, KeyIndex } from '../../work-model/types';
import { Keycap, type KeycapHandle } from './Keycap';
import { TraceLayer, type TraceLayerHandle } from './TraceLayer';

export type GridHandle = {
  /**
   * 발화. VisualEvent를 통째로 받는다 — 키캡 애니메이션에는 key와 source면
   * 충분하지만, 흔적은 결정론적 배치를 위해 seed와 eventIndex까지 필요하다.
   */
  fire: (e: VisualEvent) => void;
  /** 화면에 쌓인 흔적을 즉시 지운다. */
  clearTraces: () => void;
  /**
   * 흔적 하나를 미리 보여준다. 편집 시트를 닫는 순간에 쓴다 —
   * 시트가 덮고 있는 동안에는 아이가 방금 고른 흔적을 볼 방법이 없다.
   */
  previewTrace: (k: KeyIndex) => void;
};

/**
 * 'pending' = 탭했지만 아직 다음 비트가 오지 않은 상태.
 * 이 0~0.6초의 시각적 예고가 없으면 아이는 "안 눌렸나?" 하고 다시 누른다.
 */
export type LoopState = 'off' | 'pending' | 'on';

/** 미리보기 전용 seed. 작품에 저장되는 값이 아니라 아무 상수여도 된다. */
const PREVIEW_SEED = 0x9e3779b9;
let previewCount = 0;

type Props = {
  keys: readonly KeyDef[];
  onPress?: (idx: KeyIndex) => void;
  onRelease?: (idx: KeyIndex) => void;
  onSelect?: (idx: KeyIndex) => void;
  disabled?: boolean;
  /** 눌러도 소용없는 상태를 눈으로 알린다. 리플레이 중에는 켜지 않는다 — Keycap 참고. */
  muted?: boolean;
  badges?: (string | undefined)[];
  /** 넘기면 키캡 아래에 루프 토글이 붙는다. */
  loopStates?: LoopState[];
  onToggleLoop?: (idx: KeyIndex, next: boolean) => void;
};

export const KeycapGrid = forwardRef<GridHandle, Props>(function KeycapGrid(
  {
    keys,
    onPress,
    onRelease,
    onSelect,
    disabled,
    muted,
    badges,
    loopStates,
    onToggleLoop,
  },
  ref,
) {
  const caps = useRef<(KeycapHandle | null)[]>([null, null, null, null]);
  const traceRef = useRef<TraceLayerHandle>(null);

  useImperativeHandle(ref, () => ({
    fire(e) {
      caps.current[e.key]?.fire(e.source);
      // 흔적은 키캡 애니메이션 **다음**이다. 키캡이 먼저 반응해야 인과가 읽힌다.
      const keyDef = keys.find((k) => k.idx === e.key);
      if (keyDef) traceRef.current?.stamp(keyDef, e);
    },
    clearTraces() {
      traceRef.current?.clear();
    },
    previewTrace(k) {
      const keyDef = keys.find((key) => key.idx === k);
      if (!keyDef) return;
      // 미리보기는 작품에 남지 않는다. 그래서 결정론을 지킬 대상이 아니고,
      // 매번 다른 자리에 찍히도록 세는 값을 쓴다.
      previewCount += 1;
      traceRef.current?.stamp(keyDef, { seed: PREVIEW_SEED, eventIndex: previewCount });
    },
  }));

  return (
    <>
      {/* 흔적은 상판 밖 화면 전체에 남는다. 상판 안에 두면 발자국이 캡 뒤로 잘린다. */}
      <TraceLayer ref={traceRef} />
      {/* 키캡 4개는 키보드 상판 위에 얹혀 있다 — 한 줄 배치와 함께 "키보드"를 완성한다. */}
      <div className="keyboard-plate">
        <div className="keycap-grid">
          {keys.map((key, i) => (
            <div className="keycap-column" key={key.idx}>
              <Keycap
                ref={(h) => {
                  caps.current[i] = h;
                }}
                keyDef={key}
                disabled={disabled}
                muted={muted}
                badge={badges?.[i]}
                onPress={onPress}
                onRelease={onRelease}
                onSelect={onSelect}
              />
              {loopStates && (
                /*
                 * 루프 토글은 키캡과 **물리적으로 분리된** 히트박스다.
                 * 아이 손가락은 크고, 겹치면 "소리 내려다 루프가 켜지는" 사고가 난다.
                 */
                <button
                  type="button"
                  className={`loop-toggle is-${loopStates[i]}`}
                  aria-label={t('stageScreen.loopAria', { n: i + 1 })}
                  aria-pressed={loopStates[i] !== 'off'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLoop?.(key.idx, loopStates[i] === 'off');
                  }}
                >
                  <span className="loop-icon" aria-hidden>
                    ↻
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
});
