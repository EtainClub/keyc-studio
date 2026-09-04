/**
 * ④ 공연 — 라이브 루퍼.
 *
 * "녹화 버튼이 달린 화면"이 아니라 악기다. 아이가 루프를 하나씩 쌓아 올리는
 * 과정 자체가 작품이 된다.
 *
 * 지켜야 할 규칙:
 *   1. 루프 토글과 키캡은 분리된 히트박스 (KeycapGrid가 담당)
 *   2. 루프 켜기는 즉시 시각 피드백(깜빡임), 소리는 다음 비트
 *   3. 비트 펄스는 시각만 — 메트로놈 소리를 넣으면 작품에 섞여 들린 것처럼 된다
 *   4. 공연 중에는 편집 불가 (누르기와 루프 토글 두 가지만)
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BEATS_PER_BAR, barMs, beatMs, durationForTempo } from '../../work-model/timing';
import { t } from '../../i18n';
import type { KeyIndex } from '../../work-model/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KeycapGrid, type GridHandle, type LoopState } from '../components/KeycapGrid';
import { useResumeOnVisible } from '../hooks';
import { useAppState } from '../state';

type Phase = 'ready' | 'countdown' | 'live' | 'paused' | 'done';

export function PerformScreen() {
  const nav = useNavigate();
  const { engine, draft, patchDraft, saveDraft } = useAppState();
  const gridRef = useRef<GridHandle>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [count, setCount] = useState(4);
  const [elapsed, setElapsed] = useState(0);
  const [presses, setPresses] = useState(0);
  const [loopStates, setLoopStates] = useState<LoopState[]>(['off', 'off', 'off', 'off']);
  const [check, setCheck] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useResumeOnVisible(() => void engine.resume());

  useEffect(() => {
    if (!draft) {
      nav('/', { replace: true });
      return;
    }
    engine.setVisualHandler((e) => gridRef.current?.fire(e));
    void engine.prepare(draft.keys);
    return () => engine.stop();
  }, [draft, engine, nav]);

  if (!draft) return null;

  const bpm = draft.tempo.bpm;
  const duration = durationForTempo(draft.tempo);
  const totalBars = Math.round(duration / barMs(bpm));
  const currentBeat = Math.floor(elapsed / beatMs(bpm));
  const currentBar = Math.floor(elapsed / barMs(bpm));
  const beatInBar = ((currentBeat % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;

  const syncLoopStates = () => {
    setLoopStates(
      draft.keys.map((k) => (engine.isLoopOn(k.idx) ? 'on' : 'off')) as LoopState[],
    );
  };

  const start = async () => {
    await engine.unlock();
    setPhase('countdown');
    // 카운트인도 1마디 — 그래야 3·2·1이 박자에 맞는다.
    for (let n = BEATS_PER_BAR; n >= 1; n--) {
      setCount(n);
      await sleep(beatMs(bpm));
    }
    setPresses(0);
    // 직전 연습에서 남은 발자국을 지우고 시작한다 — 공연은 빈 화면에서 시작해야 한다.
    gridRef.current?.clearTraces();
    setElapsed(0);
    setPhase('live');
    setLoopStates(draft.keys.map((k) => (k.loop.enabled ? 'on' : 'off')) as LoopState[]);

    engine.startLive(draft.keys, draft.tempo, {
      onProgress: (_r, ms) => setElapsed(ms),
      onEnd: async () => {
        const replay = engine.getReplay();
        setPhase('done');

        // 셀프체크: 실제로 울린 것과 저장될 기록에서 재계산한 것이 같은가.
        const result = engine.selfCheck();
        if (!result.ok) {
          console.warn('[selfcheck] 리플레이 불일치', result);
          setCheck(t('perform.replayMismatch'));
        } else {
          setCheck(null);
        }

        const next = { ...draft, replay };
        patchDraft({ replay });
        await saveDraft({ thumb: true, work: next });
      },
    });
  };

  const toggleLoop = (idx: KeyIndex, next: boolean) => {
    engine.toggleLoop(idx, next);
    if (next) {
      // 2. 탭한 즉시 "대기 중"으로 깜빡이고, 다음 비트에 고정 점등으로 바뀐다.
      setLoopStates((prev) => prev.map((s, i) => (i === idx ? 'pending' : s)));
      const untilNextBeat = beatMs(bpm) - (elapsed % beatMs(bpm));
      setTimeout(syncLoopStates, Math.max(30, untilNextBeat));
    } else {
      setLoopStates((prev) => prev.map((s, i) => (i === idx ? 'off' : s)));
    }
  };

  const retry = () => {
    engine.stop();
    gridRef.current?.clearTraces();
    setPhase('ready');
    setElapsed(0);
    setCheck(null);
  };

  const togglePause = async () => {
    if (phase === 'live') {
      if (await engine.pause()) setPhase('paused');
      return;
    }
    if (phase === 'paused' && (await engine.resumePlayback())) setPhase('live');
  };

  const cancelPerformance = () => {
    setConfirmCancel(false);
    engine.stop();
    gridRef.current?.clearTraces();
    setPhase('ready');
    setElapsed(0);
    setPresses(0);
    setLoopStates(['off', 'off', 'off', 'off']);
    setCheck(null);
  };

  return (
    <main className="screen perform">
      <header className="bar">
        <button
          type="button"
          className="bar-back"
          onClick={() => nav('/stage')}
          disabled={phase === 'live' || phase === 'paused' || phase === 'countdown'}
        >
          {t('perform.backToStage')}
        </button>
        <h1>{t('perform.title')}</h1>
      </header>

      {/* 마디 진행 표시 */}
      <div className="bars" aria-hidden>
        {Array.from({ length: totalBars }, (_, i) => (
          <span
            key={i}
            className={`bar-dot ${(phase === 'live' || phase === 'paused') && i <= currentBar ? 'on' : ''}`}
          />
        ))}
      </div>

      <KeycapGrid
        ref={gridRef}
        keys={draft.keys}
        disabled={phase !== 'live'}
        // 시작 전·끝난 뒤에는 눌러도 소용없다는 걸 눈으로 알린다.
        // 카운트다운 중에는 켜지 않는다 — 곧 밝아지는 게 시작 신호가 된다.
        muted={phase === 'ready' || phase === 'done'}
        loopStates={phase === 'live' || phase === 'paused' ? loopStates : undefined}
        onToggleLoop={toggleLoop}
        onPress={(idx) => {
          engine.press(idx);
          setPresses((c) => c + 1);
        }}
        onRelease={(idx) => engine.release(idx)}
      />

      {/* 3. 비트 펄스 — 시각만. 메트로놈 소리는 넣지 않는다. */}
      {phase === 'live' && (
        <div className="beat-pulse" aria-hidden>
          {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
            <span key={i} className={`pulse-dot ${i === beatInBar ? 'on' : ''}`} />
          ))}
        </div>
      )}

      {phase === 'ready' && <p className="guide">{t('perform.readyGuide')}</p>}

      {phase === 'ready' && (
        <button type="button" className="record-cta" onClick={start}>
          <span className="record-dot" />
          {t('perform.start')}
        </button>
      )}

      {phase === 'countdown' && (
        <div className="countdown-wrap">
          <div className="countdown">{count}</div>
          <p className="countdown-hint">{t('perform.getReady')}</p>
        </div>
      )}

      {(phase === 'live' || phase === 'paused') && (
        <p className="live-hint">
          {phase === 'paused' ? t('perform.paused') : t('perform.live')}
          <span className="press-count">
            {t('perform.counter', {
              seconds: Math.max(0, Math.ceil((duration - elapsed) / 1000)),
              presses,
            })}
          </span>
        </p>
      )}

      {(phase === 'live' || phase === 'paused') && (
        <div className="performance-controls" aria-label={t('perform.controlsAria')}>
          <button type="button" className="chip performance-pause" onClick={togglePause}>
            {phase === 'paused' ? t('perform.resume') : t('perform.pause')}
          </button>
          <button
            type="button"
            className="chip performance-stop"
            onClick={() => setConfirmCancel(true)}
          >
            {t('perform.stop')}
          </button>
        </div>
      )}

      {phase === 'done' && (
        <div className="done-row">
          <p className="done-msg">{t('perform.done', { presses })}</p>
          {check && <p className="warn">{check}</p>}
          <button type="button" className="chip" onClick={() => nav('/card?replay=1')}>
            {t('perform.watchAgain')}
          </button>
          {/* 15초 한 번에 만족스러운 결과가 나올 확률은 낮다. 재시도 비용을 0으로. */}
          <button type="button" className="chip" onClick={retry}>
            {t('perform.again')}
          </button>
          <button type="button" className="big-cta" onClick={() => nav('/card')}>
            {t('perform.finish')}
          </button>
        </div>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title={t('perform.cancelTitle')}
          detail={t('perform.cancelDetail')}
          confirmLabel={t('perform.cancelConfirm')}
          cancelLabel={t('perform.cancelKeep')}
          onConfirm={cancelPerformance}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
    </main>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
