import { forwardRef, useImperativeHandle, useRef } from 'react';
import { t } from '../../i18n';
import type { KeyDef, KeyIndex } from '../../work-model/types';
import { Keycap, type KeycapHandle } from './Keycap';

export type GridHandle = {
  fire: (k: KeyIndex, source: 'tap' | 'loop') => void;
};

/**
 * 'pending' = 탭했지만 아직 다음 비트가 오지 않은 상태.
 * 이 0~0.6초의 시각적 예고가 없으면 아이는 "안 눌렸나?" 하고 다시 누른다.
 */
export type LoopState = 'off' | 'pending' | 'on';

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

  useImperativeHandle(ref, () => ({
    fire(k, source) {
      caps.current[k]?.fire(source);
    },
  }));

  return (
    // 키캡 4개는 키보드 상판 위에 얹혀 있다 — 한 줄 배치와 함께 "키보드"를 완성한다.
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
  );
});
