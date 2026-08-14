/**
 * 그룹 입장/만들기 — /g/join
 *
 * 진입 경로가 둘이다: 초대 코드를 받고 온 사람(QR·딥링크가 `?code=`를 채워 준다)과
 * 새 그룹을 열려는 사람(`?new=1`로 들어온다). 한 화면 안에서 세그먼트로만 갈라두면
 * "코드가 있는데 왜 이름부터 물어보지" 같은 헷갈림이 없다.
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t } from '../../i18n';
import { createGroup, formatGroupCode, GROUP_NAME_MAX, joinGroup, normalizeJoinCode } from '../../storage/groups';
import { useAppState } from '../state';

type Mode = 'join' | 'create';

export function JoinGroupScreen() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { account, authReady, connectGoogle } = useAppState();

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
  const [connecting, setConnecting] = useState(false);

  /**
   * "이미 Google 계정이 붙어 있는가" — 'google'만 보면 안 된다.
   *
   * state.tsx의 watchUser는 비익명 사용자를 만나면 먼저 'syncing'으로 두고, 클라우드
   * 프로필 내려받기·작품 동기화·이름 일괄 변경·백업 예약이 **전부 끝난 뒤에야**
   * 'google'로 바꾼다. 그 사이(느린 망에서는 수 초, Firestore가 막히면 영영)에
   * `kind !== 'google'`로 판정하면 이미 연결된 주최자에게 "Google 계정으로 로그인해야
   * 해요"를 보여주고 그룹 만들기를 막는다.
   *
   * 'syncing'은 정의상 비익명 사용자에게만 붙는다(state.tsx: user.isAnonymous가
   * false일 때만 hydratePermanentAccount로 간다). 서버 createGroup도 sign_in_provider가
   * 'anonymous'가 아닌지만 보므로, 동기화가 끝나기 전에 만들어도 아무 문제가 없다.
   */
  const googleConnected = account.kind === 'google' || account.kind === 'syncing';

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

  const connectForGroup = async () => {
    if (connecting) return;
    setConnecting(true);
    setCreateError('');
    try {
      await connectGoogle();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : t('join.connectFailed'));
    } finally {
      setConnecting(false);
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
      <main className="screen join-group">
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
      </main>
    );
  }

  return (
    <main className="screen join-group">
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
          {!authReady ? (
            // 저장된 인증 세션을 아직 확인하지 못했다 — 이미 Google로 연결된 사람일
            // 수도 있으니, 확인이 끝나기 전에는 "로그인해 주세요"부터 보여주지 않는다.
            <p className="feed-status" role="status" aria-live="polite">
              {t('join.checkingAccount')}
            </p>
          ) : !googleConnected ? (
            // 서버도 비익명(Google) 계정만 그룹을 만들게 하지만, 여기서 먼저 막아야
            // "그룹을 만들지 못했어요"라는 막연한 에러 대신 무엇을 해야 하는지 바로 알려준다.
            <>
              <p className="note">
                {t('join.needAccount')}
              </p>
              {createError && (
                <p className="warn" role="alert">
                  {createError}
                </p>
              )}
              <button
                type="button"
                className="google-connect"
                onClick={() => void connectForGroup()}
                disabled={connecting}
              >
                <span aria-hidden="true">G</span>
                {connecting ? t('join.connecting') : t('profile.connect')}
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </section>
      )}
    </main>
  );
}
