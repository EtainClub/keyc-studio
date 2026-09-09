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
 *
 * ── 그룹 제출 ──
 * 그룹은 초대 코드로 들어온 사람만 보는 닫힌 공간이라 "누구나 찾고 볼 수 있다"는
 * 위험은 없다. 그래도 이 화면이 경계선이라는 사실은 바뀌지 않는다 — 목소리와
 * 그림이 이 기기 밖으로 나가는 건 똑같기 때문이다. 그래서 그룹만 골랐을 때는
 * 문구를 "보호자 확인"이 아니라 "그룹 참가자들에게 공개되는 것에 대한 동의"로
 * 바꾼다. 대상이 다르면 동의 내용도 다르므로, 대상이 바뀌면 체크는 자동으로 풀린다.
 */

import { useEffect, useRef, useState } from 'react';
import { VOICE_MODES, type VoiceMode } from '../../audio-engine/voice';
import { t } from '../../i18n';
import { explainFirebaseError, publishWork } from '../../storage/remote';
import { isAdminEmail, isFirebaseConfigured } from '../../storage/firebase';
import { listMyGroups, MAX_GROUPS_PER_WORK, type MyGroup } from '../../storage/groups';
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
  { value: 7, label: t('gate.expire.7') },
  { value: 30, label: t('gate.expire.30') },
  { value: null, label: t('gate.expire.forever') },
];

