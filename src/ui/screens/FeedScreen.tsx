/**
 * 공유 피드.
 *
 * Firestore의 works 컬렉션 list는 클라이언트에 열지 않는다. Cloud Function이
 * 공개된 작품만 고르고 카드에 필요한 최소 필드만 내려준다.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  explainFirebaseError,
  fetchPublicFeed,
  type PublicFeedItem,
} from '../../storage/remote';
import { useAppState } from '../state';
import { ProfileAvatar } from '../components/ProfileAvatar';

export function FeedScreen() {
  const nav = useNavigate();
  const { engine, startNewDraft } = useAppState();
  const [items, setItems] = useState<PublicFeedItem[] | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    setError('');
    fetchPublicFeed()
      .then(setItems)
      .catch((cause) => {
        setItems([]);
        setError(explainFirebaseError(cause));
      });
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const replay = (id: string) => {
    // 같은 탭 안에서 오디오를 먼저 열어두면 감상 화면 진입과 함께 리플레이가 시작된다.
    void engine.unlock();
    nav(`/w/${id}`);
  };

  const create = async () => {
    void engine.unlock();
    await startNewDraft();
    nav('/create');
  };

  return (
    <main className="screen feed">
      <header className="feed-head">
        <div>
          <p className="feed-kicker">KEYC STAGE</p>
          <h1>키크 스테이지</h1>
          <p>모두의 키크 공연을 만나고 다시 연주해 보세요.</p>
        </div>
        {items && items.length > 0 ? <span className="feed-count">{items.length}</span> : null}
      </header>

      {items === null ? <p className="note">키크 스테이지를 불러오는 중…</p> : null}

      {items?.length === 0 ? (
        <section className="feed-empty">
          <span className="feed-empty-icon" aria-hidden="true">{error ? '↻' : '♫'}</span>
          <h2>{error ? '스테이지를 불러오지 못했어요' : '아직 공개된 공연이 없어요'}</h2>
          <p>
            {error || '첫 공연을 완성해 공개하면 이곳에서 모두 함께 리플레이할 수 있어요.'}
          </p>
          {error ? (
            <button type="button" className="chip primary wide" onClick={refresh}>
              다시 불러오기
            </button>
          ) : (
            <button type="button" className="chip primary wide" onClick={create}>
              첫 작품 만들기
            </button>
          )}
        </section>
      ) : null}

      {items && items.length > 0 ? (
        <section className="feed-list" aria-label="키크 스테이지 공개 작품">
          {items.map((item, index) => (
            <article className={`feed-card${index === 0 ? ' featured' : ''}`} key={item.id}>
                <div className="feed-cover">
                  <div className="feed-thumb">
                    <img
                      src={`/thumb/${item.id}`}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                    />
                  </div>
                  <span className="feed-badge">공개</span>
                  <span className="feed-duration">{Math.round(item.durationMs / 1000)}초</span>
                </div>
                <div className="feed-card-body">
                  <div className="feed-card-copy">
                    <div className="feed-author-row">
                      {item.avatarUrl ? <ProfileAvatar url={item.avatarUrl} name={item.authorNick} /> : null}
                      <p className="feed-author">{item.authorNick}의 공연</p>
                    </div>
                    <h2>{item.title || '이름 없는 작품'}</h2>
                    {item.hint ? <p className="feed-hint">{item.hint}</p> : null}
                  </div>
                  <button
                    type="button"
                    className="feed-replay"
                    aria-label={`${item.title || '이름 없는 작품'} 리플레이`}
                    onClick={() => replay(item.id)}
                  >
                    <span aria-hidden="true">▶</span>
                    리플레이
                  </button>
                </div>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
