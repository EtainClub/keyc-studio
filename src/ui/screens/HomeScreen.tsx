/**
 * ① 홈.
 *
 * [+ 새로 만들기]가 화면에서 가장 크다. 그 아래에 내 작품, 맨 위에 오늘의 미션 한 줄.
 * 내 작품 목록은 IndexedDB에서 읽는다. 다른 사람의 공개 작품은 FeedScreen이
 * listPublicFeed Function을 통해 별도로 읽는다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteAccountBackup } from '../../storage/account';
import { deleteWorkRecord, listWorkRecords, type WorkRecord } from '../../storage/db';
import { missionOfDay } from '../../work-model/missions';
import { WorkThumbnail } from '../components/WorkThumbnail';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { useAppState } from '../state';

export function HomeScreen() {
  const nav = useNavigate();
  const { engine, startNewDraft, openDraft, profile, account, syncRevision } = useAppState();
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
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
    if (record.published) {
      nav(`/w/${record.work.id}`);
      return;
    }
    await openDraft(record.work.id);
    nav('/create');
  };

  const remove = async (record: WorkRecord) => {
    if (!confirm('이 작품을 지울까요?')) return;
    await deleteAccountBackup(record);
    await deleteWorkRecord(record.work.id);
    refresh();
  };

  return (
    <main className="screen home">
      <header className="home-head">
        <h1 className="logo">키캡 크리에이터</h1>
        <div className="profile-menu" ref={profileMenuRef}>
          <button
            type="button"
            className="profile-trigger"
            aria-label="프로필 메뉴 열기"
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
                  <small>{account.kind === 'google' ? 'Google에 보관 중' : '이 기기에 저장 중'}</small>
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
                프로필 편집
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
                앱 사용법
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <p className="mission">
        <span className="mission-tag">오늘의 미션</span>
        {mission}
      </p>

      <button type="button" className="big-cta" onClick={create}>
        <span className="big-cta-plus">＋</span>
        새로 만들기
      </button>

      <section className="my-works">
        <h2>내 작품</h2>
        {records.length === 0 ? (
          <p className="empty">아직 없어요. 위 버튼을 눌러 첫 작품을 만들어 보세요.</p>
        ) : (
          <ul className="work-list">
            {records.map((r) => (
              <li key={r.work.id}>
                <button type="button" className="work-card" onClick={() => open(r)}>
                  <WorkThumbnail blob={r.thumb} />
                  <span className="work-title">{r.work.title || '이름 없는 작품'}</span>
                  <span className="work-state">
                    {r.published ? '공유됨 · 눌러서 듣기' : '만드는 중 · 눌러서 이어서'}
                  </span>
                </button>
                <button
                  type="button"
                  className="work-delete"
                  aria-label="작품 지우기"
                  onClick={() => void remove(r)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