export function ShareGate({ work, onDone, onCancel }: Props) {
  const { profile, account } = useAppState();
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('asIs');
  const [expireDays, setExpireDays] = useState<ExpireChoice>(30);
  const [guardianOk, setGuardianOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  // 내 그룹 목록. 화면 진입 직후 바로 보여줘야 해서 마운트 시 한 번 불러온다.
  const [groups, setGroups] = useState<MyGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  // 그룹이 없는 사람에게는 이 값이 항상 true로 남아 지금까지의 "공개 공유" 경험이 그대로 유지된다.
  const [discoverable, setDiscoverable] = useState(true);
  // 그룹 제출이 일부/전부 실패한 채로 공유는 성공했을 때, 그 사실을 숨기지 않고
  // 한 번 더 보여주기 위한 중간 상태. 여기 값이 있으면 본문 대신 안내만 보여준다.
  const [pendingDone, setPendingDone] = useState<{ url: string; work: Work; groupError: string } | null>(null);
  const sheetRef = useRef<HTMLElement>(null);

  const hasGroups = selectedGroupIds.length > 0;

  useEffect(() => {
    let cancelled = false;
    // 그룹은 부가 기능이다 — 목록을 못 가져와도 공유 자체는 막지 않고 구역을 조용히 감춘다.
    listMyGroups()
      .then((list) => {
        if (!cancelled) setGroups(list);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 그룹에 올리면 기간 제한이 의미가 없다(그룹 스테이지엔 만료가 없다) — 상태 자체를 null로 맞춰 둔다.
  useEffect(() => {
    if (hasGroups) setExpireDays(null);
  }, [hasGroups]);

  // 대상(공개 스테이지 ↔ 그룹)이 바뀌면 이전 체크는 다른 문구에 대한 동의였던 셈이라 무효다.
  useEffect(() => {
    setGuardianOk(false);
  }, [hasGroups]);

  const artCount = work.assets.filter((a) => a.kind === 'art').length;
  const soundCount = work.assets.filter((a) => a.kind === 'sound').length;
  // 사진에서 딴 그림은 관리자만 올릴 수 있다. publishWork가 같은 판정을 한 번 더 한다.
  const photoKeys = photoArtKeyNumbers(work);
  const isAdmin = account.kind === 'google' && isAdminEmail(account.email);
  const blockedByPhoto = photoKeys.length > 0 && !isAdmin;

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => {
      if (prev.includes(id)) return prev.filter((g) => g !== id);
      if (prev.length >= MAX_GROUPS_PER_WORK) return prev; // 상한 초과는 막는다. 아래 note가 이유를 알린다.
      if (prev.length === 0) {
        // 그룹을 처음 고르는 순간 "모두의 스테이지"를 자동으로 끈다. 반/모둠용으로 만든
        // 작품이 실수로 공개 스테이지에도 뜨는 쪽을 기본값으로 두지 않기 위해서다.
        // 사용자가 다시 켜는 건 막지 않는다.
        setDiscoverable(false);
      }
      return [...prev, id];
    });
  };

  const hasTarget = discoverable || hasGroups;

  const finalize = () => {
    if (pendingDone) onDone(pendingDone.url, pendingDone.work);
  };
  // 공유 자체는 이미 끝난 뒤라 "그만두기"가 아니라 "확인"으로 닫힌다. Esc·배경 클릭도 같은 동작이어야
  // 한다 — 이미 성공한 공유를 취소할 방법은 없다.
  const closeHandler = pendingDone ? finalize : onCancel;
  // 올리는 중에는 Esc로 못 닫는다. 중간에 끊기면 반쯤 올라간 작품이 남는다.
  useModalShell(sheetRef, closeHandler, busy);

  const share = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await publishWork(work, {
        voiceMode,
        expireDays,
        discoverable,
        groupIds: selectedGroupIds,
        onProgress: setStep,
      });
      if (result.groupError) {
        // 링크는 이미 열렸다 — 그룹 제출 실패를 숨기지 않고 한 번 더 보여준 뒤에 마무리한다.
        setPendingDone({ url: result.url, work: result.work, groupError: result.groupError });
      } else {
        onDone(result.url, result.work);
      }
    } catch (e) {
      console.warn('[share] 공유 실패', e);
      setError(explainFirebaseError(e));
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : closeHandler}>
      <section
        ref={sheetRef}
        className="sheet gate"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={pendingDone ? t('gate.resultAria') : t('gate.aria')}
      >
        {pendingDone ? (
          <>
            <header className="sheet-head">
              <span className="sheet-title">{t('gate.linkOpened')}</span>
            </header>
            <div className="sheet-body">
              {/* 링크는 이미 열렸으니 여기서는 그룹 제출 결과만 알린다 — 성공을 취소로 되돌릴 방법은 없다. */}
              <p className="warn">{t('gate.groupFailed', { reason: pendingDone.groupError })}</p>
              <p className="note">
                {t('gate.groupFailedNote')}
              </p>
            </div>
            <div className="gate-actions">
              <button type="button" className="sheet-done" onClick={finalize}>
                {t('gate.ok')}
              </button>
            </div>
          </>
        ) : (
          <>
            <header className="sheet-head">
              <span className="sheet-title">{t('gate.title')}</span>
            </header>

            <div className="sheet-body">
              {blockedByPhoto && (
            <section className="gate-block gate-blocked">
              <h3 className="row-label">{t('gate.blockedTitle')}</h3>
              <p>{t('gate.blockedBody', { keys: photoKeys.join(', ') })}</p>
              <p className="note">
                {t('gate.blockedFix')}
              </p>
            </section>
          )}

          {/* 0. 어디에 올릴까요 — 목소리 처리 선택보다 위. 여기서 고른 대로 discoverable/groupIds가 정해진다. */}
          {groups.length > 0 && (
            <section className="gate-block">
              <h3 className="row-label">{t('gate.whereTitle')}</h3>
              <div className="gate-options">
                {groups.map((g) => (
                  // 그룹 칸만 그룹 액센트를 쓴다 — 바로 아래 [공개 스테이지]와
                  // 색이 달라야 어디에 올리는 것인지가 고르는 순간 읽힌다.
                  <label
                    key={g.id}
                    className={`chip ${selectedGroupIds.includes(g.id) ? 'on' : ''}`}
                    data-mode="group"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                    <span>{g.name}</span>
                  </label>
                ))}
                <label className={`chip ${discoverable ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={discoverable}
                    onChange={(e) => setDiscoverable(e.target.checked)}
                  />
                  <span>{t('gate.publicStage')}</span>
                </label>
              </div>
              {selectedGroupIds.length >= MAX_GROUPS_PER_WORK && (
                <p className="note">{t('gate.groupLimit', { max: MAX_GROUPS_PER_WORK })}</p>
              )}
              {!hasTarget && <p className="note">{t('gate.pickTarget')}</p>}
            </section>
          )}

          {/* 1. 무엇이 올라가는지 쉬운 말로 */}
          <section className="gate-block">
            <h3 className="row-label">{t('gate.uploadsTitle')}</h3>
            <ul className="gate-list">
              <li>{t('gate.itemArt', { n: artCount })}</li>
              {/* 사진에서 딴 그림이 섞여 있으면 그 사실을 숨기지 않는다. 이 화면의 존재 이유다. */}
              {photoKeys.length > 0 && (
                <li>{t('gate.itemPhotoArt', { n: photoKeys.length, keys: photoKeys.join(', ') })}</li>
              )}
              <li>{t('gate.itemSound', { n: soundCount })}</li>
              <li>{t('gate.itemTitleHint')}</li>
              <li>{t('gate.itemNick', { nick: work.authorNick })}</li>
              {profile.stageAvatarEnabled ? <li>{t('gate.itemAvatar')}</li> : null}
              <li>{t('gate.itemReplay')}</li>
              <li>{profile.stageAvatarEnabled ? t('gate.itemStageWithAvatar') : t('gate.itemStage')}</li>
            </ul>
            <p className="note">{t('gate.noPersonal')}</p>
          </section>

          {/* 2. 목소리 처리 */}
          {soundCount > 0 && (
            <section className="gate-block">
              <h3 className="row-label">{t('gate.voiceTitle')}</h3>
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

          {/* 4. 공유 기간 — 그룹에 올리면 만료가 없으니 아예 감춘다. */}
          {hasGroups ? (
            <section className="gate-block">
              <h3 className="row-label">{t('gate.durationTitle')}</h3>
              <p className="note">{t('gate.groupNoExpiry')}</p>
            </section>
          ) : (
            <section className="gate-block">
              <h3 className="row-label">{t('gate.durationTitle')}</h3>
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
              <p className="note">{t('gate.stopAnytime')}</p>
            </section>
          )}

          {/* 3. 보호자 확인 — 그룹만 골랐을 때는 "개인정보 처리 동의" 문구로 바뀐다. 대상이
              바뀌면 guardianOk는 위 useEffect가 자동으로 풀어 준다. */}
          <section className="gate-block">
            <label className="gate-check">
              <input
                type="checkbox"
                checked={guardianOk}
                onChange={(e) => setGuardianOk(e.target.checked)}
              />
              <span>
                {hasGroups
                  ? t('gate.consentGroup')
                  : t('gate.consentPublic')}
              </span>
            </label>
          </section>

          {!isFirebaseConfigured && (
            <p className="warn">{t('gate.notConfigured')}</p>
          )}
          {error && <p className="warn">{error}</p>}
          {busy && step && <p className="note">{step}</p>}
        </div>

        <div className="gate-actions">
          <button type="button" className="chip" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="sheet-done"
            onClick={share}
            disabled={!guardianOk || !hasTarget || busy || !isFirebaseConfigured || blockedByPhoto}
          >
            {busy ? t('gate.uploading') : t('gate.publish')}
          </button>
        </div>
          </>
        )}
      </section>
    </div>
  );
}
