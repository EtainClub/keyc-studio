/**
 * 공유 게이트 — 작품이 공개 인터넷으로 넘어가는 경계선.
 *
 * 여기 오기 전까지 아이 목소리와 그림은 이 기기 밖으로 나간 적이 없다.
 * 그래서 이 화면은 "업로드 확인"이 아니라 **경계선**이다.
 *
 * ── 표기 원칙 ──
 * 목소리 변형을 "완전 익명"이라고 쓰지 않는다. "목소리를 바꿔서 올려요" 정도의
 * 사실 서술만 한다. 익명 로그인이 법정대리인 동의를 대체하지도 않는다.
 *
 * 아래 보호자 확인은 **사용자 테스트 단계용 최소 구현**이다.
 * 일반 공개 시점에는 법률 검토를 받아야 한다 — 그건 코드로 정할 문제가 아니다.
 */

import { useRef, useState } from 'react';
import { VOICE_MODES, type VoiceMode } from '../../audio-engine/voice';
import { explainFirebaseError, publishWork } from '../../storage/remote';
import { isAdminEmail, isFirebaseConfigured } from '../../storage/firebase';
import { photoArtKeyNumbers, type Work } from '../../work-model/types';
import { useAppState } from '../state';
import { useModalShell } from '../hooks';

type Props = {
  work: Work;
  onDone: (url: string, work: Work) => void;
  onCancel: () => void;
};

type ExpireChoice = 7 | 30 | null;

const EXPIRES: { value: ExpireChoice; label: string }[] = [
  { value: 7, label: '7일' },
  { value: 30, label: '30일' },
  { value: null, label: '계속' },
];

export function ShareGate({ work, onDone, onCancel }: Props) {
  const { profile, account } = useAppState();
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('asIs');
  const [expireDays, setExpireDays] = useState<ExpireChoice>(30);
  const [guardianOk, setGuardianOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const sheetRef = useRef<HTMLElement>(null);
  // 올리는 중에는 Esc로 못 닫는다. 중간에 끊기면 반쯤 올라간 작품이 남는다.
  useModalShell(sheetRef, onCancel, busy);

  const artCount = work.assets.filter((a) => a.kind === 'art').length;
  const soundCount = work.assets.filter((a) => a.kind === 'sound').length;
  // 사진에서 딴 그림은 관리자만 올릴 수 있다. publishWork가 같은 판정을 한 번 더 한다.
  const photoKeys = photoArtKeyNumbers(work);
  const isAdmin = account.kind === 'google' && isAdminEmail(account.email);
  const blockedByPhoto = photoKeys.length > 0 && !isAdmin;

  const share = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await publishWork(work, {
        voiceMode,
        expireDays,
        onProgress: setStep,
      });
      onDone(result.url, result.work);
    } catch (e) {
      console.warn('[share] 공유 실패', e);
      setError(explainFirebaseError(e));
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onCancel}>
      <section
        ref={sheetRef}
        className="sheet gate"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="인터넷에 올리기 전에"
      >
        <header className="sheet-head">
          <span className="sheet-title">인터넷에 올리기 전에</span>
        </header>

        <div className="sheet-body">
          {blockedByPhoto && (
            <section className="gate-block gate-blocked">
              <h3 className="row-label">이 작품은 아직 공유할 수 없어요</h3>
              <p>
                키캡 {photoKeys.join(', ')}번에 사진에서 딴 그림이 붙어 있어요. 사진에서 만든
                그림은 인터넷에 올릴 수 없어요.
              </p>
              <p className="note">
                그 키캡을 열어 &lsquo;전부 지우기&rsquo;를 누르고 직접 그리면 공유할 수 있어요.
              </p>
            </section>
          )}

          {/* 1. 무엇이 올라가는지 쉬운 말로 */}
          <section className="gate-block">
            <h3 className="row-label">이런 게 올라가요</h3>
            <ul className="gate-list">
              <li>내가 그린 그림 {artCount}개</li>
              {/* 사진에서 딴 그림이 섞여 있으면 그 사실을 숨기지 않는다. 이 화면의 존재 이유다. */}
              {photoKeys.length > 0 && (
                <li>그중 사진에서 선을 딴 그림 {photoKeys.length}개 (키캡 {photoKeys.join(', ')}번)</li>
              )}
              <li>내가 녹음한 소리 {soundCount}개</li>
              <li>작품 제목과 한 줄 힌트</li>
              <li>내 별명 ({work.authorNick})</li>
              {profile.stageAvatarEnabled ? <li>내가 공개하기로 한 스테이지 프로필 사진</li> : null}
              <li>키캡을 누른 순서와 시간</li>
              <li>제목·별명·미리보기{profile.stageAvatarEnabled ? '·공개용 프로필 사진' : ''}가 키크 스테이지에 보여요</li>
            </ul>
            <p className="note">이름·학교·전화번호 같은 건 올리지 않아요.</p>
          </section>

          {/* 2. 목소리 처리 */}
          {soundCount > 0 && (
            <section className="gate-block">
              <h3 className="row-label">내 목소리는 어떻게 할까요</h3>
              <div className="gate-options">
                {VOICE_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`gate-option ${voiceMode === m.id ? 'on' : ''}`}
                    onClick={() => setVoiceMode(m.id)}
                  >
                    <strong>{m.label}</strong>
                    <span>{m.detail}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 4. 공유 기간 */}
          <section className="gate-block">
            <h3 className="row-label">얼마 동안 공유할까요</h3>
            <div className="chip-grid">
              {EXPIRES.map((e) => (
                <button
                  key={String(e.value)}
                  type="button"
                  className={`chip ${expireDays === e.value ? 'on' : ''}`}
                  onClick={() => setExpireDays(e.value)}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <p className="note">언제든 공유를 멈출 수 있어요. 멈추면 올린 파일도 지워져요.</p>
          </section>

          {/* 3. 보호자 확인 */}
          <section className="gate-block">
            <label className="gate-check">
              <input
                type="checkbox"
                checked={guardianOk}
                onChange={(e) => setGuardianOk(e.target.checked)}
              />
              <span>
                보호자와 함께 확인했어요. 위 내용이 인터넷에 올라가고, 링크를 받은 사람뿐
                아니라 키크 스테이지에서도 누구나 찾고 볼 수 있다는 걸 알고 있어요.
              </span>
            </label>
          </section>

          {!isFirebaseConfigured && (
            <p className="warn">지금은 공유 설정이 안 돼 있어요 (Firebase 설정 필요)</p>
          )}
          {error && <p className="warn">{error}</p>}
          {busy && step && <p className="note">{step}</p>}
        </div>

        <div className="gate-actions">
          <button type="button" className="chip" onClick={onCancel} disabled={busy}>
            그만두기
          </button>
          <button
            type="button"
            className="sheet-done"
            onClick={share}
            disabled={!guardianOk || busy || !isFirebaseConfigured || blockedByPhoto}
          >
            {busy ? '올리는 중…' : '공개하고 링크 만들기'}
          </button>
        </div>
      </section>
    </div>
  );
}
