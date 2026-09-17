import { t } from '../../i18n';
import { useAppState } from '../state';

/**
 * 자동 저장은 조용해야 하지만 실패까지 조용하면 "다음에 이어 만들기" 약속이 깨진다.
 * 오류일 때만 행동을 요구하고, 재시도는 현재 초안을 그대로 저장한다.
 */
export function StorageStatus() {
  const { storageStatus, retrySaveDraft } = useAppState();
  if (storageStatus !== 'error') return null;
  return (
    <aside className="warn" role="alert">
      {t('storage.saveFailed')}{' '}
      <button type="button" className="chip" onClick={() => void retrySaveDraft()}>
        {t('storage.retry')}
      </button>
    </aside>
  );
}
