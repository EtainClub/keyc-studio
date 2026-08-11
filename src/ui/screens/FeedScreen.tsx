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
 *
 * ── [모두]/[그룹] 탭 ──
 * 이 화면은 이제 공개 피드 하나가 아니라 둘을 오간다. 탭 상태는 컴포넌트 state가
 * 아니라 URL 쿼리(`g`)에 둔다 — 그래야 그룹 리플레이 링크(`/w/:id?g=...`)에서
 * 뒤로가기를 눌렀을 때 그룹 탭으로 돌아오고, 새로고침해도 탭이 안 날아간다.
 *
 * 공개 피드의 훅(load/cursor/sort/search/authorNick)은 아래 `PublicFeedSection`으로
 * 그대로 옮겼을 뿐 손대지 않았다 — [그룹] 탭일 때 그 훅들을 조건부로 부르면 React
 * 규칙 위반이라, 통째로 별도 컴포넌트로 빼서 탭에 따라 마운트/언마운트되게 했다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  explainFirebaseError,
  fetchPublicFeed,
  type FeedCursor,
  type FeedSort,
  type PublicFeedItem,
} from '../../storage/remote';
import { listMyGroups, type MyGroup } from '../../storage/groups';
import { PUBLIC_ORIGIN } from '../../storage/firebase';
import { useAppState } from '../state';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { GroupStageScreen } from './GroupStageScreen';

/** 타자를 멈춘 뒤 이만큼 기다렸다 검색한다. 한 글자마다 서버를 부르지 않기 위한 것. */
const SEARCH_DEBOUNCE_MS = 400;

const SORTS: { id: FeedSort; label: string }[] = [
  { id: 'latest', label: '최신순' },
  { id: 'popular', label: '많이 들은 순' },
];

export function FeedScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  // 그룹 탭에 있는지는 'g' 키가 있는지로 본다 — 값이 빈 문자열이어도(아직 그룹을
  // 고르기 전) 그룹 탭에 있는 것이다. 값의 진위로만 판단하면 "그룹 탭 진입, 미선택"
  // 상태를 표현할 방법이 없어 [그룹] 버튼을 눌러도 탭이 전환되지 않는다.
  const activeTab: 'all' | 'group' = searchParams.has('g') ? 'group' : 'all';
  const groupId = searchParams.get('g') || null;

  const [myGroups, setMyGroups] = useState<MyGroup[] | null>(null);
  /**
   * 목록을 못 불러온 것과 "그룹이 없는 것"은 다르다.
   * 예전에는 실패를 빈 배열로 삼켜서, 새로고침 뒤 목록을 못 읽으면 화면이
   * "아직 참여한 그룹이 없어요"라고 **거짓말**을 했다 — 참여한 그룹이 사라진 것처럼
   * 보이는 신고의 절반이 이것이었다. 실패는 실패로 보여주고 다시 시도할 길을 준다.
   */
  const [groupsError, setGroupsError] = useState('');
  // [그룹] 탭에 처음 들어갈 때만 내 그룹 목록을 읽는다 — 이 화면이 떠 있는 동안
  // 그룹이 늘어나는 경우(다른 탭에서 참여)는 없으니 매번 다시 읽을 이유가 없다.
  const groupsRequestedRef = useRef(false);

  const loadMyGroups = useCallback(() => {
    setGroupsError('');
    setMyGroups(null);
    return listMyGroups()
      .then(setMyGroups)
      .catch((cause: unknown) => {
        setMyGroups([]);
        setGroupsError(cause instanceof Error ? cause.message : '내 그룹을 불러오지 못했어요');
      });
  }, []);

  useEffect(() => {
    if (activeTab !== 'group' || groupsRequestedRef.current) return;
    groupsRequestedRef.current = true;
    void loadMyGroups();
  }, [activeTab, loadMyGroups]);

  // 그룹이 정확히 하나뿐이면 칩 하나만 있는 고르기 화면을 한 번 더 거치게 하지
  // 않는다 — 바로 그 그룹으로 들어간다. 딱 한 번만이다: 이 ref가 없으면 "다른 그룹"
  // 버튼으로 g를 비워도 그룹이 하나뿐인 한 이 effect가 곧바로 같은 그룹으로 되돌려
  // 놓아서, 사용자 눈에는 그룹 고르기 화면이 뜬 적도 없이 스테이지만 깜빡이는
  // 것처럼 보인다(실제로 그 버그였다).
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (
      activeTab === 'group' &&
      !groupId &&
      myGroups &&
      myGroups.length === 1 &&
      !autoPickedRef.current
    ) {
      autoPickedRef.current = true;
      setSearchParams({ g: myGroups[0].id }, { replace: true });
    }
  }, [activeTab, groupId, myGroups, setSearchParams]);

  const selectAll = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('g');
    setSearchParams(next);
  };
  const selectGroupTab = () => {
    if (activeTab === 'group') return;
    // 'g' 키를 빈 값으로라도 넣어야 activeTab이 'group'으로 바뀐다 — 위 주석 참고.
    setSearchParams({ g: '' });
  };

  return (
    <main className="screen feed">
      <header className="feed-head">
        <div>
          <p className="feed-kicker">KEYC STAGE</p>
          <h1>키크 스테이지</h1>
          <p>모두의 키크 공연을 만나고 다시 연주해 보세요.</p>
        </div>
      </header>

      {/* 정렬 세그먼트와 헷갈리지 않도록 라벨을 분명히 다르게 둔다. */}
      <div className="seg feed-scope" role="group" aria-label="스테이지 종류">
        <button
          type="button"
          className={`seg-btn ${activeTab === 'all' ? 'on' : ''}`}
          aria-pressed={activeTab === 'all'}
          onClick={selectAll}
        >
          모두
        </button>
        <button
          type="button"
          className={`seg-btn ${activeTab === 'group' ? 'on' : ''}`}
          aria-pressed={activeTab === 'group'}
          onClick={selectGroupTab}
        >
          그룹
        </button>
      </div>

      {activeTab === 'all' ? (
        <PublicFeedSection />
      ) : groupId ? (
        // key=groupId: 그룹을 바꾸면 검색어·정렬 같은 내부 state를 새로 시작한다.
        // (자세한 이유는 GroupStageScreen 상단 주석 참고.)
        <GroupStageScreen
          key={groupId}
          groupId={groupId}
          onSwitchGroup={() => setSearchParams({ g: '' })}
          onDeleted={() => {
            /*
             * 삭제한 그룹은 목록 캐시에도 남아 있다 — groupsRequestedRef가 한 번만
             * 읽게 막고 있으므로 여기서 직접 다시 읽어야 방금 지운 그룹이 사라진다.
             *
             * autoPickedRef도 함께 세운다. 남은 그룹이 하나뿐일 때 자동 선택이 돌면
             * 삭제하자마자 다른 그룹 스테이지로 끌려 들어가서, 방금 지운 것이
             * 맞는지 확인할 화면을 못 본다.
             */
            autoPickedRef.current = true;
            setSearchParams({ g: '' });
            void loadMyGroups();
          }}
        />
      ) : (
        <GroupPicker
          groups={myGroups}
          error={groupsError}
          onRetry={() => void loadMyGroups()}
          onSelect={(id) => setSearchParams({ g: id })}
        />
      )}
    </main>
  );
}

