/**
 * 복구 코드 — 형식 다루기와, 되찾기가 **계정을 새로 만들지 않는 것**.
 *
 * 후자가 이 파일의 진짜 목적이다. `redeemRecoveryCode`가 다른 callable처럼
 * `acquireUid`로 로그인을 확보하고 시작하면, 새 기기에서 복구를 누른 순간
 * 익명 계정이 하나 만들어지고 곧바로 버려진다. 눈에 띄는 증상이 없어서
 * 회귀가 조용히 들어오기 좋은 자리라 테스트로 박아 둔다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const acquireUid = vi.fn(async () => 'uid-1');
const signInWithRecoveryToken = vi.fn(async (_token: string) => ({ uid: 'uid-restored' }));
const callable = vi.fn();

vi.mock('./firebase', () => ({
  isFirebaseConfigured: true,
  functions: () => ({}),
  signInWithRecoveryToken: (token: string) => signInWithRecoveryToken(token),
}));
vi.mock('./identity', () => ({ acquireUid: () => acquireUid() }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => callable,
}));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});

import {
  isCloudBackupOptIn,
  issueRecoveryCode,
  redeemRecoveryCode,
  setCloudBackupOptIn,
} from './recovery';

const VALID = 'ABCDEFGHJKMNPQR2';

beforeEach(() => {
  store.clear();
  acquireUid.mockClear();
  signInWithRecoveryToken.mockClear();
  callable.mockReset();
});

describe('issueRecoveryCode', () => {
  it('발급에 성공하면 클라우드 백업을 켠다 — 코드만 있고 올린 것이 없으면 되찾을 것이 없다', async () => {
    callable.mockResolvedValue({ data: { code: VALID, createdAt: 1234 } });
    expect(isCloudBackupOptIn()).toBe(false);

    const result = await issueRecoveryCode();

    expect(result.code).toBe(VALID);
    expect(isCloudBackupOptIn()).toBe(true);
  });

  it('서버가 이상한 값을 주면 백업을 켜지 않고 실패한다', async () => {
    callable.mockResolvedValue({ data: { code: 'nope' } });

    await expect(issueRecoveryCode()).rejects.toThrow();
    expect(isCloudBackupOptIn()).toBe(false);
  });
});

describe('redeemRecoveryCode', () => {
  it('로그인을 확보하지 않는다 — 새 기기에서 버려질 익명 계정을 만들지 않으려고', async () => {
    callable.mockResolvedValue({ data: { token: 'custom-token' } });

    await redeemRecoveryCode(VALID);

    expect(acquireUid).not.toHaveBeenCalled();
    expect(signInWithRecoveryToken).toHaveBeenCalledWith('custom-token');
    expect(isCloudBackupOptIn()).toBe(true);
  });

  it('형식이 틀린 코드는 서버까지 가지 않는다', async () => {
    await expect(redeemRecoveryCode('SHORT')).rejects.toThrow();
    expect(callable).not.toHaveBeenCalled();
  });

  it('저장소를 못 쓰는 환경에서도 발급·복구 자체는 막히지 않는다', async () => {
    setCloudBackupOptIn(false);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    callable.mockResolvedValue({ data: { token: 'custom-token' } });

    await expect(redeemRecoveryCode(VALID)).resolves.toEqual({ uid: 'uid-restored' });
    expect(isCloudBackupOptIn()).toBe(false);

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
});
