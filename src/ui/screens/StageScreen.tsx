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

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { durationForTempo } from '../../work-model/timing';
import type { AssetRef, KeyIndex, Secret, TempoPreset } from '../../work-model/types';
import { t } from '../../i18n';
import { isTossApp } from '../../platform/toss';
import { KeycapGrid, type GridHandle, type LoopState } from '../components/KeycapGrid';
import { SecretSheet } from '../components/SecretSheet';
import {
  SecretRevealLayer,
  secretHandlerFor,
  type SecretRevealHandle,
} from '../components/SecretRevealLayer';
import { useResumeOnVisible } from '../hooks';
import { useAppState } from '../state';

const TEMPOS: TempoPreset[] = ['slow', 'normal', 'fast'];

/** 빠르기 이름은 화면 것이다 — work-model은 언어를 모른다(types.ts 참고). */
const TEMPO_LABEL: Record<TempoPreset, string> = {
  slow: t('tempo.slow'),
  normal: t('tempo.normal'),
  fast: t('tempo.fast'),
};

export function StageScreen() {
  const nav = useNavigate();
  const { engine, draft, patchKey, patchDraft, setTempo, saveDraft } = useAppState();
  const gridRef = useRef<GridHandle>(null);
  const revealRef = useRef<SecretRevealHandle>(null);
  const [secretsOpen, setSecretsOpen] = useState(false);

  useResumeOnVisible(() => void engine.resume());

  useEffect(() => {
    if (!draft) {
      nav('/', { replace: true });
      return;
    }
    engine.setVisualHandler((e) => gridRef.current?.fire(e));
    engine.setSecretHandler(secretHandlerFor(engine, revealRef));
    /*
     * 비밀을 엔진에 넘긴다.
     *
     * 무대에는 세션이 없어(mode 'idle') startFree를 거치지 않는다. 그래도 아이가
     * 비밀을 만들자마자 눌러 시험해 볼 수 있어야 한다 — 공연까지 가서야 제대로
     * 된 건지 알 수 있으면 고치다 포기한다.
     *
     * **반드시 이 effect 안이어야 한다.** 아래 cleanup의 engine.stop()이 비밀을
     * 지우기 때문에, 따로 뺀 effect에 두면 draft의 다른 부분(빠르기, 루프)만
     * 바뀌었을 때 stop만 돌고 다시 채워지지 않아 비밀이 조용히 사라진다.
     */
    engine.setSecrets(draft.secrets);
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
        {!isTossApp() && (
          <button type="button" className="bar-back" onClick={() => nav('/create')}>
            {t('stageScreen.backToCreate')}
          </button>
        )}
        <h1>{t('stageScreen.title')}</h1>
      </header>

      <p className="guide">
        {t('stageScreen.guide')}
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
        <h2 className="row-label">{t('stageScreen.tempo')}</h2>
        <div className="chip-grid">
          {TEMPOS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`chip big ${draft.tempo.preset === preset ? 'on' : ''}`}
              onClick={() => pickTempo(preset)}
            >
              {TEMPO_LABEL[preset]}
            </button>
          ))}
        </div>
        <p className="note">{t('stageScreen.duration', { seconds })}</p>
      </section>

      {/*
        * 비밀 숨기기. 로드맵의 제작 순서(①키캡 ②무대 ③반복 ④비밀 ⑤공연)에서
        * 공연 바로 앞자리다. 개수를 버튼에 달아 두는 이유: 몇 개 숨겼는지가
        * 작품 카드에 그대로 나가는 값이라, 여기서 안 보이면 나중에 놀란다.
        */}
      <button type="button" className="secret-entry" onClick={() => setSecretsOpen(true)}>
        <span aria-hidden>🤫</span>
        <span className="secret-entry-label">{t('secret.entry')}</span>
        {draft.secrets.length > 0 && (
          <span className="secret-entry-count">
            {t('secret.countBadge', { n: draft.secrets.length })}
          </span>
        )}
      </button>

      <button
        type="button"
        className="big-cta bottom"
        onClick={async () => {
          engine.stop();
          await saveDraft();
          nav('/perform');
        }}
      >
        {t('stageScreen.toPerform')}
      </button>

      {/* 비밀이 열리는 연출. 아이가 여기서 시험한 그대로 감상자도 본다. */}
      <SecretRevealLayer ref={revealRef} secrets={draft.secrets} />

      {secretsOpen && (
        <SecretSheet
          workId={draft.id}
          keys={draft.keys}
          secrets={draft.secrets}
          assets={draft.assets}
          engine={engine}
          onPatchSecrets={(secrets: Secret[]) => patchDraft({ secrets })}
          onAddAsset={(asset: AssetRef) => patchDraft({ assets: [...draft.assets, asset] })}
          onClose={() => {
            setSecretsOpen(false);
            void saveDraft();
          }}
        />
      )}
    </main>
  );
}
