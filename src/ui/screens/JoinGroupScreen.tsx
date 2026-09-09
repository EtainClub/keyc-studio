/**
 * 그룹 입장/만들기 — /g/join
 *
 * 진입 경로가 둘이다: 초대 코드를 받고 온 사람(QR·딥링크가 `?code=`를 채워 준다)과
 * 새 그룹을 열려는 사람(`?new=1`로 들어온다). 한 화면 안에서 세그먼트로만 갈라두면
 * "코드가 있는데 왜 이름부터 물어보지" 같은 헷갈림이 없다.
 *
 * ── Google 계정 요구를 걷어냈다 ──
 * 전에는 만들기 쪽에 계정 연결 관문이 하나 더 있었다. 그 관문 때문에 "지금 이
 * 자리에서 방을 열어야 하는" 상황(워크숍·회식)에서 흐름이 통째로 끊겼고, 토스
 * 미니앱 웹뷰에는 애초에 로그인 팝업을 띄울 자리가 없다.
 *
 * 대신 만들고 **난 뒤에** 복구 코드를 권한다. 관문을 앞에 두면 아무것도 못 하게
 * 막는 벽이지만, 뒤에 두면 이미 만든 것을 지키는 제안이 된다. 걱정 자체는 그대로
 * 남아 있다 — 익명 주최자가 기기를 잃으면 그 방은 주인이 없어진다.
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t } from '../../i18n';
import { createGroup, formatGroupCode, GROUP_NAME_MAX, joinGroup, normalizeJoinCode } from '../../storage/groups';
import { RecoveryCodeIssuer } from '../components/RecoveryCodeIssuer';
import { useAppState } from '../state';

type Mode = 'join' | 'create';

export function JoinGroupScreen() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { account, cloudBackup } = useAppState();

  const [mode, setMode] = useState<Mode>(searchParams.get('new') === '1' ? 'create' : 'join');

  // 입장 -----------------------------------------------------------
  const [codeInput, setCodeInput] = useState(() => normalizeJoinCode(searchParams.get('code') || ''));
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [alreadyMember, setAlreadyMember] = useState(false);

  // 만들기 -----------------------------------------------------------
  const [nameInput, setNameInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [created, setCreated] = useState<{ groupId: string; code: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * 주최자 자리가 이 기기 밖에도 남는가.
   *
   * Google 계정은 그 자체로 남고, 익명 계정은 복구 코드를 만들어 둔 경우에만 남는다.
   * 둘 다 아니면 방을 만든 직후에 복구 코드를 권한다 — 지금 이 순간이 "잃으면
   * 곤란한 것"이 막 생긴 순간이라, 같은 말을 다른 어느 자리에서 하는 것보다 잘 통한다.
   */
  const ownerSeatIsPortable = account.kind === 'google' || account.kind === 'syncing' || cloudBackup;

  const goToStage = (groupId: string) => nav(`/feed?g=${groupId}`, { replace: true });

  const submitJoin = async () => {
    const code = normalizeJoinCode(codeInput);
    if (!code || joining) return;
    setJoining(true);
    setJoinError('');
    try {
      const result = await joinGroup(code);
      if (result.alreadyMember) {
        // 이미 멤버인 건 에러가 아니다 — 잠깐 알려주고 그대로 들여보낸다.
        setAlreadyMember(true);
        setTimeout(() => goToStage(result.groupId), 600);
      } else {
        goToStage(result.groupId);
      }
    } catch (cause) {
      // joinGroup은 이미 사람이 읽을 수 있는 한국어 메시지를 던진다(잘못된 코드,
      // 로그인 실패, 상한 초과 등). 그대로 보여주면 된다.
      setJoinError(cause instanceof Error ? cause.message : t('join.failed'));
    } finally {
      setJoining(false);
    }
  };

  const submitCreate = async () => {
    const name = nameInput.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const result = await createGroup(name);
      setCreated(result);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : t('join.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const copyCode = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 권한이 없는 브라우저·컨텍스트도 있다. 실패해도 코드는 화면에
      // 그대로 크게 남아 있으니 손으로 옮겨 적을 수 있다.
    }
  };

  // 만들기에 성공하면 코드부터 보여준다 — 모드를 되돌려 다시 이름을 묻는 흐름은 없다.
  if (created) {
    return (
      <main className="screen join-group" data-mode="group">
        <header className="bar">
          <h1>{t('join.createdTitle')}</h1>
        </header>
        <section className="group-created">
          <p className="note">{t('join.shareCode')}</p>
          <p className="group-created-code" aria-label={t('group.inviteCodeAria', { code: created.code })}>
            {formatGroupCode(created.code)}
          </p>
          <button type="button" className="chip wide" onClick={() => void copyCode()}>
            {copied ? t('group.copied') : t('group.copyCode')}
          </button>
          <button
            type="button"
            className="chip primary wide"
            onClick={() => goToStage(created.groupId)}
          >
            {t('join.toStage')}
          </button>
        </section>

        {/* 주최자 자리가 이 기기에만 있는 사람에게만 보인다. 이미 지켜져 있는
            사람에게 같은 경고를 또 하면 다음부터는 아무도 안 읽는다. */}
        {!ownerSeatIsPortable && (
          <section className="account-card owner-guard">
            <p className="feed-kicker">{t('recovery.kicker')}</p>
            <h2>{t('join.keepOwnerTitle')}</h2>
            <p className="note">{t('join.keepOwnerBody')}</p>
            <RecoveryCodeIssuer cta={t('join.keepOwnerCta')} />
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="screen join-group" data-mode="group">
      <header className="bar">
        <h1>{t('join.title')}</h1>
      </header>

      <div className="seg join-mode" role="group" aria-label={t('join.modeAria')}>
        <button
          type="button"
          className={`seg-btn ${mode === 'join' ? 'on' : ''}`}
          aria-pressed={mode === 'join'}
          onClick={() => setMode('join')}
        >
          {t('join.modeJoin')}
        </button>
        <button
          type="button"
          className={`seg-btn ${mode === 'create' ? 'on' : ''}`}
          aria-pressed={mode === 'create'}
          onClick={() => setMode('create')}
        >
          {t('join.modeCreate')}
        </button>
      </div>

      {mode === 'join' ? (
        <section className="join-group-panel">
          <label className="field">
            <span>{t('join.codeField')}</span>
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCDEFGH"
              value={codeInput}
              // 입력 중에도 대문자로 맞춰 보여준다 — normalizeJoinCode가 어차피
              // 서버로 보내기 전에 다시 정규화하지만, 화면에서부터 "이렇게 들어간다"를
              // 보여줘야 오타(소문자, 하이픈 등)를 바로 알아챈다.
              onChange={(e) => setCodeInput(normalizeJoinCode(e.target.value))}
            />
          </label>
          {alreadyMember && (
            <p className="note" role="status" aria-live="polite">
              {t('join.already')}
            </p>
          )}
          {joinError && (
            <p className="warn" role="alert">
              {joinError}
            </p>
          )}
          <button
            type="button"
            className="big-cta"
            disabled={joining || !codeInput}
            onClick={() => void submitJoin()}
          >
            {joining ? t('join.joining') : t('join.join')}
          </button>
        </section>
      ) : (
        <section className="join-group-panel">
          {/* 계정 관문이 없다. 로그인은 createGroup이 알아서 확보한다(익명이어도 된다). */}
          <p className="note">{t('join.createLead')}</p>
          <label className="field">
            <span>{t('join.nameField')}</span>
            <input
              type="text"
              autoComplete="off"
              placeholder={t('join.namePlaceholder')}
              maxLength={GROUP_NAME_MAX}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value.slice(0, GROUP_NAME_MAX))}
            />
            <em>{Array.from(nameInput).length}/{GROUP_NAME_MAX}</em>
          </label>
          {createError && (
            <p className="warn" role="alert">
              {createError}
            </p>
          )}
          <button
            type="button"
            className="big-cta"
            disabled={creating || !nameInput.trim()}
            onClick={() => void submitCreate()}
          >
            {creating ? t('join.creating') : t('join.modeCreate')}
          </button>
        </section>
      )}
    </main>
  );
}
