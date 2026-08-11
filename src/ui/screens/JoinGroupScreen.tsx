/**
 * 그룹 입장/만들기 — /g/join
 *
 * 진입 경로가 둘이다: 초대 코드를 받고 온 사람(QR·딥링크가 `?code=`를 채워 준다)과
 * 새 그룹을 열려는 사람(`?new=1`로 들어온다). 한 화면 안에서 세그먼트로만 갈라두면
 * "코드가 있는데 왜 이름부터 물어보지" 같은 헷갈림이 없다.
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createGroup, GROUP_NAME_MAX, joinGroup, normalizeJoinCode } from '../../storage/groups';

type Mode = 'join' | 'create';

/**
 * 서버가 주는 코드는 8자다. 4-4로 끊어 보여주면 한눈에 읽고 옮겨 적기 쉽다.
 * 혹시 길이가 다르게 와도(서버 스키마가 바뀌는 등) slice는 범위를 벗어나면 그냥
 * 짧아질 뿐이라 화면이 깨지지 않는다.
 */
function formatCode(code: string): string {
  const head = code.slice(0, 4);
  const tail = code.slice(4, 8);
  return tail ? `${head}-${tail}` : head;
}

export function JoinGroupScreen() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

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
      setJoinError(cause instanceof Error ? cause.message : '입장하지 못했어요. 다시 시도해 주세요.');
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
      setCreateError(cause instanceof Error ? cause.message : '그룹을 만들지 못했어요. 다시 시도해 주세요.');
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
      <main className="screen join-group">
        <header className="bar">
          <h1>그룹을 만들었어요</h1>
        </header>
        <section className="group-created">
          <p className="note">이 코드를 그룹 사람들에게 알려주세요.</p>
          <p className="group-created-code" aria-label={`입장 코드 ${created.code}`}>
            {formatCode(created.code)}
          </p>
          <button type="button" className="chip wide" onClick={() => void copyCode()}>
            {copied ? '복사했어요 ✓' : '코드 복사하기'}
          </button>
          <button
            type="button"
            className="chip primary wide"
            onClick={() => goToStage(created.groupId)}
          >
            스테이지로 가기
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="screen join-group">
      <header className="bar">
        <h1>그룹 스테이지</h1>
      </header>

      <div className="seg join-mode" role="group" aria-label="그룹 시작 방법">
        <button
          type="button"
          className={`seg-btn ${mode === 'join' ? 'on' : ''}`}
          aria-pressed={mode === 'join'}
          onClick={() => setMode('join')}
        >
          코드로 입장
        </button>
        <button
          type="button"
          className={`seg-btn ${mode === 'create' ? 'on' : ''}`}
          aria-pressed={mode === 'create'}
          onClick={() => setMode('create')}
        >
          그룹 만들기
        </button>
      </div>

      {mode === 'join' ? (
        <section className="join-group-panel">
          <label className="field">
            <span>초대 코드</span>
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
              이미 들어와 있어요. 스테이지로 이동할게요…
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
            {joining ? '입장하는 중…' : '입장하기'}
          </button>
        </section>
      ) : (
        <section className="join-group-panel">
          <label className="field">
            <span>그룹 이름</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="예: 3학년 2반"
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
            {creating ? '만드는 중…' : '그룹 만들기'}
          </button>
        </section>
      )}
    </main>
  );
}
