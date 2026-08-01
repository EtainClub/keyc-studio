/**
 * ⑥ 감상 — /w/:id
 *
 * 두 가지 모드가 명확히 다르다:
 *
 *              작품 다시 보기            내가 직접 눌러보기
 *   입력       차단                      전체 허용
 *   루프 초기  KeyDef.loop.enabled 그대로  전부 off
 *   길이       durationMs에서 종료        무제한
 *   난수       replay.seed               새 seed
 *
 * 링크를 열면 **다시 보기가 먼저** 1회 재생되고, 끝나면 "직접 눌러보기"가 크게 뜬다.
 * 이 순서가 중요하다 — 만든 아이의 의도를 먼저 보여준 뒤 장난감을 넘기는 것.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchWork, recordPlay, shareUrl } from '../../storage/remote';
import { registerAssets } from '../../storage/assets';
import type { Work } from '../../work-model/types';
import { KeycapGrid, type GridHandle } from '../components/KeycapGrid';
import { useResumeOnVisible } from '../hooks';
import { useAppState } from '../state';

type Phase = 'loading' | 'idle' | 'replay' | 'paused' | 'ended' | 'free' | 'missing';

export function ViewScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const { engine } = useAppState();
  const gridRef = useRef<GridHandle>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState(0);
  const [presses, setPresses] = useState(0);

  useResumeOnVisible(() => void engine.resume());

  const playReplay = useCallback(
    async (w: Work) => {
      await engine.unlock();
      setProgress(0);
      setPhase('replay');
      engine.playReplay(w, {
        onProgress: setProgress,
        onEnd: () => setPhase('ended'),
      });
    },
    [engine],
  );

  const startFree = useCallback(
    async (w: Work) => {
      await engine.unlock();
      setPhase('free');
      engine.startFree(w);
    },
    [engine],
  );

  const toggleReplayPause = async () => {
    if (phase === 'replay') {
      if (await engine.pause()) setPhase('paused');
      return;
    }
    if (phase === 'paused' && (await engine.resumePlayback())) setPhase('replay');
  };

  const stopReplay = () => {
    engine.stop();
    setPhase('ended');
  };

  useEffect(() => {
    let alive = true;
    if (!id) return;
    engine.setVisualHandler((e) => gridRef.current?.fire(e.key, e.source));

    (async () => {
      const w = await fetchWork(id).catch(() => null);
      if (!alive) return;
      if (!w) {
        setPhase('missing');
        return;
      }
      registerAssets(w);
      setWork(w);
      await engine.prepare(w.keys);
      if (!alive) return;
      // 오디오가 이미 열려 있으면(같은 세션에서 넘어온 경우) 바로 재생한다.
      if (engine.audioContext.state === 'running') void playReplay(w);
      else setPhase('idle');
      void recordPlay(w.id, 0);
    })();

    return () => {
      alive = false;
      engine.stop();
    };
  }, [id, engine, playReplay]);

  if (phase === 'loading') {
    return (
      <main className="screen view">
        <p className="note">불러오는 중…</p>
      </main>
    );
  }

  if (phase === 'missing' || !work) {
    return (
      <main className="screen view">
        <p className="warn">작품을 찾을 수 없어요.</p>
        <button type="button" className="chip" onClick={() => nav('/')}>
          홈으로
        </button>
      </main>
    );
  }

  return (
    <main className="screen view">
      <header className="view-head">
        <h1>{work.title || '이름 없는 작품'}</h1>
        {work.hint && <p className="hint">{work.hint}</p>}
        <p className="nick">{work.authorNick} 만듦</p>
      </header>

      {(phase === 'replay' || phase === 'paused') && (
        <div className="progress" aria-hidden>
          <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      <KeycapGrid
        ref={gridRef}
        keys={work.keys}
        disabled={phase !== 'free'}
        onPress={(idx) => {
          engine.press(idx);
          setPresses((c) => c + 1);
        }}
        onRelease={(idx) => engine.release(idx)}
      />

      {phase === 'idle' && (
        <button type="button" className="big-cta" onClick={() => playReplay(work)}>
          ▶ 작품 보기
        </button>
      )}

      {(phase === 'replay' || phase === 'paused') && (
        <>
          <p className="live-hint">{phase === 'paused' ? '공연을 잠시 멈췄어요' : '공연 중…'}</p>
          <div className="performance-controls" aria-label="공연 재생 제어">
            <button type="button" className="chip performance-pause" onClick={toggleReplayPause}>
              {phase === 'paused' ? '▶ 계속하기' : 'Ⅱ 일시정지'}
            </button>
            <button type="button" className="chip performance-stop" onClick={stopReplay}>
              ■ 재생 중단
            </button>
          </div>
        </>
      )}

      {(phase === 'ended' || phase === 'free') && (
        <div className="done-row">
          {phase === 'ended' && (
            <button type="button" className="big-cta" onClick={() => startFree(work)}>
              👆 내가 직접 눌러보기
            </button>
          )}
          {phase === 'free' && (
            <p className="note">마음대로 눌러보세요. {presses}번 눌렀어요.</p>
          )}
          <button type="button" className="chip" onClick={() => playReplay(work)}>
            ↻ 작품 다시 보기
          </button>
          <button
            type="button"
            className="chip"
            onClick={async () => {
              const link = shareUrl(work.id);
              if (navigator.share) await navigator.share({ url: link }).catch(() => {});
              else await navigator.clipboard.writeText(link).catch(() => {});
            }}
          >
            친구에게 보내기
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              void recordPlay(work.id, presses);
              engine.stop();
              nav('/');
            }}
          >
            나도 만들래요
          </button>
        </div>
      )}
    </main>
  );
}