/** [그룹] 탭인데 아직 그룹을 안 골랐을 때 보여주는 목록/빈 상태. */
function GroupPicker({
  groups,
  error,
  onRetry,
  onSelect,
}: {
  groups: MyGroup[] | null;
  error: string;
  onRetry: () => void;
  onSelect: (id: string) => void;
}) {
  const nav = useNavigate();

  if (groups === null) {
    return (
      <p className="feed-status" role="status" aria-live="polite">
        내 그룹을 불러오는 중…
      </p>
    );
  }

  // 실패는 "그룹 없음"보다 먼저 본다 — 순서가 반대면 실패가 빈 상태로 위장된다.
  if (error) {
    return (
      <section className="feed-empty">
        <span className="feed-empty-icon" aria-hidden="true">↻</span>
        <h2>내 그룹을 불러오지 못했어요</h2>
        <p>{error}</p>
        <button type="button" className="chip primary wide" onClick={onRetry}>
          다시 불러오기
        </button>
      </section>
    );
  }

  if (groups.length === 0) {
    return (
      <section className="feed-empty">
        <span className="feed-empty-icon" aria-hidden="true">👥</span>
        <h2>아직 참여한 그룹이 없어요</h2>
        <p>초대 코드가 있으면 입장하고, 없으면 새로 만들어 보세요.</p>
        <button type="button" className="chip primary wide" onClick={() => nav('/g/join')}>
          코드로 입장하기
        </button>
        <button type="button" className="chip wide" onClick={() => nav('/g/join?new=1')}>
          그룹 만들기
        </button>
      </section>
    );
  }

  return (
    <section aria-label="내 그룹 고르기">
      <p className="feed-status">들어갈 그룹을 골라주세요.</p>
      <div className="feed-chips">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className="chip"
            aria-label={`${g.name} 그룹 스테이지로 이동`}
            onClick={() => onSelect(g.id)}
          >
            {g.name}
          </button>
        ))}
      </div>
      {/* 이미 들어간 그룹이 있어도 다른 그룹에 코드로 더 들어갈 수 있어야 한다 —
          목록만 있으면 이미 입장한 그룹 밖으로는 못 나가는 화면이 된다. */}
      <div className="join-group-panel group-picker-more">
        <button type="button" className="chip wide" onClick={() => nav('/g/join')}>
          코드로 새 그룹 입장하기
        </button>
        <button type="button" className="chip wide" onClick={() => nav('/g/join?new=1')}>
          그룹 만들기
        </button>
      </div>
    </section>
  );
}

/**
 * 공개 피드 본체 — 원래 FeedScreen 전체였던 로직을 그대로 옮겼다.
 * load/cursor/sort/search/authorNick 어느 것도 바뀌지 않았다.
 */
function PublicFeedSection() {
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
  const [sort, setSort] = useState<FeedSort>('latest');

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
          sort,
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
    [sort, search, authorNick],
  );

  // 정렬·검색어·작성자가 바뀌면 처음부터 다시 받는다.
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
    <>
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

        {/* 정렬은 둘 중 하나다 — 세그먼트로 두어 지금 어느 쪽인지 한눈에 보이게 한다. */}
        <div className="seg feed-sort" role="group" aria-label="정렬 기준">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`seg-btn ${sort === s.id ? 'on' : ''}`}
              aria-pressed={sort === s.id}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

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
                      src={`${PUBLIC_ORIGIN}/thumb/${item.id}`}
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
                  <p className="feed-replay-count">
                    <span aria-hidden="true">▶</span>
                    리플레이 {item.replayCount.toLocaleString('ko-KR')}회
                  </p>
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
    </>
  );
}
