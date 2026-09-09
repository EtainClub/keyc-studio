/**
 * ① 홈.
 *
 * [+ 새로 만들기]가 화면에서 가장 크다. 그 아래에 내 작품, 맨 위에 오늘의 미션 한 줄.
 * 내 작품 목록은 IndexedDB에서 읽는다. 다른 사람의 공개 작품은 FeedScreen이
 * listPublicFeed Function을 통해 별도로 읽는다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../../i18n';
import { cancelWorkBackup, deleteAccountBackup } from '../../storage/account';
import {
  deleteWorkRecord,
  getWorkRecord,
  listWorkRecords,
  putWorkRecord,
  type WorkRecord,
} from '../../storage/db';
import { renderListThumb, THUMB_VERSION } from '../../storage/thumbnail';
import { missionOfDay } from '../../work-model/missions';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { WorkThumbnail } from '../components/WorkThumbnail';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { isShareCurrent } from '../draft-state';
import { hasSeenAppGuide, markAppGuideSeen } from '../first-guide';
import { useAppState } from '../state';

export function HomeScreen() {
  const nav = useNavigate();
  const { engine, startNewDraft, openDraft, profile, account, syncRevision } = useAppState();
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  /** 지우기를 누른 작품. 확인 창이 뜨는 동안 무엇을 지우는지 들고 있는다. */
  const [pendingDelete, setPendingDelete] = useState<WorkRecord | null>(null);
  /** 계정 백업을 못 지웠을 때. 로컬만 지우면 나중에 혼자 돌아오므로 알려야 한다. */
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const mission = missionOfDay();

  const refresh = useCallback(() => {
    listWorkRecords().then(setRecords).catch(() => setRecords([]));
  }, []);

  useEffect(refresh, [refresh, syncRevision]);

  /**
   * 썸네일이 없는 작품에 뒤늦게 하나 만들어 준다.
   *
   * 썸네일은 `saveDraft({thumb: true})`를 지나야 생긴다. 그런데 그 지점은 몇 군데뿐이라
   * **만들다 만 작품**은 썸네일 없이 남고, **계정에서 복원한 작품**은 아예 못 받는다
   * (썸네일은 로컬 전용이라 클라우드 문서에 없다). 둘 다 홈에서 빈 카드로 보인다.
   *
   * 여기서 만들어 저장해 두면 다음부터는 곧바로 뜬다. 한 작품당 한 번뿐인 비용이다.
   */
  useEffect(() => {
    let alive = true;
    // 판이 다른 썸네일도 '없는 것'으로 친다 — 예전 어두운 배경이 구워진 것들이다.
    const missing = records.filter((r) => !r.thumb || r.thumbV !== THUMB_VERSION);
    if (missing.length === 0) return;

    (async () => {
      for (const record of missing) {
        const thumb = await renderListThumb(record.work).catch(() => undefined);
        if (!alive || !thumb) continue;
        // 만드는 사이에 지워졌을 수 있다. 없어진 작품을 되살려 쓰지 않는다.
        const current = await getWorkRecord(record.work.id).catch(() => undefined);
        if (!alive || !current) continue;
        await putWorkRecord({ ...current, thumb, thumbV: THUMB_VERSION }).catch(() => {});
        if (!alive) return;
        setRecords((prev) =>
          prev.map((r) =>
            r.work.id === record.work.id ? { ...r, thumb, thumbV: THUMB_VERSION } : r,
          ),
        );
      }
    })();

    return () => {
      alive = false;
    };
  }, [records]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [profileMenuOpen]);

  const create = async () => {
    // 홈의 첫 탭이 오디오 unlock 기회다. 여기서 풀어두면 만들기 화면의 첫 소리가 즉시 난다.
    void engine.unlock();
    // 처음 만드는 사람은 사용법부터 — 안 보고 곧장 오면 공연이 뭔지 모른 채 무대까지 간다.
    if (!hasSeenAppGuide()) {
      markAppGuideSeen();
      nav('/guide');
      return;
    }
    await startNewDraft();
    nav('/create');
  };

  /**
   * 아직 공유하지 않은 작품은 "만들다 만 것"이다 — 열면 이어서 만든다.
   * 공유한 작품은 완성품이므로 감상 화면으로 간다.
   */
  const open = async (record: WorkRecord) => {
    void engine.unlock();
    if (isShareCurrent(record.work, record.published)) {
      nav(`/w/${record.work.id}`);
      return;
    }
    await openDraft(record.work.id);
    nav('/create');
  };

  /**
   * 작품 지우기 — 로컬과 계정 백업 **둘 다** 지워야 진짜 지워진다.
   *
   * 하나라도 남으면 다음 동기화가 되살린다: 클라우드 문서가 남아 있으면
   * syncAccountWorks가 로컬로 복원하고, 예약된 백업 타이머가 살아 있으면
   * 방금 지운 작품을 클라우드에 다시 올린다. 그래서 순서가 이렇다.
   *
   *   ① 예약된 백업 취소 — 안 그러면 1.8초 뒤에 되살아난다
   *   ② 클라우드 백업 삭제 — 로컬보다 먼저다. 로컬을 먼저 지우면 그 사이에 도는
   *      동기화가 "클라우드에만 있는 작품"으로 보고 도로 내려받는다
   *   ③ 로컬 삭제
   *
   * ②가 실패하면 로컬도 지우지 않는다. 반쪽만 지우면 지운 줄 알았던 작품이
   * 나중에 혼자 돌아오는데, 그게 그냥 실패하는 것보다 나쁘다.
   */
  const remove = async (record: WorkRecord) => {
    setPendingDelete(null);
    setDeleteError(null);
    cancelWorkBackup(record.work.id);
    try {
      await deleteAccountBackup(record);
    } catch (e) {
      console.warn('[home] 계정 백업을 지우지 못했어요', record.work.id, e);
      setDeleteError(t('home.deleteFailed'));
      return;
    }
    await deleteWorkRecord(record.work.id);
    refresh();
  };

  return (
    <main className="screen home">
      <header className="home-head">
        <h1 className="logo">{t('common.appName')}</h1>
        <div className="profile-menu" ref={profileMenuRef}>
          <button
            type="button"
            className="profile-trigger"
            aria-label={t('home.profileMenu')}
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            aria-controls="home-profile-menu"
            onClick={() => setProfileMenuOpen((open) => !open)}
          >
            <ProfileAvatar url={profile.avatarUrl} name={profile.name} />
          </button>
          {profileMenuOpen ? (
            <div className="profile-dropdown" id="home-profile-menu" role="menu">
              <div className="profile-dropdown-user">
                <ProfileAvatar url={profile.avatarUrl} name={profile.name} />
                <span>
                  <strong>{profile.name}</strong>
                  <small>{account.kind === 'google' ? t('home.storedGoogle') : t('home.storedDevice')}</small>
                </span>
              </div>
              <button
                type="button"
                className="profile-menu-item"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  nav('/profile');
                }}
              >
                <span className="profile-menu-icon" aria-hidden="true">✎</span>
                {t('home.editProfile')}
              </button>
              <button
                type="button"
                className="profile-menu-item"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  nav('/guide');
                }}
              >
                <span className="profile-menu-icon guide" aria-hidden="true">?</span>
                {t('home.howTo')}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <p className="mission">
        <span className="mission-tag">{t('home.missionTag')}</span>
        {mission}
      </p>

      <button type="button" className="big-cta" onClick={create}>
        <span className="big-cta-plus">＋</span>
        {t('home.newWork')}
      </button>

      <section className="my-works">
        <h2>{t('home.myWorks')}</h2>
        {deleteError && <p className="warn">{deleteError}</p>}
        {records.length === 0 ? (
          <p className="empty">{t('home.empty')}</p>
        ) : (
          <ul className="work-list">
            {records.map((r) => (
              <li key={r.work.id}>
                <button type="button" className="work-card" onClick={() => open(r)}>
                  <WorkThumbnail blob={r.thumb} />
                  <span className="work-title">{r.work.title || t('common.untitled')}</span>
                  <span className="work-state">
                    {isShareCurrent(r.work, r.published)
                      ? t('home.stateShared')
                      : r.published
                        ? t('home.stateChanged')
                        : t('home.stateDraft')}
                  </span>
                </button>
                <button
                  type="button"
                  className="work-delete"
                  aria-label={t('home.deleteAria', { title: r.work.title || t('common.untitled') })}
                  onClick={() => setPendingDelete(r)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pendingDelete && (
        <ConfirmDialog
          title={t('home.deleteTitle', {
            title: pendingDelete.work.title || t('common.untitled'),
          })}
          detail={t('home.deleteDetail')}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </main>
  );
}
