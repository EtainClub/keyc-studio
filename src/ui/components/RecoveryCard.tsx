/**
 * 프로필 화면의 "기기 복구" 칸 — 복구 코드를 만들고, 다른 기기의 코드로 되찾는다.
 *
 * ── 상태 조회로 계정을 만들지 않는다 ──
 * `fetchRecoveryStatus`는 로그인을 확보한 뒤에야 부를 수 있고, 그 확보 과정은
 * 계정이 없으면 **새 익명 계정을 만든다.** 그래서 화면을 여는 것만으로 조회하면
 * 프로필을 구경만 한 사람에게도 서버 계정이 하나씩 생긴다. 이 앱은 공유나 그룹처럼
 * 사용자가 직접 시작한 일에서만 계정을 만들어 왔고(firebase.ts 주석), 그 약속을
 * 설정 화면이 깨면 안 된다. 그래서 **이미 로그인해 있을 때만** 조회한다.
 */

import { useEffect, useState } from 'react';
import { locale, t } from '../../i18n';
import { isFirebaseConfigured } from '../../storage/firebase';
import {
  fetchRecoveryStatus,
  isCompleteRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_LENGTH,
  type RecoveryStatus,
} from '../../storage/recovery';
import { ConfirmDialog } from './ConfirmDialog';
import { RecoveryCodeIssuer } from './RecoveryCodeIssuer';
import { useAppState } from '../state';

export function RecoveryCard() {
  const { account, authReady, cloudBackup, recoverAccount } = useAppState();

  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [statusRevision, setStatusRevision] = useState(0);

  const [codeInput, setCodeInput] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured || !authReady) return;
    // 로그인한 적이 없으면 물어볼 것도 없다(위 주석 참고). 코드가 없는 상태로 그린다.
    if (account.kind === 'local') {
      setStatus({ hasCode: false, createdAt: null });
      return;
    }
    let alive = true;
    void fetchRecoveryStatus()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch((cause) => {
        console.warn('[recovery] 복구 코드 상태를 읽지 못했어요', cause);
        // 조회 실패를 "코드 없음"으로 그리면 있는 코드를 덮어쓰라고 권하게 된다.
        if (alive) setStatus(null);
      });
    return () => {
      alive = false;
    };
  }, [authReady, account.kind, statusRevision]);

  const isGoogle = account.kind === 'google' || account.kind === 'syncing';

  const restore = async () => {
    setConfirming(false);
    setRestoring(true);
    setRestoreError('');
    try {
      await recoverAccount(codeInput);
      setRestored(true);
      setCodeInput('');
      setStatusRevision((value) => value + 1);
    } catch (cause) {
      setRestoreError(cause instanceof Error ? cause.message : t('recovery.restoreFailed'));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <section className="account-card">
        <p className="feed-kicker">{t('recovery.kicker')}</p>
        <h2>{t('recovery.title')}</h2>
        <p className="note">{isGoogle ? t('recovery.bodyGoogle') : t('recovery.body')}</p>

        <p className="note" role="status" aria-live="polite">
          {status === null
            ? t('recovery.checking')
            : status.hasCode
              ? t('recovery.hasCode', { date: formatDate(status.createdAt) })
              : t('recovery.noCode')}
        </p>

        {status?.hasCode ? <p className="note">{t('recovery.reissueWarn')}</p> : null}
        {cloudBackup && !status?.hasCode ? <p className="note">{t('recovery.backupOn')}</p> : null}

        <RecoveryCodeIssuer
          cta={status?.hasCode ? t('recovery.reissue') : t('recovery.issue')}
          onIssued={() => setStatusRevision((value) => value + 1)}
        />
      </section>

      <section className="account-card">
        <h2>{t('recovery.restoreTitle')}</h2>
        <p className="note">{t('recovery.restoreBody')}</p>
        {/* Google 계정에서 복구 코드를 쓰면 그 계정에서 빠져나온다. 누르기 전에 말한다. */}
        {isGoogle ? <p className="warn">{t('recovery.googleWarn')}</p> : null}

        <label className="field">
          <span>{t('recovery.codeField')}</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={codeInput}
            // 입장 코드 입력과 같은 이유로 화면에서부터 정규화해 보여준다.
            onChange={(event) => setCodeInput(normalizeRecoveryCode(event.target.value))}
          />
          <em>{codeInput.length}/{RECOVERY_CODE_LENGTH}</em>
        </label>

        {restoreError && (
          <p className="warn" role="alert">
            {restoreError}
          </p>
        )}
        {restored && (
          <p className="profile-message" role="status">
            {t('recovery.restored')}
          </p>
        )}

        <button
          type="button"
          className="chip wide"
          disabled={restoring || !isCompleteRecoveryCode(codeInput)}
          onClick={() => setConfirming(true)}
        >
          {restoring ? t('recovery.restoring') : t('recovery.restore')}
        </button>
      </section>

      {confirming && (
        <ConfirmDialog
          title={t('recovery.switchTitle')}
          detail={t('recovery.switchDetail')}
          confirmLabel={t('recovery.switchConfirm')}
          onConfirm={() => void restore()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function formatDate(value: number | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
