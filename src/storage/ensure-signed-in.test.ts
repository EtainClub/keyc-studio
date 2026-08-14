/**
 * `ensureSignedIn`이 저장된 로그인 세션을 덮어쓰지 않는지.
 *
 * 새로고침 직후 `auth().currentUser`는 아직 복원되지 않아 항상 null이다. 그 null을
 * 보고 곧장 `signInAnonymously`로 넘어가면, SDK가 복원을 마친 뒤 "지금 사용자가
 * 익명이 아니다"라고 판단해 **새 익명 계정을 만들어 Google 세션을 덮어썼다.**
 * uid가 갈리면 내 그룹 목록이 비고(참여한 적 없는 uid다) 그룹 재생 집계도
 * '멤버 아님'으로 버려진다 — 그룹 스테이지가 새로고침 한 번에 통째로 무너진 원인이
 * 이것이었다. 이 파일은 그 회귀를 잡는다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeUser = { uid: string; isAnonymous: boolean };

/** 복원이 끝나야(=authStateReady가 resolve해야) currentUser가 채워지는 가짜 Auth. */
const authStub = {
  currentUser: null as FakeUser | null,
  /** authStateReady()가 resolve할 때 되살아날 세션. null이면 로그인한 적 없는 것. */
  restored: null as FakeUser | null,
  async authStateReady() {
    this.currentUser = this.restored;
  },
};

const signInAnonymously = vi.fn(async () => {
  const user: FakeUser = { uid: 'anon-new', isAnonymous: true };
  authStub.currentUser = user;
  return { user };
});

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({
  getAuth: () => authStub,
  signInAnonymously,
  onAuthStateChanged: () => () => {},
  GoogleAuthProvider: class {},
  linkWithPopup: vi.fn(),
  signInWithCredential: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('firebase/firestore/lite', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}) }));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}) }));

/** firebase.ts는 모듈 전역에 로그인 프라미스를 캐시한다 — 매번 새로 불러와야 한다. */
async function freshEnsureSignedIn() {
  vi.resetModules();
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project');
  const module = await import('./firebase');
  return module.ensureSignedIn;
}

beforeEach(() => {
  authStub.currentUser = null;
  authStub.restored = null;
  signInAnonymously.mockClear();
});

describe('ensureSignedIn', () => {
  it('복원될 Google 세션이 있으면 익명 계정을 새로 만들지 않는다', async () => {
    authStub.restored = { uid: 'google-uid', isAnonymous: false };

    const ensureSignedIn = await freshEnsureSignedIn();
    const { user, error } = await ensureSignedIn();

    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(user?.uid).toBe('google-uid');
    expect(error).toBeNull();
  });

  it('복원될 익명 세션도 그대로 쓴다 — uid가 바뀌면 그룹 소속이 날아간다', async () => {
    authStub.restored = { uid: 'anon-old', isAnonymous: true };

    const ensureSignedIn = await freshEnsureSignedIn();
    const { user } = await ensureSignedIn();

    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(user?.uid).toBe('anon-old');
  });

  it('정말로 로그인한 적이 없을 때만 익명 계정을 만든다', async () => {
    const ensureSignedIn = await freshEnsureSignedIn();
    const { user } = await ensureSignedIn();

    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(user?.uid).toBe('anon-new');
  });
});
