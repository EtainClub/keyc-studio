/**
 * 공유 피드.
 *
 * Firestore의 works 컬렉션 list는 클라이언트에 열지 않는다. Cloud Function이
 * 공개된 작품만 고르고 카드에 필요한 최소 필드만 내려준다.
 *
 * ── 개수가 늘어나는 것에 대한 대비 ──
 * 한 번에 다 받지 않는다. 서버가 커서를 주고, 화면 끝이 보이면 다음 쪽을 이어 붙인다.
 * 검색과 작성자 필터도 서버에서 처리한다 — 받아온 것만 거르면 "안 불러온 작품은
 * 검색해도 안 나오는" 조용한 거짓말이 된다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  explainFirebaseError,
  fetchPublicFeed,
  type FeedCursor,
  type PublicFeedItem,
} from '../../storage/remote';
import { useAppState } from '../state';
import { ProfileAvatar } from '../components/ProfileAvatar';

/** 타자를 멈춘 뒤 이만큼 기다렸다 검색한다. 한 글자마다 서버를 부르지 않기 위한 것. */
const SEARCH_DEBOUNCE_MS = 400;

export function FeedScreen() {
  const nav = useNavigate();
  const { engine, startNewDraft } = useAppState();

  const [items, setItems] = useState<PublicFeedItem[] | null>(null);
  const [cursor, setCursor] = useState<FeedCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [brokenThumbs, setBrokenThumbs] = useState<ReadonlySet<string>>(new Set());

  /** 입력창에 보이는 값과 실제로 서버에 보낸 값을 나눈다. 사이의 지연이 디바운스다. */
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [authorNick, setAuthorNick] = useState('');

  /**
   * 이어보기 요청이 겹치지 않게 잠근다.
   * state로 잡으면 렌더 사이에 두 번 발사돼 같은 쪽이 두 번 붙는다.
   */
  const loadingRef = useRef(false);
  /** 조건이 바뀌면 이전 요청의 응답은 버린다. 늦게 온 옛 결과가 새 목록을 덮지 않도록. */
  const requestId = useRef(0);

  const load = useCallback(
    async (opts: { cursor: FeedCursor | null; append: boolean }) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const mine = ++requestId.current;
      if (opts.append) setLoadingMore(true);
      setError('');

      try {
        const page = await fetchPublicFeed({
          search,
          authorNick,
          cursor: opts.cursor,
        });
        if (mine !== requestId.current) return;
        setItems((prev) => {
          if (!opts.append || !prev) return page.items;
          // 같은 작품이 두 번 붙지 않게 한다 — 커서 경계에서 겹칠 수 있다.
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
        });
        setCursor(page.nextCursor);
      } catch (cause) {
        if (mine !== requestId.current) return;
        if (!opts.append) setItems([]);
        setError(explainFirebaseError(cause));
        setCursor(null);
      } finally {
        loadingRef.current = false;
        setLoadingMore(false);
      }
    },
    [search, authorNick],
  );

  // 검색어·작성자가 바뀌면 처음부터 다시 받는다.
  useEffect(() => {
    setItems(null);
    setCursor(null);
    void load({ cursor: null, append: false });
  }, [load]);

  // 타자가 멎으면 그때 검색어를 확정한다.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  /**
   * 목록 끝이 보이면 다음 쪽을 부른다.
   * "더 보기" 버튼도 함께 둔다 — 스크롤로만 이어지면 키보드 사용자는 끝에 닿을 수 없다.
   */
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void load({ cursor, append: true });
      },
      { rootMargin: '320px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [cursor, load]);

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

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setAuthorNick('');
  };

  const filtered = Boolean(search || authorNick);
  const empty = items?.length === 0;

  return (
    <main className="screen feed">
      <header className="feed-head">
        <div>
          <p className="feed-kicker">KEYC STAGE</p>
          <h1>키크 스테이지</h1>
          <p>모두의 키크 공연을 만나고 다시 연주해 보세요.</p>
        </div>
      </header>

      <section className="feed-tools">
        <label className="feed-search">
          <span className="visually-hidden">공연 찾기</span>
          <span className="feed-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            name="feed-search"
            autoComplete="off"
            placeholder="제목·힌트·별명으로 찾기…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              className="feed-search-clear"
              aria-label="검색어 지우기"
              onClick={() => setSearchInput('')}
            >
              ✕
            </button>
          )}
        </label>

        {authorNick && (
          <div className="feed-chips">
            <button
              type="button"
              className="chip on feed-filter-chip"
              aria-label={`${authorNick} 작성자 필터 끄기`}
              onClick={() => setAuthorNick('')}
            >
              {authorNick}의 공연만 <span aria-hidden>✕</span>
            </button>
          </div>
        )}
      </section>

      {/* 결과 개수는 스크린리더에도 알린다. 검색은 화면이 조용히 바뀌는 대표적인 자리다. */}
      <p className="feed-status" role="status" aria-live="polite">
        {items === null
          ? '키크 스테이지를 불러오는 중…'
          : filtered
            ? `${items.length}개 찾았어요${cursor ? ' (더 있어요)' : ''}`
            : ''}
      </p>

      {empty ? (
        <section className="feed-empty">
          <span className="feed-empty-icon" aria-hidden="true">
            {error ? '↻' : filtered ? '🔍' : '♫'}
          </span>
          <h2>
            {error
              ? '스테이지를 불러오지 못했어요'
              : filtered
                ? '찾는 공연이 없어요'
                : '아직 공개된 공연이 없어요'}
          </h2>
          <p>
            {error ||
              (filtered
                ? '다른 말로 찾아보거나 조건을 지워 보세요.'
                : '첫 공연을 완성해 공개하면 이곳에서 모두 함께 리플레이할 수 있어요.')}
          </p>
          {error ? (
            <button
              type="button"
              className="chip primary wide"
              onClick={() => void load({ cursor: null, append: false })}
            >
              다시 불러오기
            </button>
          ) : filtered ? (
            <button type="button" className="chip primary wide" onClick={clearFilters}>
              조건 지우기
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
                  {/*
                   * hidden 속성으로 숨기려 하면 안 된다. `.feed-thumb img`의
                   * `display: block`이 UA의 `[hidden] { display: none }`을 이겨서
                   * 깨진 이미지 아이콘이 그대로 남는다 — 실제로 그 상태였다.
                   * 상태로 갈아끼우고, 빈 자리 대신 대체 그림을 보여준다.
                   */}
                  {brokenThumbs.has(item.id) ? (
                    <span className="feed-thumb-fallback" aria-hidden="true">♫</span>
                  ) : (
                    <img
                      src={`/thumb/${item.id}`}
                      alt=""
                      loading="lazy"
                      width={640}
                      height={400}
                      onError={() => setBrokenThumbs((prev) => new Set(prev).add(item.id))}
                    />
                  )}
                </div>
                <span className="feed-badge">공개</span>
                <span className="feed-duration">{Math.round(item.durationMs / 1000)}초</span>
              </div>
              <div className="feed-card-body">
                <div className="feed-card-copy">
                  <div className="feed-author-row">
                    {item.avatarUrl ? (
                      <ProfileAvatar url={item.avatarUrl} name={item.authorNick} />
                    ) : null}
                    {/* 별명을 누르면 그 사람 공연만 본다. 목록에서 바로 좁히는 가장 짧은 길. */}
                    <button
                      type="button"
                      className="feed-author"
                      aria-label={`${item.authorNick}의 공연만 보기`}
                      onClick={() => setAuthorNick(item.authorNick)}
                    >
                      {item.authorNick}의 공연
                    </button>
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

      {cursor && (
        <div className="feed-more" ref={sentinel}>
          <button
            type="button"
            className="chip wide"
            disabled={loadingMore}
            onClick={() => void load({ cursor, append: true })}
          >
            {loadingMore ? '불러오는 중…' : '더 보기'}
          </button>
        </div>
      )}
    </main>
  );
}
