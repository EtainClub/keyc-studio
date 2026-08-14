/**
 * ⑤ 작품 카드.
 *
 * 제목과 한 줄 힌트를 받는다. 공유는 여기서 바로 일어나지 않고,
 * 공유 게이트를 한 번 거친다 — 서버가 등장하는 유일한 관문이다.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { workBytes } from '../../storage/db';
import { explainFirebaseError, shareUrl, unshareWork } from '../../storage/remote';
import { t } from '../../i18n';
import { HINT_MAX, TITLE_MAX } from '../../work-model/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KeycapGrid, type GridHandle } from '../components/KeycapGrid';
import { useAppState } from '../state';
import { ShareGate } from './ShareGateScreen';

export function WorkCardScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { engine, draft, patchDraft, saveDraft } = useAppState();
  const gridRef = useRef<GridHandle>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  /** 성공 안내. 스스로 사라진다 — 아이가 닫을 것을 하나 더 만들지 않는다. */
  const [notice, setNotice] = useState('');
  const [shareError, setShareError] = useState('');

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!draft) {
      nav('/', { replace: true });
      return;
    }
    engine.setVisualHandler((e) => gridRef.current?.fire(e.key, e.source));
    void engine.prepare(draft.keys);
    workBytes(draft.id).then(setBytes).catch(() => setBytes(null));
    return () => engine.stop();
  }, [draft, engine, nav]);

  // 공연 화면에서 "방금 공연 다시 보기"로 넘어온 경우 바로 한 번 틀어준다.
  const autoReplayed = useRef(false);
  useEffect(() => {
    if (!draft || autoReplayed.current || params.get('replay') !== '1') return;
    autoReplayed.current = true;
    void replay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft) return null;

  async function replay() {
    if (!draft) return;
    await engine.unlock();
    setReplaying(true);
    engine.playReplay(draft, { onEnd: () => setReplaying(false) });
  }

  const copy = async () => {
    const link = url ?? shareUrl(draft.id);
    try {
      await navigator.clipboard.writeText(link);
      setNotice(t('card.copied'));
    } catch {
      // prompt()를 띄우지 않는다. 링크는 이미 화면에 그대로 보이므로
      // 무엇을 하면 되는지만 알려주면 된다.
      setNotice(t('card.copyFailed'));
    }
  };

  const stopSharing = async () => {
    setConfirmStop(false);
    try {
      await unshareWork(draft.id);
      patchDraft({ visibility: 'local' });
      setUrl(null);
      setNotice(t('card.shareStopped'));
    } catch (e) {
      setShareError(t('card.stopFailed', { reason: explainFirebaseError(e) }));
    }
  };

  return (
    <main className="screen card">
      <header className="bar">
        <button type="button" className="bar-back" onClick={() => nav('/perform')}>
          {t('card.backToPerform')}
        </button>
        <h1>{t('card.title')}</h1>
      </header>

      {/* 이 화면의 키캡은 볼거리다. "작품 다시 보기"로 재생하는 동안에만 밝아진다. */}
      <KeycapGrid ref={gridRef} keys={draft.keys} disabled muted={!replaying} />

      <button type="button" className="chip wide" onClick={replay} disabled={replaying}>
        {replaying ? t('card.replaying') : t('card.replay')}
      </button>

      <label className="field">
        <span>{t('card.titleField')}</span>
        <input
          value={draft.title}
          maxLength={TITLE_MAX}
          placeholder={t('card.titlePlaceholder')}
          onChange={(e) => patchDraft({ title: e.target.value })}
        />
        <em>
          {Array.from(draft.title).length}/{TITLE_MAX}
        </em>
      </label>

      <label className="field">
        <span>{t('card.hintField')}</span>
        <input
          value={draft.hint}
          maxLength={HINT_MAX}
          placeholder={t('card.hintPlaceholder')}
          onChange={(e) => patchDraft({ hint: e.target.value })}
        />
        <em>
          {Array.from(draft.hint).length}/{HINT_MAX}
        </em>
      </label>

      <p className="note">
        {t('card.author', { nick: draft.authorNick })}
        {bytes !== null && t('card.size', { kb: Math.round(bytes / 1024) })}
      </p>

      {!url && draft.visibility === 'local' && (
        <button
          type="button"
          className="big-cta"
          onClick={async () => {
            await saveDraft({ thumb: true });
            setGateOpen(true);
          }}
        >
          {t('card.share')}
        </button>
      )}

      {(url || draft.visibility === 'link') && (
        <section className="share-done">
          <p className="done-msg">{t('card.sharing')}</p>
          <code className="share-link">{url ?? shareUrl(draft.id)}</code>
          <div className="draw-row">
            <button type="button" className="chip" onClick={copy}>
              {t('card.copyLink')}
            </button>
            <button type="button" className="chip primary" onClick={() => nav(`/w/${draft.id}`)}>
              {t('card.goSee')}
            </button>
          </div>
          <button type="button" className="chip wide" onClick={() => setConfirmStop(true)}>
            {t('card.stopShare')}
          </button>
        </section>
      )}

      {/* 결과는 화면 안에서 알린다. 스크린리더도 읽도록 live 영역으로 둔다. */}
      <p className="note" role="status" aria-live="polite">
        {notice}
      </p>
      {shareError && <p className="warn">{shareError}</p>}

      <button type="button" className="chip wide" onClick={() => nav('/')}>
        {t('card.toHome')}
      </button>

      {confirmStop && (
        <ConfirmDialog
          title={t('card.stopTitle')}
          detail={t('card.stopDetail')}
          confirmLabel={t('card.stopShare')}
          onConfirm={() => void stopSharing()}
          onCancel={() => setConfirmStop(false)}
        />
      )}

      {gateOpen && (
        <ShareGate
          work={draft}
          onCancel={() => setGateOpen(false)}
          onDone={(link, published) => {
            setGateOpen(false);
            setUrl(link);
            patchDraft({
              visibility: published.visibility,
              assets: published.assets,
              authorUid: published.authorUid,
              authorNick: published.authorNick,
            });
          }}
        />
      )}
    </main>
  );
}
