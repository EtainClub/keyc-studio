/**
 * Firebase 초기화 + 익명 로그인 + Google 계정 연결.
 *
 * 익명 로그인과 선택적인 Google 계정 연결을 지원한다. 다만 **어떤 로그인도 법정대리인 동의를
 * 대체하지는 않는다** — 동의 필요 여부는 로그인 방식이 아니라 아동의 개인정보를
 * 수집·이용하는가로 판단되고, 목소리·그림·작품 기록은 그 대상이다.
 * 익명 인증은 서버에서 "이 작품의 주인이 누구인가"를 판별하는 기술 수단일 뿐이다.
 *
 * 앱 시작 시에는 저장된 인증 세션만 확인하고, 새 익명 계정은 공유나 Google 연결을
 * 사용자가 직접 시작했을 때만 만든다.
 *
 * 설정이 비어 있으면(로컬 개발) 앱은 그대로 돈다 — 공유만 막힌다.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore/lite';
import { getFunctions, type Functions } from 'firebase/functions';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

/** 사용자가 한국에 있다. 서울 리전이 왕복 지연을 가장 줄인다. */
export const REGION = 'asia-northeast3';

/**
 * 썸네일·아바타 같은 정적 자산의 정식 출처.
 * SPA 셸 자체는 이 도메인 밖(로컬 개발 서버, 토스 미니앱 웹뷰 등)에서도 서빙될 수
 * 있는데, 그런 origin에는 Firebase Hosting의 `/thumb`, `/avatar` rewrite가 없다.
 * 상대 경로로 두면 그 origin으로 요청이 나가 조용히 깨진다 — 항상 이 도메인으로
 * 절대 경로를 가리켜야 한다. (functions/index.js의 PUBLIC_ORIGIN과 같은 값이어야 한다.)
 */
export const PUBLIC_ORIGIN = 'https://keyc.studio';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;
let functionsInstance: Functions | null = null;

function ensureApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase 설정이 없어요 (.env의 VITE_FIREBASE_* 확인)');
  }
  if (!app) app = initializeApp(config);
  return app;
}

export function auth(): Auth {
  if (!authInstance) authInstance = getAuth(ensureApp());
  return authInstance;
}

export function firestore(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(ensureApp());
  return dbInstance;
}

export function storage(): FirebaseStorage {
  if (!storageInstance) storageInstance = getStorage(ensureApp());
  return storageInstance;
}

/**
 * Functions 핸들.
 *
 * `getFunctions(undefined, region)`을 직접 부르면 안 된다 — 내부에서 getApp()을
 * 호출하는데, 우리는 앱을 게으르게 초기화하므로 아직 만들어지지 않았을 수 있다.
 * 로컬 작품을 감상할 때(Firestore를 한 번도 안 건드린 채 recordPlay 호출)가 그 경로다.
 */
export function functions(): Functions {
  if (!functionsInstance) functionsInstance = getFunctions(ensureApp(), REGION);
  return functionsInstance;
}

export type SignInResult = { user: User | null; error: Error | null };

let signInPromise: Promise<SignInResult> | null = null;

/**
 * 익명 로그인. 실패해도 앱을 멈추지 않는다(로컬 작업은 계속 가능).
 * 다만 **실패 원인은 버리지 않는다** — 공유 게이트가 그걸 읽을 수 있는 말로 바꾼다.
 * 원인을 삼키면 "그냥 안 돼요"만 남아서 설정 문제를 영영 못 찾는다.
 */
export function ensureSignedIn(): Promise<SignInResult> {
  if (!isFirebaseConfigured) {
    return Promise.resolve({
      user: null,
      error: new Error('공유 설정이 아직 안 됐어요 (Firebase 설정 필요)'),
    });
  }
  if (!signInPromise) {
    signInPromise = (async () => {
      const a = auth();
      if (a.currentUser) return { user: a.currentUser, error: null };
      try {
        const cred = await signInAnonymously(a);
        return { user: cred.user, error: null };
      } catch (e) {
        console.warn('[firebase] 익명 로그인 실패 — 로컬 모드로 계속합니다', e);
        // 다음 시도에서 다시 붙어볼 수 있게 캐시를 비운다.
        signInPromise = null;
        return { user: null, error: e instanceof Error ? e : new Error(String(e)) };
      }
    })();
  }
  return signInPromise;
}

export function watchUser(cb: (user: User | null) => void): () => void {
  if (!isFirebaseConfigured) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth(), cb);
}

export function currentUid(): string | null {
  if (!isFirebaseConfigured) return null;
  return auth().currentUser?.uid ?? null;
}

export function isPermanentUser(user: User | null): user is User & { isAnonymous: false } {
  return Boolean(user && !user.isAnonymous);
}

/**
 * 사진 → 선따기를 쓸 수 있는 계정.
 *
 * 저작권과 초상권 판단이 사람 손을 거쳐야 하는 기능이라 관리자 계정에서만 연다.
 * 이건 **보안 경계가 아니라 노출 범위 제한**이다 — 클라이언트 검사는 마음먹으면 우회된다.
 * 실제 방어선은 사진 유래 자산의 공유 차단(remote.ts publishWork)이고, 그건 계정과 무관하게 걸린다.
 */
export const ADMIN_EMAIL = 'etainclub@gmail.com';

export function isAdminEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === ADMIN_EMAIL;
}

/**
 * 지금 로그인한 사람이 관리자인가.
 *
 * 사진에서 딴 그림을 만들 수 있는 계정이자, 그걸 공유할 수 있는 유일한 계정이다.
 * 익명 계정은 해당 없다 — 이메일이 없으므로 언제나 false다.
 */
export function isAdminUser(): boolean {
  if (!isFirebaseConfigured) return false;
  const user = auth().currentUser;
  return isPermanentUser(user) && isAdminEmail(user.email);
}

export type GoogleLinkResult = { user: User; mergedExistingAccount: boolean };

export async function connectGoogleAccount(options: { beforeAccountSwitch?: () => Promise<void> } = {}): Promise<GoogleLinkResult> {
  const signed = await ensureSignedIn();
  if (!signed.user) throw signed.error ?? new Error('계정을 연결하지 못했어요');
  if (signed.user.providerData.some((provider) => provider.providerId === 'google.com')) {
    return { user: signed.user, mergedExistingAccount: false };
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const result = await linkWithPopup(signed.user, provider);
    signInPromise = Promise.resolve({ user: result.user, error: null });
    return { user: result.user, mergedExistingAccount: false };
  } catch (cause) {
    const code = (cause as { code?: string }).code ?? '';
    const credential = GoogleAuthProvider.credentialFromError(cause as never);
    if (
      credential &&
      (code.includes('credential-already-in-use') || code.includes('email-already-in-use'))
    ) {
      // 다른 기기에서 이미 연결한 Google 계정이면 그 계정으로 전환한 뒤 로컬 작품을 병합한다.
      await options.beforeAccountSwitch?.();
      const result = await signInWithCredential(auth(), credential);
      signInPromise = Promise.resolve({ user: result.user, error: null });
      return { user: result.user, mergedExistingAccount: true };
    }
    throw cause;
  }
}

export async function updateFirebaseProfile(name: string): Promise<void> {
  const user = auth().currentUser;
  if (user) await updateProfile(user, { displayName: name });
}
