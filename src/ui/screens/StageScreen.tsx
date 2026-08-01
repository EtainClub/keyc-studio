/**
 * ③ 무대 — 준비 단계.
 *
 * 공연을 시작하기 전에 **루프를 소리로 확인**할 수 있어야 한다.
 * 여기서 켜고 끈 것은 기록되지 않고, 대신 `KeyDef.loop.enabled`가 되어
 * **공연 시작 시점의 초기 상태**가 된다.
 *
 * 즉 아이는 두 가지를 다 쓸 수 있다 — 처음부터 켜놓고 시작하거나,
 * 전부 꺼놓고 공연 중에 하나씩 쌓거나. 후자가 훨씬 극적이고 이 제품의 자랑거리다.
 *
 * BPM 숫자는 노출하지 않는다. 느리게(80)/보통(100)/빠르게(130) 세 개면 충분하다.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { durationForTempo } from '../../work-model/timing';
import { TEMPO_LABEL, tempoOf, type KeyIndex, type TempoPreset } from '../../work-model/types';
import { KeycapGrid, type GridHandle, type LoopState } from '../components/KeycapGrid';
import { useResumeOnVisible } from '../hooks';
import { useAppState } from '../state';

const TEMPOS: TempoPreset[] = ['slow', 'normal', 'fast'];

export function StageScreen() {
  const nav = useNavigate();
  const { engine, draft, patchKey, setTempo, saveDraft } = useAppState();
  const gridRef = useRef<GridHandle>(null);
  const [listening, setListening] = useState(false);

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

  const restart = (keys = draft.keys) => {
    if (!listening) return;
    engine.startPrep(keys, draft.tempo);
  };

  const toggleListen = () => {
    void engine.unlock();
    if (listening) {
      engine.stop();
      setListening(false);
    } else {
      engine.startPrep(draft.keys, draft.tempo);
      setListening(true);
    }
  };

  const toggleLoop = (idx: KeyIndex, next: boolean) => {
    void engine.unlock();
    const key = draft.keys[idx];
    patchKey(idx, { loop: { ...key.loop, enabled: next } });
    const keys = draft.keys.map((k) =>
      k.idx === idx ? { ...k, loop: { ...k.loop, enabled: next } } : k,
    );
    engine.setKeys(keys);
    restart(keys as typeof draft.keys);
  };

  const pickTempo = (preset: TempoPreset) => {
    setTempo(preset);
    // 속도를 바꾸면 새 박자로 다시 시작한다.
    if (listening) engine.startPrep(draft.keys, tempoOf(preset));
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
        반복을 켜고 들어보세요. 여기서 켜둔 건 공연이 시작할 때 그대로 울려요.
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

      <button
        type="button"
        className={`chip wide ${listening ? 'on' : ''}`}
        onClick={toggleListen}
      >
        {listening ? '■ 멈추기' : '▶ 들어보기'}
      </button>

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
