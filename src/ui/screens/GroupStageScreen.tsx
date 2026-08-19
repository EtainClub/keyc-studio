/**
 * 그룹 스테이지 — FeedScreen 안에서 [그룹] 탭을 눌렀을 때, 그리고 그룹을 하나
 * 고른 뒤에 보이는 화면.
 *
 * 구조는 FeedScreen(공개 피드)을 그대로 베꼈다: 커서 페이지네이션, 400ms 디바운스
 * 검색, 중복 방지, IntersectionObserver + "더 보기" 버튼. 전부 같은 이유로 같은
 * 모양이어야 해서 새로 궁리하지 않았다. 바뀐 건 데이터 출처(fetchGroupStage)와
 * 카드에 붙는 "우리 그룹만" 배지, 들었는지 여부뿐이다.
 *
 * 라우트가 아니라 groupId를 props로 받는다 — FeedScreen이 자기 탭 상태에 맞춰
 * 이 컴포넌트를 끼워 넣는 구조라, 이 화면 자체가 URL을 소유하지 않는다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  deleteGroup,
  fetchGroupInviteCode,
  fetchGroupStage,
  formatGroupCode,
  GROUP_MEMBER_MAX,
  type GroupStageSort,
} from '../../storage/groups';
import type { GroupStageCursor, GroupStageItem, GroupSummary } from '../../storage/group-feed';
import { PUBLIC_ORIGIN } from '../../storage/firebase';
import { num, t } from '../../i18n';
import { useAppState } from '../state';
import { ProfileAvatar } from '../components/ProfileAvatar';

const SEARCH_DEBOUNCE_MS = 400;

/**
 * 'unheard' 라벨은 반드시 "덜 들린 순"이어야 한다.
 *
 * 서버(listGroupStage)는 이 정렬을 "고유 청취자 수가 적은 순"으로 구현한다 —
 * 내가 아직 안 들은 작품만 골라 앞세우는 개인화된 정렬이 아니다. 그래서 "내가 안
 * 들은 순"이라고 쓰면, 이미 다른 사람들이 여럿 들었지만 나만 안 들은 작품과
 * 애초에 아무도 안 들은 작품을 구분 못 해 거짓말이 된다. "덜 들린 순"은 서버가
 * 실제로 하는 일을 정확히 설명한다.
 */
const SORTS: { id: GroupStageSort; label: string }[] = [
  { id: 'unheard', label: t('feed.sort.unheard') },
  { id: 'latest', label: t('feed.sort.latest') },
  { id: 'popular', label: t('feed.sort.popular') },
];

/**
 * 호출하는 쪽(FeedScreen)은 반드시 `key={groupId}`를 함께 넘겨야 한다. groupId만
 * 바뀌고 key가 같으면 React가 같은 인스턴스를 재사용해서 검색어·정렬 같은 state가
 * 이전 그룹 것을 그대로 물고 넘어간다 — key를 다르게 주면 그룹을 바꿀 때마다
 * 깨끗한 인스턴스로 다시 시작해서 이 파일 안에서 따로 초기화 코드를 짤 필요가 없다.
 */
