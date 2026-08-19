/**
 * 익명 계정 복구 — 기기를 바꿔도 작품과 그룹이 따라오게 하는 열쇠.
 *
 * ── 왜 필요한가 ──
 * 익명 로그인의 uid는 **이 브라우저 저장소 안에만** 있다. 폰을 바꾸거나 저장소를
 * 지우면 새 uid가 생기고, 예전 uid에 달려 있던 것들이 전부 남는다:
 * 클라우드 백업된 작품, 내가 연 그룹의 주최자 자리, 그룹 안에서 던진 표.
 * 아무도 그것을 다시 가져올 수 없다 — 주인임을 증명할 방법이 없기 때문이다.
 *
 * Google 연동이 지금까지의 답이었지만, 토스 미니앱 웹뷰처럼 팝업 로그인을 띄울
 * 수 없는 자리에서는 답이 되지 못한다. 그래서 **사람이 옮겨 적을 수 있는 16자**를
 * 발급한다. 그 코드를 내면 서버가 원래 uid로 커스텀 토큰을 끊어 준다.
 *
 * ── 이 코드가 무엇인지 분명히 ──
 * 복구 코드는 **비밀번호가 아니라 열쇠 그 자체다.** 가진 사람이 곧 그 계정이다.
 * 그래서 화면은 "남에게 보여주지 말라"를 반드시 함께 말해야 하고, 서버는 원문을
 * 저장하지 않는다(해시만 남긴다 — functions/index.js: hashRecoveryCode).
 * 그 대가로 **잃어버린 코드는 다시 볼 수 없다.** 재발급만 된다.
 *
 * ── 백업 켜짐 플래그 ──
 * 복구가 뜻을 가지려면 되찾을 것이 클라우드에 있어야 한다. 그런데 익명 사용자의
 * 작품을 아무 말 없이 전부 올리는 것은 이 앱이 처음부터 피해 온 일이다
 * (README "먼저, 정정 사항" 참고 — 아이의 그림·목소리다). 그래서 백업은
 * **복구 코드를 만든 순간부터** 켜지는 opt-in이고, 그 사실을 이 플래그가 들고 있다.
 */

import { httpsCallable } from 'firebase/functions';
import { t } from '../i18n';
import { functions, isFirebaseConfigured, signInWithRecoveryToken } from './firebase';
import { acquireUid } from './identity';
import { CALL_TIMEOUT_MS, withTimeout } from './with-timeout';

import { isCompleteRecoveryCode, normalizeRecoveryCode } from './recovery-code';

/** 형식 규칙은 순수 모듈에 있다. 화면은 여기서 한 번에 가져다 쓴다. */
export {
  formatRecoveryCode,
  isCompleteRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_LENGTH,
} from './recovery-code';

const BACKUP_KEY = 'keyc.cloud-backup.v1';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/* ── 백업 opt-in ──────────────────────────────── */

/**
 * 이 기기가 클라우드 백업을 켰는가.
 *
 * Google 계정은 이 플래그와 무관하게 항상 백업한다(계정 연결 자체가 그 동의다).
 * 이 값은 **익명 계정**에만 의미가 있다.
 */
export function isCloudBackupOptIn(): boolean {
  try {
    return localStorage.getItem(BACKUP_KEY) === '1';
  } catch {
    // 사생활 보호 모드 등 저장소를 못 읽는 환경. 켜진 적 없는 것으로 본다.
    return false;
  }
}

export function setCloudBackupOptIn(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(BACKUP_KEY, '1');
    else localStorage.removeItem(BACKUP_KEY);
  } catch {
    // 저장을 못 해도 이번 세션에는 아래 호출들이 그대로 동작한다.
  }
}

/* ── callable ─────────────────────────────────── */

function requireConfigured(): void {
  if (!isFirebaseConfigured) {
    throw new Error(t('groups.notConfigured'));
  }
}

export type RecoveryStatus = { hasCode: boolean; createdAt: number | null };

/**
 * 복구 코드 발급(과 재발급).
 *
 * 성공하면 **백업 opt-in도 함께 켠다.** 코드만 있고 올라간 것이 없으면 복구는
 * 빈 계정으로 로그인하는 일에 지나지 않는다 — 사용자가 기대한 것과 정반대다.
 */
export async function issueRecoveryCode(): Promise<{ code: string; createdAt: number }> {
  requireConfigured();
  await acquireUid();
  const callable = httpsCallable(functions(), 'issueRecoveryCode');
  const response = await withTimeout(callable({}), CALL_TIMEOUT_MS, t('recovery.op.issue'));
  const data = asRecord(response.data);
  if (typeof data.code !== 'string' || !isCompleteRecoveryCode(data.code)) {
    throw new Error(t('recovery.badResponse'));
  }
  setCloudBackupOptIn(true);
  return {
    code: normalizeRecoveryCode(data.code),
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
  };
}

export async function fetchRecoveryStatus(): Promise<RecoveryStatus> {
  requireConfigured();
  await acquireUid();
  const callable = httpsCallable(functions(), 'getRecoveryStatus');
  const response = await withTimeout(callable({}), CALL_TIMEOUT_MS, t('recovery.op.status'));
  const data = asRecord(response.data);
  return {
    hasCode: data.hasCode === true,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : null,
  };
}

/**
 * 코드를 내고 원래 계정으로 갈아탄다.
 *
 * `acquireUid`를 부르지 않는다 — **로그인하지 않은 채로 부를 수 있어야 하는**
 * 유일한 callable이다. 새 기기에서 아직 아무 계정도 없는 상태가 정확히 그 경우고,
 * 여기서 익명 계정을 먼저 만들면 곧바로 버려질 uid를 하나 더 낳을 뿐이다.
 *
 * 성공하면 지금 로그인해 있던 계정(대개 이 기기에서 방금 만들어진 익명 계정)은
 * 버려진다. 그 계정에 올라간 것은 없고, 이 기기의 IndexedDB에 있는 작품은
 * 그대로 남아 다음 동기화 때 복구한 계정으로 올라간다.
 */
export async function redeemRecoveryCode(rawCode: string): Promise<{ uid: string }> {
  requireConfigured();
  const code = normalizeRecoveryCode(rawCode);
  if (!isCompleteRecoveryCode(code)) {
    throw new Error(t('recovery.badCode'));
  }
  const callable = httpsCallable(functions(), 'redeemRecoveryCode');
  const response = await withTimeout(callable({ code }), CALL_TIMEOUT_MS, t('recovery.op.redeem'));
  const data = asRecord(response.data);
  if (typeof data.token !== 'string' || !data.token) {
    throw new Error(t('recovery.badResponse'));
  }
  const user = await signInWithRecoveryToken(data.token);
  // 되찾은 계정은 정의상 백업을 쓰던 계정이다. 이 기기에서도 계속 켜 둔다.
  setCloudBackupOptIn(true);
  return { uid: user.uid };
}
