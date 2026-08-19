/**
 * 복구 코드 발급 버튼과, 발급된 코드를 보여주는 자리.
 *
 * 두 화면에서 같은 모양으로 쓴다 — 프로필(설정으로서의 복구)과 그룹 만들기 직후
 * (주최자 자리 지키기). 두 곳에서 각각 구현하면 **"코드는 한 번만 보인다"**는
 * 가장 중요한 경고가 한쪽에서만 빠지기 쉽다.
 *
 * 코드가 화면에 뜬 뒤에는 이 컴포넌트가 그것을 계속 들고 있는다. 부모가 리렌더돼도
 * 사라지지 않아야 한다 — 서버는 해시만 갖고 있어서 **다시 보여줄 방법이 없다.**
 */

import { useState } from 'react';
import { t } from '../../i18n';
import { formatRecoveryCode, issueRecoveryCode } from '../../storage/recovery';
import { useAppState } from '../state';

export function RecoveryCodeIssuer({
  cta,
  onIssued,
}: {
  /** 버튼 글자. 처음 만들 때와 다시 만들 때가 다르다. */
  cta: string;
  onIssued?: () => void;
}) {
  const { enableCloudBackup } = useAppState();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const issue = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await issueRecoveryCode();
      setCode(result.code);
      /*
       * 코드를 만든 것만으로는 아무것도 지켜지지 않는다. 백업을 켜고 이 기기에
       * 이미 있는 작품을 올려야 되찾을 것이 생긴다 — 그게 enableCloudBackup이다.
       * 실패해도 코드는 유효하므로 화면에서 코드를 지우지는 않는다.
       */
      await enableCloudBackup().catch((cause) =>
        console.warn('[recovery] 백업 동기화를 시작하지 못했어요', cause),
      );
      onIssued?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('recovery.issueFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드를 못 쓰는 환경도 있다. 코드는 화면에 그대로 남아 있다.
    }
  };

  if (code) {
    return (
      <div className="recovery-code-block">
        <p className="recovery-code" aria-label={t('recovery.codeAria', { code })}>
          {formatRecoveryCode(code)}
        </p>
        <button type="button" className="chip wide" onClick={() => void copy()}>
          {copied ? t('recovery.copied') : t('recovery.copy')}
        </button>
        <p className="warn">{t('recovery.keepSecret')}</p>
        <p className="note">{t('recovery.showOnce')}</p>
        <p className="note">{t('recovery.backupOn')}</p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="chip primary wide" disabled={busy} onClick={() => void issue()}>
        {busy ? t('recovery.issuing') : cta}
      </button>
    </>
  );
}