export function GroupStageScreen({
  groupId,
  onSwitchGroup,
  onDeleted,
}: {
  groupId: string;
  /** "다른 그룹" — 이 그룹 밖으로 나가 그룹 고르기(+ 코드로 새 그룹 입장)로 돌아간다.
   *  이 화면은 URL을 소유하지 않으니(위 주석 참고) 실제 전환은 FeedScreen이 한다. */
  onSwitchGroup: () => void;
  /** 그룹이 실제로 지워진 뒤. 화면 전환과 "내 그룹" 목록 갱신은 FeedScreen 몫이다. */
  onDeleted: () => void;
}) {
  const nav = useNavigate();
  const { engine } = useAppState();

  const [items, setItems] = useState<GroupStageItem[] | null>(null);
  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [listenedCount, setListenedCount] = useState(0);
  const [cursor, setCursor] = useState<GroupStageCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [brokenThumbs, setBrokenThumbs] = useState<ReadonlySet<string>>(new Set());
  // 초대 코드는 주최자만 다시 볼 수 있다 — 서버가 role을 다시 확인하므로 여기 role
  // 체크는 버튼을 아예 안 보이게 하는 용도일 뿐, 보안 경계가 아니다.
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);

  /**
   * 삭제는 되돌릴 수 없다. 그래서 버튼 한 번으로는 실행하지 않고, 그룹 이름을
   * 다시 보여주는 확인 단계를 한 번 거친다 — `window.confirm`을 쓰지 않는 이유는
   * 어떤 그룹이 지워지는지, 작품은 남는지를 그 상자 안에서 설명할 수 없어서다.
   */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  /** 입력창에 보이는 값과 실제로 서버에 보낸 값을 나눈다. 사이의 지연이 디바운스다. */
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<GroupStageSort>('unheard');

  /**
   * 이어보기 요청이 겹치지 않게 잠근다.
   * state로 잡으면 렌더 사이에 두 번 발사돼 같은 쪽이 두 번 붙는다.
   */
  const loadingRef = useRef(false);
  /** 조건이 바뀌면 이전 요청의 응답은 버린다. 늦게 온 옛 결과가 새 목록을 덮지 않도록. */
  const requestId = useRef(0);

  const load = useCallback(
    async (opts: { cursor: GroupStageCursor | null; append: boolean }) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const mine = ++requestId.current;
      if (opts.append) setLoadingMore(true);
      setError('');

      try {
        const page = await fetchGroupStage({ groupId, sort, search, cursor: opts.cursor });
        if (mine !== requestId.current) return;
        setItems((prev) => {
          if (!opts.append || !prev) return page.items;
          // 같은 작품이 두 번 붙지 않게 한다 — 커서 경계에서 겹칠 수 있다.
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
        });
        setCursor(page.nextCursor);
        setGroup(page.group);
        setListenedCount(page.listenedCount);
      } catch (cause) {
        if (mine !== requestId.current) return;
        if (!opts.append) setItems([]);
        // groups.ts의 callable들은 이미 사람이 읽을 수 있는 한국어 메시지를 던진다
        // (requireUid/withTimeout 참고) — remote.ts의 explainFirebaseError처럼
        // 다시 번역할 필요가 없다.
        setError(cause instanceof Error ? cause.message : t('group.loadFailed'));
        setCursor(null);
      } finally {
        loadingRef.current = false;
        setLoadingMore(false);
      }
    },
    [groupId, sort, search],
  );

  // 그룹·정렬·검색어가 바뀌면 처음부터 다시 받는다.
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
    // 쿼리스트링 g가 그룹 집계의 유일한 근거다 — ViewScreen이 이 값을 읽어서
    // recordPlay에 groupId로 실어 보낸다. 빠뜨리면 이 리플레이는 어느 그룹의
    // "한 표"로도 잡히지 않는다(고유 청취자 수가 영영 늘지 않는다).
    nav(`/w/${id}?g=${groupId}`);
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearch('');
  };

  const loadInviteCode = async () => {
    if (loadingCode) return;
    setLoadingCode(true);
    setInviteError('');
    try {
      setInviteCode(await fetchGroupInviteCode(groupId));
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : t('group.inviteLoadFailed'));
    } finally {
      setLoadingCode(false);
    }
  };

  const copyInviteCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      // 클립보드 권한이 없는 브라우저·컨텍스트도 있다 — 코드는 화면에 그대로 남아
      // 있으니 손으로 옮겨 적을 수 있다.
    }
  };

  const removeGroup = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteGroup(groupId);
      onDeleted();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : t('group.deleteFailed'));
      setDeleting(false);
    }
    // 성공했을 때는 deleting을 되돌리지 않는다 — 이 컴포넌트가 곧 사라지므로,
    // 없어진 화면의 버튼이 잠깐 다시 눌리는 상태를 만들 이유가 없다.
  };

  const filtered = Boolean(search);
  const empty = items?.length === 0;

  return (
    <section className="group-stage">
      <header className="feed-head group-stage-head">
        <div>
          <p className="feed-kicker">GROUP STAGE</p>
          <h1>{group?.name || t('group.title')}</h1>
          {/* 진행률은 화면이 조용히 갱신되는 자리라 스크린리더에도 알린다. */}
          <p className="group-stage-progress" role="status" aria-live="polite">
            {/* 전체가 앞, 들은 수가 뒤다 — "12개 중 7개 들었어요". 순서가 바뀌면 뜻이 뒤집힌다. */}
            {group ? t('group.progress', { total: num(group.entryCount), listened: num(listenedCount) }) : ''}
          </p>
          {/* 정원을 함께 보여준다 — "몇 명까지 부를 수 있나"가 주최자의 첫 질문이고,
              그 답이 화면에 없으면 초대할 인원을 스스로 줄여 잡는다. */}
          {group ? (
            <p className="group-stage-members">
              {t('group.members', { n: num(group.memberCount), max: num(GROUP_MEMBER_MAX) })}
            </p>
          ) : null}
        </div>
        <div className="group-stage-actions">
          {/* 이미 이 그룹에 들어와 있어도 다른 그룹(코드로 새로 입장할 그룹 포함)으로
              옮겨갈 방법이 있어야 한다 — 이 화면 안에는 그럴 길이 없었다. */}
          <button type="button" className="chip" onClick={onSwitchGroup}>
            {t('group.switch')}
          </button>
          {group?.role === 'owner' && (
            <div className="group-invite">
              {inviteCode ? (
                <>
                  <p className="group-invite-code" aria-label={t('group.inviteCodeAria', { code: inviteCode })}>
                    {formatGroupCode(inviteCode)}
                  </p>
                  <button type="button" className="chip" onClick={() => void copyInviteCode()}>
                    {codeCopied ? t('group.copied') : t('group.copyCode')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="chip"
                  onClick={() => void loadInviteCode()}
                  disabled={loadingCode}
                >
                  {loadingCode ? t('group.loadingCode') : t('group.showCode')}
                </button>
              )}
              {inviteError && (
                <p className="warn" role="alert">
                  {inviteError}
                </p>
              )}
            </div>
          )}
          {/* 삭제는 만든 사람만. 서버가 ownerUid를 다시 검사하므로 이 조건은
              보안 경계가 아니라 남에게 헛된 버튼을 보이지 않기 위한 것이다. */}
          {group?.role === 'owner' && !confirmingDelete && (
            <button
              type="button"
              className="chip ghost danger"
              onClick={() => {
                setDeleteError('');
                setConfirmingDelete(true);
              }}
            >
              {t('group.delete')}
            </button>
          )}
        </div>
      </header>

      {confirmingDelete && (
        <section className="group-delete-confirm" role="alertdialog" aria-label={t('group.deleteConfirmAria')}>
          <h2>{t('group.deleteTitle', { name: group?.name || t('group.thisGroup') })}</h2>
          <p>
            {t('group.deleteBody', { members: num(group?.memberCount ?? 0) })}{' '}
            <strong>{t('group.deleteIrreversible')}</strong>
          </p>
          {/* 가장 흔한 걱정을 먼저 지운다 — 내 작품까지 지워지는 줄 알면 아무도 못 누른다. */}
          <p className="note">{t('group.deleteNote')}</p>
          {deleteError && (
            <p className="warn" role="alert">
              {deleteError}
            </p>
          )}
          <div className="group-delete-actions">
            <button
              type="button"
              className="chip danger-solid"
              disabled={deleting}
              onClick={() => void removeGroup()}
            >
              {deleting ? t('group.deleting') : t('group.deleteConfirm')}
            </button>
            <button
              type="button"
              className="chip"
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
            >
              {t('group.deleteCancel')}
            </button>
          </div>
        </section>
      )}

      <section className="feed-tools">
        <label className="feed-search">
          <span className="visually-hidden">{t('group.searchLabel')}</span>
          <span className="feed-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            name="group-stage-search"
            autoComplete="off"
            placeholder={t('feed.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              className="feed-search-clear"
              aria-label={t('feed.clearSearch')}
              onClick={() => setSearchInput('')}
            >
              ✕
            </button>
          )}
        </label>

        <div className="seg feed-sort" role="group" aria-label={t('feed.sortAria')}>
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
      </section>

      <p className="feed-status" role="status" aria-live="polite">
        {items === null
          ? t('group.loading')
          : filtered
            ? (cursor
              ? t('feed.foundCountMore', { n: items.length })
              : t('feed.foundCount', { n: items.length }))
            : ''}
      </p>

      {empty ? (
        <section className="feed-empty">
          <span className="feed-empty-icon" aria-hidden="true">
            {error ? '↻' : filtered ? '🔍' : '♫'}
          </span>
          <h2>
            {error
              ? t('feed.loadFailed')
              : filtered
                ? t('feed.noMatch')
                : t('group.empty')}
          </h2>
          <p>
            {error ||
              (filtered
                ? t('feed.noMatchHelp')
                : t('group.emptyHelp'))}
          </p>
          {error ? (
            <button
              type="button"
              className="chip primary wide"
              onClick={() => void load({ cursor: null, append: false })}
            >
              {t('feed.reload')}
            </button>
          ) : filtered ? (
            <button type="button" className="chip primary wide" onClick={clearSearch}>
              {t('feed.clearFilters')}
            </button>
          ) : null}
        </section>
      ) : null}

      {items && items.length > 0 ? (
        <section className="feed-list" aria-label={t('group.listAria')}>
          {items.map((item) => {
            const title = item.title || t('common.untitled');
            return (
              <article
                className={`feed-card${item.listened ? ' feed-listened' : ''}`}
                key={item.id}
              >
                <div className="feed-cover">
                  <div className="feed-thumb">
                    {/* FeedScreen과 같은 이유로 hidden 대신 상태를 쓴다 — [hidden]을
                     * `.feed-thumb img`의 display:block이 이겨서 깨진 이미지 아이콘이
                     * 그대로 남는 게 실제로 있었던 버그다. */}
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
                  {/* 공개 피드와 구분되는 지점 — 그룹 밖 사람은 이 카드를 볼 수 없다. */}
                    <span className="feed-badge">{t('group.badgeGroupOnly')}</span>
                    <span className="feed-duration">{t('feed.duration', { seconds: Math.round(item.durationMs / 1000) })}</span>
                </div>
                <div className="feed-card-body">
                  <div className="feed-card-copy">
                    <div className="feed-author-row">
                      {item.avatarUrl ? <ProfileAvatar url={item.avatarUrl} name={item.authorNick} /> : null}
                      <span className="feed-author-static">{item.authorNick}</span>
                    </div>
                    <h2>{title}</h2>
                    {(item.mine || item.listened) && (
                      <div className="feed-tags">
                        {item.mine && <span className="feed-mine-badge">{t('group.badgeMine')}</span>}
                        {item.listened && (
                          <span className="feed-listened-badge" aria-hidden="true">{t('group.badgeListened')}</span>
                        )}
                      </div>
                    )}
                    {item.hint ? <p className="feed-hint">{item.hint}</p> : null}
                    <p className="feed-replay-count">
                      <span aria-hidden="true">▶</span>
                      {t('group.stats', { replays: num(item.replayCount), listeners: num(item.uniqueListeners) })}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="feed-replay"
                    aria-label={item.listened ? t('group.replayAriaListened', { title }) : t('feed.replayAria', { title })}
                    onClick={() => replay(item.id)}
                  >
                    <span aria-hidden="true">▶</span>
                    {t('feed.replay')}
                  </button>
                </div>
              </article>
            );
          })}
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
            {loadingMore ? t('feed.loadingMore') : t('feed.more')}
          </button>
        </div>
      )}
    </section>
  );
}
