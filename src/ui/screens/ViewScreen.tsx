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
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { t } from '../../i18n';
import { isTossApp } from '../../platform/toss';
import { fetchWork, recordPlay, shareUrl } from '../../storage/remote';
import { registerAssets } from '../../storage/assets';
import type { Work } from '../../work-model/types';
import { KeycapGrid, type GridHandle } from '../components/KeycapGrid';
import {
  SecretRevealLayer,
  secretHandlerFor,
  type SecretRevealHandle,
} from '../components/SecretRevealLayer';
import { useResumeOnVisible } from '../hooks';
import { useAppState } from '../state';

type Phase = 'loading' | 'idle' | 'replay' | 'paused' | 'ended' | 'free' | 'missing';

export function ViewScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { engine } = useAppState();
  const gridRef = useRef<GridHandle>(null);
  const revealRef = useRef<SecretRevealHandle>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState(0);
  const [presses, setPresses] = useState(0);
  /** 이번 "직접 눌러보기"에서 찾아낸 비밀 수. 눌러보기를 다시 시작하면 0부터다. */
  const [found, setFound] = useState(0);

  /**
   * 그룹 리플레이 링크(`/w/:id?g=...`)에서 왔는지. ref로 들고 있는 이유: 이 값을
   * playReplay의 useCallback 의존성에 넣으면 groupId가 바뀔 때마다 콜백이 새로
   * 만들어지고, 그러면 아래 마운트 effect(`[id, engine, playReplay]`)가 다시 돌아
   * 이미 재생 중인 작품을 처음부터 다시 불러온다. 이 화면에서 g는 마운트 중에
   * 바뀔 이유가 없는 값이라 ref로 최신값만 읽으면 충분하다.
   */
  const groupId = searchParams.get('g');
  const groupIdRef = useRef<string | null>(null);
  groupIdRef.current = groupId;

  /**
   * 그룹에서 들어왔으면 그 그룹 스테이지로 정확히 되돌아가는 길을 화면에 둔다.
   *
   * 하단 내비게이션의 [스테이지]로는 안 된다 — 거기는 `/feed`(그룹 미선택)라
   * 그룹을 매번 다시 고르게 만든다. `?g=`를 그대로 붙여 보내면 곧장 그 그룹의
   * 목록으로 돌아간다. `nav(-1)`도 쓰지 않는다: 공유 링크로 바로 열었을 때는
   * 돌아갈 이전 항목이 아예 없어 앱 밖으로 나가버린다.
   */
  const backTo = groupId ? `/feed?g=${encodeURIComponent(groupId)}` : null;

  useResumeOnVisible(() => void engine.resume());

  const playReplay = useCallback(
    async (w: Work) => {
      await engine.unlock();
      void recordPlay(w.id, 0, { groupId: groupIdRef.current });
      setProgress(0);
      setPhase('replay');
      // 다시 보기는 처음부터다. 지난 재생의 발자국이 남아 있으면 같은 작품이 다른 그림으로 시작한다.
      gridRef.current?.clearTraces();
      engine.playReplay(w, {
        onProgress: setProgress,
        onEnd: () => {
          setPhase('ended');
          // 시작 시점과 따로, 끝까지 들었을 때만 "한 표"를 보고한다. 이걸 빠뜨리면
          // 그룹의 고유 청취자 수가 영영 늘지 않는다 — 중간에 나가버린 재생까지
          // 표로 세면 "몇 명이 진짜 들었는지"라는 지표 자체가 무의미해진다.
          void recordPlay(w.id, 0, { groupId: groupIdRef.current, completed: true });
        },
      });
    },
    [engine],
  );

  const startFree = useCallback(
    async (w: Work) => {
      await engine.unlock();
      setPhase('free');
      // 찾은 개수도 처음부터다. startFree가 엔진 쪽 진행 상태를 되돌리므로 화면도 맞춘다.
      setFound(0);
      gridRef.current?.clearTraces();
      revealRef.current?.clear();
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
    engine.setVisualHandler((e) => gridRef.current?.fire(e));
    /*
     * 비밀 목록은 여기서 넘기지 않는다 — startFree가 work.secrets로 채운다.
     * 감상 화면에서 비밀이 열리는 곳은 "직접 눌러보기" 하나뿐이라, 다시 보기를
     * 보는 동안에는 엔진에 비밀이 아예 없는 상태가 맞다.
     */
    const reveal = secretHandlerFor(engine, revealRef);
    engine.setSecretHandler((secret) => {
      reveal(secret);
      setFound((n) => n + 1);
    });

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
    })();

    return () => {
      alive = false;
      engine.stop();
    };
  }, [id, engine, playReplay]);

  if (phase === 'loading') {
    return (
      <main className="screen view">
        <p className="note">{t('view.loading')}</p>
      </main>
    );
  }

  if (phase === 'missing' || !work) {
    return (
      <main className="screen view">
        <p className="warn">{t('view.notFound')}</p>
        {/* 그룹에서 왔다면 홈이 아니라 그룹으로 돌려보낸다 — 없어진 작품 하나 때문에
            그룹 스테이지 밖으로 튕겨 나갈 이유가 없다. */}
        <button type="button" className="chip" onClick={() => nav(backTo ?? '/')}>
          {backTo ? t('view.toGroupStage') : t('card.toHome')}
        </button>
      </main>
    );
  }

  return (
    <main className="screen view">
      <header className="view-head">
        {/*
          * 그룹 무대로 가는 칩. 토스 안에서는 화살표만 뗀다 — 네이티브 뒤로가기
          * 바로 아래에 ← 달린 버튼이 있으면 뒤로가기가 둘로 보인다. 버튼 자체는
          * 남긴다: 공유 링크로 바로 들어온 사람에겐 뒤로 갈 기록이 없어서 이게
          * 그룹 무대로 가는 유일한 길이다.
          */}
        {backTo && (
          /* 화면은 개인 모드다. 이 버튼 하나만 그룹 토큰을 써서
             "온 곳은 그룹, 지금 보는 것은 작품"이 색으로 읽히게 한다. */
          <button
            type="button"
            className="chip view-back"
            data-mode="group"
            onClick={() => nav(backTo)}
          >
            {!isTossApp() && <span aria-hidden="true">← </span>}
            {t('view.backGroupStage')}
          </button>
        )}
        <h1>{work.title || t('common.untitled')}</h1>
        {work.hint && <p className="hint">{work.hint}</p>}
        <p className="nick">{t('view.by', { nick: work.authorNick })}</p>

        {/*
          * 감상자에게는 **개수만** 알려준다. 어느 키인지도, 몇 번 눌러야 하는지도
          * 보여주지 않는다 — 그걸 알려주는 순간 찾는 재미가 통째로 사라진다.
          * 눌러보는 중에는 몇 개 남았는지로 바뀐다. 남은 수가 안 보이면 언제
          * 그만둬야 할지 몰라 그냥 나가버린다.
          */}
        {work.secrets.length > 0 && (
          <p className="secret-hint">
            <span aria-hidden>🤫</span>{' '}
            {phase !== 'free'
              ? t('secret.hidden', { n: work.secrets.length })
              : found >= work.secrets.length
                ? t('secret.allFound')
                : t('secret.progress', { found, total: work.secrets.length })}
          </p>
        )}
      </header>

      {/*
        * 진행 막대와 재생 조작은 **한 덩어리로 화면 위쪽에** 둔다.
        *
        * 예전에는 조작 버튼이 키캡 아래, 화면 맨 끝에 있었다. `.keyboard-plate`의
        * `margin-block: auto`가 키캡을 가운데로 밀면서 버튼은 언제나 100dvh 상자의
        * 바닥에 붙는데, 웹뷰(토스 미니앱 등)나 시스템 내비게이션 바가 겹치는 기기에서는
        * 그 바닥이 실제로 보이는 영역 **밖**이라 버튼이 하단 내비게이션에 가리거나
        * 아예 안 보였다. 위쪽 고정은 뷰포트 높이를 얼마로 재든 항상 보인다 —
        * sticky로 바닥에 붙여 두는 방법은 잘못 잰 뷰포트 안에서 계산되므로
        * 같은 기기에서 똑같이 가려진다.
        */}
      {(phase === 'replay' || phase === 'paused') && (
        <section className="playback">
          <div className="progress" aria-hidden>
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="live-hint">{phase === 'paused' ? t('view.paused') : t('view.playing')}</p>
          <div className="performance-controls" role="group" aria-label={t('perform.controlsAria')}>
            <button type="button" className="chip performance-pause" onClick={toggleReplayPause}>
              {phase === 'paused' ? t('perform.resume') : t('perform.pause')}
            </button>
            <button type="button" className="chip performance-stop" onClick={stopReplay}>
              {t('view.stop')}
            </button>
          </div>
        </section>
      )}

      <KeycapGrid
        ref={gridRef}
        keys={work.keys}
        disabled={phase !== 'free'}
        // 재생 전후에만 흐리게. 재생 중(replay/paused)에는 키캡이 곧 공연이다.
        muted={phase === 'idle' || phase === 'ended'}
        onPress={(idx) => {
          engine.press(idx);
          setPresses((c) => c + 1);
        }}
        onRelease={(idx) => engine.release(idx)}
      />

      {phase === 'idle' && (
        <button type="button" className="big-cta" onClick={() => playReplay(work)}>
          {t('view.play')}
        </button>
      )}

      {(phase === 'ended' || phase === 'free') && (
        <div className="done-row">
          {phase === 'ended' && (
            <button type="button" className="big-cta" onClick={() => startFree(work)}>
              {t('view.tryYourself')}
            </button>
          )}
          {phase === 'free' && (
            <p className="note">{t('view.pressHint', { presses })}</p>
          )}
          <button type="button" className="chip" onClick={() => playReplay(work)}>
            {t('view.replay')}
          </button>
          <button
            type="button"
            className="chip"
            onClick={async () => {
              /*
               * 그룹에서 열어 본 작품은 링크에도 `?g=`를 그대로 실어 보낸다.
               *
               * 빼면 링크를 받은 사람의 리플레이는 어느 그룹에도 잡히지 않아, 열심히
               * 퍼뜨려도 그룹 카드의 숫자가 그대로다 — "리플레이가 안 세진다"의 절반이
               * 이 경로였다. 표(고유 청취자)는 여전히 참가자만 등록되므로, 링크가
               * 퍼진다고 순위가 뒤집히지는 않는다.
               */
              const link = groupId
                ? `${shareUrl(work.id)}?g=${encodeURIComponent(groupId)}`
                : shareUrl(work.id);
              if (navigator.share) await navigator.share({ url: link }).catch(() => {});
              else await navigator.clipboard.writeText(link).catch(() => {});
            }}
          >
            {t('view.sendFriend')}
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              void recordPlay(work.id, presses, { groupId: groupIdRef.current });
              engine.stop();
              nav('/');
            }}
          >
            {t('view.makeMine')}
          </button>
        </div>
      )}

      {/* 무대에서 아이가 시험한 것과 똑같은 연출이다. */}
      <SecretRevealLayer ref={revealRef} secrets={work.secrets} />
    </main>
  );
}
