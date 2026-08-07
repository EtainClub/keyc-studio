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
import { HINT_MAX, TITLE_MAX } from '../../work-model/types';
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
      alert('링크를 복사했어요');
    } catch {
      prompt('이 링크를 복사하세요', link);
    }
  };

  const stopSharing = async () => {
    if (!confirm('공유를 멈출까요? 올린 그림과 소리도 지워져요.')) return;
    try {
      await unshareWork(draft.id);
      patchDraft({ visibility: 'local' });
      setUrl(null);
    } catch (e) {
      alert(`공유를 멈추지 못했어요.\n${explainFirebaseError(e)}`);
    }
  };

  return (
    <main className="screen card">
      <header className="bar">
        <button type="button" className="bar-back" onClick={() => nav('/perform')}>
          ‹ 공연
        </button>
        <h1>작품 카드</h1>
      </header>

      <KeycapGrid ref={gridRef} keys={draft.keys} disabled />

      <button type="button" className="chip wide" onClick={replay} disabled={replaying}>
        {replaying ? '재생 중…' : '▶ 작품 다시 보기'}
      </button>

      <label className="field">
        <span>제목</span>
        <input
          value={draft.title}
          maxLength={TITLE_MAX}
          placeholder="예: 고양이의 하루"
          onChange={(e) => patchDraft({ title: e.target.value })}
        />
        <em>
          {Array.from(draft.title).length}/{TITLE_MAX}
        </em>
      </label>

      <label className="field">
        <span>한 줄 힌트</span>
        <input
          value={draft.hint}
          maxLength={HINT_MAX}
          placeholder="예: 고양이가 어디 가는지 봐주세요"
          onChange={(e) => patchDraft({ hint: e.target.value })}
        />
        <em>
          {Array.from(draft.hint).length}/{HINT_MAX}
        </em>
      </label>

      <p className="note">
        만든이: {draft.authorNick}
        {bytes !== null && ` · 작품 크기 ${Math.round(bytes / 1024)}KB`}
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
          공유하기
        </button>
      )}

      {(url || draft.visibility === 'link') && (
        <section className="share-done">
          <p className="done-msg">공유 중이에요 🎉</p>
          <code className="share-link">{url ?? shareUrl(draft.id)}</code>
          <div className="draw-row">
            <button type="button" className="chip" onClick={copy}>
              링크 복사
            </button>
            <button type="button" className="chip primary" onClick={() => nav(`/w/${draft.id}`)}>
              보러 가기
            </button>
          </div>
          <button type="button" className="chip wide" onClick={stopSharing}>
            공유 멈추기
          </button>
        </section>
      )}

      <button type="button" className="chip wide" onClick={() => nav('/')}>
        홈으로
      </button>

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
