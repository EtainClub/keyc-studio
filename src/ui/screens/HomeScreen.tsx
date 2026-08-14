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
import { deleteAccountBackup } from '../../storage/account';
import { deleteWorkRecord, listWorkRecords, type WorkRecord } from '../../storage/db';
import { missionOfDay } from '../../work-model/missions';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { WorkThumbnail } from '../components/WorkThumbnail';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { isShareCurrent } from '../draft-state';
import { useAppState } from '../state';

export function HomeScreen() {
  const nav = useNavigate();
  const { engine, startNewDraft, openDraft, profile, account, syncRevision } = useAppState();
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  /** 지우기를 누른 작품. 확인 창이 뜨는 동안 무엇을 지우는지 들고 있는다. */
  const [pendingDelete, setPendingDelete] = useState<WorkRecord | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const mission = missionOfDay();

  const refresh = useCallback(() => {
    listWorkRecords().then(setRecords).catch(() => setRecords([]));
  }, []);

  useEffect(refresh, [refresh, syncRevision]);

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

  const remove = async (record: WorkRecord) => {
    setPendingDelete(null);
    await deleteAccountBackup(record);
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
