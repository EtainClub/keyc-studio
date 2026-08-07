/**
 * ③ 무대 — 준비 단계.
 *
 * 공연을 시작하기 전에 처음부터 반복할 키와 빠르기를 고른다.
 * 여기서 켜고 끈 것은 기록되지 않고, 대신 `KeyDef.loop.enabled`가 되어
 * **공연 시작 시점의 초기 상태**가 된다.
 *
 * 즉 아이는 두 가지를 다 쓸 수 있다 — 처음부터 켜놓고 시작하거나,
 * 전부 꺼놓고 공연 중에 하나씩 쌓거나. 후자가 훨씬 극적이고 이 제품의 자랑거리다.
 *
 * BPM 숫자는 노출하지 않는다. 느리게(80)/보통(100)/빠르게(130) 세 개면 충분하다.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { durationForTempo } from '../../work-model/timing';
import { TEMPO_LABEL, type KeyIndex, type TempoPreset } from '../../work-model/types';
import { KeycapGrid, type GridHandle, type LoopState } from '../components/KeycapGrid';
import { useResumeOnVisible } from '../hooks';
import { useAppState } from '../state';

const TEMPOS: TempoPreset[] = ['slow', 'normal', 'fast'];

export function StageScreen() {
  const nav = useNavigate();
  const { engine, draft, patchKey, setTempo, saveDraft } = useAppState();
  const gridRef = useRef<GridHandle>(null);

  useResumeOnVisible(() => void engine.resume());

  useEffect(() => {
    if (!draft) {
      nav('/', { replace: true });
      return;
    }
    engine.setVisualHandler((e) => gridRef.current?.fire(e.key, e.source));
    void engine.prepare(draft.keys);
    return () => engine.stop();
  }, [draft, engine, nav]);

  if (!draft) return null;

  const loopStates: LoopState[] = draft.keys.map((k) => (k.loop.enabled ? 'on' : 'off'));

  const toggleLoop = (idx: KeyIndex, next: boolean) => {
    const key = draft.keys[idx];
    patchKey(idx, { loop: { ...key.loop, enabled: next } });
  };

  const pickTempo = (preset: TempoPreset) => {
    setTempo(preset);
  };

  const seconds = (durationForTempo(draft.tempo) / 1000).toFixed(1);

  return (
    <main className="screen stage">
      <header className="bar">
        <button type="button" className="bar-back" onClick={() => nav('/create')}>
          ‹ 꾸미기
        </button>
        <h1>무대</h1>
      </header>

      <p className="guide">
        공연이 시작할 때 자동으로 반복할 키를 골라요. 키를 누르면 소리를 확인할 수 있어요.
      </p>

      <KeycapGrid
        ref={gridRef}
        keys={draft.keys}
        loopStates={loopStates}
        onToggleLoop={toggleLoop}
        onPress={(idx) => {
          void engine.unlock();
          engine.press(idx);
        }}
        onRelease={(idx) => engine.release(idx)}
      />

      <section className="tempo">
        <h2 className="row-label">빠르기</h2>
        <div className="chip-grid">
          {TEMPOS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip big ${draft.tempo.preset === t ? 'on' : ''}`}
              onClick={() => pickTempo(t)}
            >
              {TEMPO_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="note">공연은 {seconds}초 — 박자에 딱 맞게 끝나요.</p>
      </section>

      <button
        type="button"
        className="big-cta bottom"
        onClick={async () => {
          engine.stop();
          await saveDraft();
          nav('/perform');
        }}
      >
        공연하러 가기 →
      </button>
    </main>
  );
}
