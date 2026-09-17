/**
 * 앱 상태 — 엔진 하나 + 편집 중인 작품 하나.
 *
 * v1에는 동시에 여러 작품을 편집하는 흐름이 없다. 그래서 전역 상태도 하나뿐이다.
 * 작품은 항상 로컬에 먼저 저장하고, 사용자가 Google 계정을 연결한 경우에만 비공개 백업한다.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { KeycapEngine } from '../audio-engine/engine';
import { t } from '../i18n';
import {
  loadCloudProfile,
  renamePublishedCreator,
  saveCloudProfile,
  scheduleWorkBackup,
  syncAccountWorks,
} from '../storage/account';
import { registerAssets, resolveAsset } from '../storage/assets';
import { getWorkRecord, putWorkRecord, pruneAssets, renameLocalWorks } from '../storage/db';
import {
  auth,
  isFirebaseConfigured,
  isPermanentUser,
  updateFirebaseProfile,
  watchUser,
} from '../storage/firebase';
import {
  creatorProfile,
  normalizeProfile,
  saveCreatorProfile,
  type CreatorProfile,
} from '../storage/identity';
import { syncPublicAvatar } from '../storage/public-avatar';
import {
  isCloudBackupOptIn,
  redeemRecoveryCode,
  setCloudBackupOptIn,
} from '../storage/recovery';
import { renderListThumb, THUMB_VERSION } from '../storage/thumbnail';
import { createWork } from '../work-model/defaults';
import { durationForTempo } from '../work-model/timing';
import { tempoOf, type KeyDef, type KeyIndex, type TempoPreset, type Work } from '../work-model/types';
import { applyDraftChange } from './draft-state';

type AppState = {
  engine: KeycapEngine;
  nick: string;
  profile: CreatorProfile;
  account: { kind: 'local' | 'anonymous' | 'syncing' | 'google'; email: string | null };
  /** 저장된 인증 세션을 한 번이라도 확인했는가. 이게 false인 동안은 account.kind가
   *  아직 'local'이어도 "로그인 안 했다"가 아니라 "아직 모른다"다 — Google로 이미
   *  연결된 사람에게 새로고침 직후 잠깐 "로그인해 주세요"를 잘못 보여주지 않으려면
   *  화면이 이 값도 함께 봐야 한다. */
  authReady: boolean;
  /**
   * 이 기기가 클라우드 백업을 쓰는가.
   *
   * Google 계정은 언제나 참이다. 익명 계정은 복구 코드를 만든 뒤에만 참이 된다 —
   * 공유하지 않은 작품이 기기 밖으로 나가는 것은 사용자가 켜는 일이지 기본값이 아니다.
   */
  cloudBackup: boolean;
  /** 로컬 저장 실패는 만들기를 막지 않되, 화면에서 복구 행동을 제공해야 한다. */
  storageStatus: 'saved' | 'saving' | 'error';
  syncRevision: number;
  draft: Work | null;
  startNewDraft: () => Promise<Work>;
  openDraft: (id: string) => Promise<Work | null>;
  patchDraft: (patch: Partial<Work>) => void;
  patchKey: (idx: KeyIndex, patch: Partial<KeyDef>) => void;
  setTempo: (preset: TempoPreset) => void;
  /** work를 주면 그것을, 안 주면 현재 draft를 저장한다. */
  saveDraft: (opts?: { thumb?: boolean; work?: Work }) => Promise<void>;
  retrySaveDraft: () => Promise<void>;
  updateCreatorProfile: (profile: CreatorProfile) => Promise<void>;
  /** 복구 코드를 발급받은 직후. 백업을 켜고 이 기기의 작품을 올린다. */
  enableCloudBackup: () => Promise<void>;
  /** 복구 코드로 원래 계정으로 갈아탄 뒤 그 계정의 작품을 내려받는다. */
  recoverAccount: (code: string) => Promise<void>;
  clearDraft: () => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<KeycapEngine | null>(null);
  if (!engineRef.current) engineRef.current = new KeycapEngine(resolveAsset);
  const engine = engineRef.current;

  const [profile, setProfile] = useState<CreatorProfile>(() => creatorProfile());
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const nick = profile.name;
  const [account, setAccount] = useState<AppState['account']>({ kind: 'local', email: null });
  // Firebase 설정이 없으면 watchUser가 아예 안 불리니 "확인할 것 없음"으로 바로 준비됨 처리한다.
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [cloudBackup, setCloudBackup] = useState(() => isCloudBackupOptIn());
  const [storageStatus, setStorageStatus] = useState<AppState['storageStatus']>('saved');
  const saveSequence = useRef(0);
  const [syncRevision, setSyncRevision] = useState(0);
  /**
   * 지금 돌고 있는 동기화와 **그게 누구 것인지.**
   *
   * uid를 함께 들고 있는 이유는 복구 때문이다. 복구는 로그인한 사용자를 통째로
   * 갈아치우는데, uid를 안 보고 "이미 돌고 있으면 그걸 돌려준다"로만 두면
   * 되찾은 계정의 동기화가 **옛 계정의 동기화로 대체된다** — 화면은 성공이라고
   * 말하지만 작품은 내려오지 않는다.
   */
  const accountSyncRef = useRef<{ uid: string; promise: Promise<void> } | null>(null);
  const [draft, setDraft] = useState<Work | null>(null);
  const draftRef = useRef<Work | null>(null);
  draftRef.current = draft;

  useEffect(() => {
    // 오디오 문제는 콘솔에서 만져봐야 잡힌다. 개발 빌드에서만 노출한다.
    if (import.meta.env.DEV) {
      (window as unknown as { __engine?: KeycapEngine }).__engine = engine;
    }
    return () => engine.dispose();
  }, [engine]);

  /**
   * 클라우드 계정 하이드레이션 — 프로필을 맞추고 작품을 양방향으로 맞춘다.
   *
   * `kind`가 둘인 이유는 **화면에 보이는 계정 상태만** 다르기 때문이다. 하는 일은
   * 같다(클라우드 프로필 → 로컬 프로필 → 작품 동기화 → 이름 일괄 반영 → 백업 예약).
   *
   * 익명 계정을 'syncing'으로 두면 안 된다. 그 상태는 화면에서 "Google 계정에
   * 연결하는 중"이라는 뜻으로 쓰이고 있어서(ProfileScreen), 복구 코드를 만든
   * 익명 사용자에게 있지도 않은 Google 연결이 진행 중인 것처럼 보인다.
   */
  const hydrateCloudAccount = useCallback(async (
    user: import('firebase/auth').User,
    kind: 'google' | 'anonymous',
  ) => {
    const previous = accountSyncRef.current;
    if (previous?.uid === user.uid) return previous.promise;
    const syncing = (async () => {
      /*
       * 다른 계정의 동기화가 돌고 있으면 끝나기를 기다린다. 겹쳐 돌리면 두 계정이
       * 같은 로컬 작품을 서로 올리고 내리며 엇갈린다. 앞의 것이 실패로 끝나도
       * 이쪽은 계속 간다 — 옛 계정의 실패가 되찾은 계정을 막을 이유는 없다.
       */
      await previous?.promise.catch(() => {});
      if (kind === 'google') setAccount({ kind: 'syncing', email: user.email });
      const cloudProfile = await loadCloudProfile(user.uid);
      const current = profileRef.current;
      const next = cloudProfile ?? normalizeProfile({
        name: current.customized ? current.name : (user.displayName || current.name),
        avatarUrl: current.avatarUrl || user.photoURL,
        avatarSource: current.avatarUrl ? current.avatarSource : (user.photoURL ? 'google' : null),
        stageAvatarEnabled: current.stageAvatarEnabled,
        customized: current.customized,
      });
      const saved = saveCreatorProfile(next);
      profileRef.current = saved;
      setProfile(saved);
      if (!cloudProfile) await saveCloudProfile(user.uid, saved);
      await syncAccountWorks(user.uid);
      const records = await renameLocalWorks(saved.name);
      for (const record of records) scheduleWorkBackup(record);
      setSyncRevision((value) => value + 1);
      setAccount({ kind, email: kind === 'google' ? user.email : null });
    })();
    accountSyncRef.current = { uid: user.uid, promise: syncing };
    void syncing.catch(() => {}).finally(() => {
      // 그 사이에 다른 계정의 동기화가 자리를 차지했으면 그것을 지우면 안 된다.
      if (accountSyncRef.current?.promise === syncing) accountSyncRef.current = null;
    });
    return syncing;
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return watchUser((user) => {
      setAuthReady(true);
      if (!user) {
        setAccount({ kind: 'local', email: null });
      } else if (user.isAnonymous) {
        setAccount({ kind: 'anonymous', email: null });
        /*
         * 익명 계정도 **복구 코드를 만들어 둔 경우에만** 동기화한다.
         * 이 조건이 없으면 앱을 켜기만 해도 아이의 작품이 전부 서버로 올라간다 —
         * 공유하지 않은 것은 이 기기 밖으로 나가지 않는다는 약속을 깨는 일이다.
         *
         * 반대로 이 갈래가 없으면 복구가 무의미해진다. 기기를 바꿔 코드를 넣어도
         * 되찾을 것이 클라우드에 없기 때문이다.
         */
        if (isCloudBackupOptIn()) {
          setCloudBackup(true);
          void hydrateCloudAccount(user, 'anonymous').catch((error) =>
            console.warn('[account] 익명 계정 백업 동기화에 실패했어요', error),
          );
        }
      } else {
        setCloudBackup(true);
        void hydrateCloudAccount(user, 'google').catch((error) => {
          console.warn('[account] 계정 동기화에 실패했어요', error);
          setAccount({ kind: 'google', email: user.email });
        });
      }
    });
  }, [hydrateCloudAccount]);

  /**
   * 자산 레지스트리는 **렌더 중에** 갱신한다. effect로 하면 안 된다.
   *
   * React는 자식 effect를 부모보다 먼저 실행한다. 여기가 부모(Provider)이므로
   * effect에 두면 Keycap의 useAssetUrl이 "아직 등록되지 않은 assetId"를 조회하고,
   * 조회 실패는 URL을 null로 남긴다 — 그림을 그려도 영영 안 보인다.
   * 실제로 그 버그였다. 레지스트리는 순수 캐시라 렌더 중 갱신해도 안전하다.
   */
  if (draft) registerAssets(draft);

  /**
   * 저장 실패로 만들기를 막지 않는다.
   * Safari 사생활 보호 모드, 저장 공간 부족, 다른 탭이 붙든 업그레이드 —
   * IndexedDB는 생각보다 자주 못 쓴다. 그때도 아이는 만들고 공연할 수 있어야 하고,
   * 잃는 것은 "다음에 이어서 하기"뿐이어야 한다.
   */
  const startNewDraft = useCallback(async () => {
    const work = createWork({ authorNick: nick });
    setDraft(work);
    registerAssets(work);
    const sequence = ++saveSequence.current;
    setStorageStatus('saving');
    try {
      await putWorkRecord({ work, updatedAt: Date.now(), published: false });
      if (sequence === saveSequence.current) setStorageStatus('saved');
    } catch (e) {
      console.warn('[storage] 작품을 저장하지 못했어요 — 이어서 만들기가 안 될 수 있어요', e);
      if (sequence === saveSequence.current) setStorageStatus('error');
    }
    return work;
  }, [nick]);

  const openDraft = useCallback(async (id: string) => {
    const record = await getWorkRecord(id).catch(() => undefined);
    if (!record) return null;
    setDraft(record.work);
    registerAssets(record.work);
    return record.work;
  }, []);

  const patchDraft = useCallback((patch: Partial<Work>) => {
    setDraft((prev) => (prev ? applyDraftChange(prev, patch) : prev));
  }, []);

  const patchKey = useCallback((idx: KeyIndex, patch: Partial<KeyDef>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const keys = prev.keys.map((k) => (k.idx === idx ? { ...k, ...patch } : k)) as Work['keys'];
      return applyDraftChange(prev, { keys });
    });
  }, []);

  /** 템포를 바꾸면 공연 길이도 같이 바뀐다 — 마디 단위로 끊기 때문에. */
  const setTempo = useCallback((preset: TempoPreset) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const tempo = tempoOf(preset);
      return applyDraftChange(prev, {
        tempo,
        replay: { ...prev.replay, durationMs: durationForTempo(tempo) },
      });
    });
  }, []);

  const saveDraft = useCallback(async (opts: { thumb?: boolean; work?: Work } = {}) => {
    const work = opts.work ?? draftRef.current;
    if (!work) return;
    const sequence = ++saveSequence.current;
    setStorageStatus('saving');
    try {
      const existing = await getWorkRecord(work.id);
      const thumb = opts.thumb
        ? await renderListThumb(work).catch(() => undefined)
        : existing?.thumb;
      const record = {
        work,
        updatedAt: Date.now(),
        published: existing?.published ?? false,
        thumb,
        thumbV: opts.thumb ? THUMB_VERSION : existing?.thumbV,
      };
      await putWorkRecord(record);
      scheduleWorkBackup(record);
      if (sequence === saveSequence.current) setStorageStatus('saved');
      /*
       * 여기서 pruneAssets를 부르면 안 된다.
       *
       * 그림을 저장하는 순서는 blob 쓰기 → setState(assets) → 시트 닫기 → saveDraft다.
       * 시트를 닫는 시점에 React가 아직 state를 반영하지 않았으면 work.assets가 비어 있고,
       * 그 상태로 청소하면 **방금 쓴 blob을 지운다.** 화면에는 이미 만든 objectURL이
       * 남아 있어서 멀쩡해 보이고, 새로고침해야 그림이 사라진 걸 알게 된다.
       * 실제로 그 버그였다. 청소는 아래 별도 effect에서 안정된 상태로만 한다.
       */
    } catch (e) {
      // 저장 실패가 화면 전환을 막지 않게 한다(위 startNewDraft 주석 참조).
      console.warn('[storage] 저장하지 못했어요', e);
      if (sequence === saveSequence.current) setStorageStatus('error');
    }
  }, []);

  const retrySaveDraft = useCallback(() => saveDraft({ thumb: true }), [saveDraft]);

  const updateCreatorProfile = useCallback(async (nextProfile: CreatorProfile) => {
    const candidate = normalizeProfile({ ...nextProfile, customized: true }, profileRef.current.name);
    await syncPublicAvatar(candidate);
    const saved = saveCreatorProfile(candidate);
    profileRef.current = saved;
    setProfile(saved);
    setDraft((current) => (current ? { ...current, authorNick: saved.name } : current));
    const records = await renameLocalWorks(saved.name);
    if (isFirebaseConfigured) {
      const user = auth().currentUser;
      if (user) {
        await updateFirebaseProfile(saved.name).catch(() => {});
        await renamePublishedCreator(records, saved.name);
        /*
         * 백업을 쓰는 계정이면 종류를 가리지 않고 올린다.
         *
         * 예전에는 비익명(Google) 계정만 여기를 지났다. Google 연결을 걷어낸 지금
         * 그대로 두면 **아무의 프로필도 클라우드에 올라가지 않는다** — 복구 코드를
         * 만들어 둔 사람이 기기를 바꿔 되찾아도 이름과 사진은 옛 값 그대로다
         * (hydrateCloudAccount가 클라우드 프로필을 우선하기 때문).
         */
        if (isPermanentUser(user) || isCloudBackupOptIn()) {
          await saveCloudProfile(user.uid, saved);
          for (const record of records) scheduleWorkBackup(record);
        }
      }
    }
    setSyncRevision((value) => value + 1);
  }, []);

  /**
   * 복구 코드를 발급받은 직후 부른다.
   *
   * 백업을 켜는 것으로 끝내면 **이미 만들어 둔 작품은 영영 안 올라간다.**
   * scheduleWorkBackup은 앞으로 저장되는 것만 태우기 때문이다. 그래서 여기서
   * 하이드레이션을 한 번 돌려 기기에 있는 것을 통째로 올린다.
   */
  const enableCloudBackup = useCallback(async () => {
    setCloudBackupOptIn(true);
    setCloudBackup(true);
    if (!isFirebaseConfigured) return;
    const user = auth().currentUser;
    if (!user) return;
    await hydrateCloudAccount(user, isPermanentUser(user) ? 'google' : 'anonymous');
  }, [hydrateCloudAccount]);

  /**
   * 복구 코드로 원래 계정 되찾기.
   *
   * 되찾은 직후에 하이드레이션을 **직접** 부른다. watchUser도 곧 새 사용자로 불리지만,
   * 화면은 "복구했어요"를 말하기 전에 작품이 실제로 내려온 것을 기다려야 한다 —
   * 먼저 성공을 알리고 목록이 몇 초 뒤에 채워지면, 사용자는 그 몇 초 동안
   * "복구했는데 아무것도 없다"를 본다.
   */
  const recoverAccount = useCallback(async (code: string) => {
    if (!isFirebaseConfigured) throw new Error(t('firebase.required'));
    await redeemRecoveryCode(code);
    setCloudBackup(true);
    const user = auth().currentUser;
    if (!user) return;
    try {
      await hydrateCloudAccount(user, isPermanentUser(user) ? 'google' : 'anonymous');
    } catch (error) {
      /*
       * 여기까지 왔으면 **계정은 이미 갈아탔다.** 내려받기만 실패한 것이다.
       * 동기화 오류를 그대로 올려 보내면 화면은 "되찾지 못했어요"라고 말하고,
       * 사용자는 아무 일도 없었다고 믿은 채 코드를 또 넣는다. 실제로 일어난 일과
       * 지금 할 수 있는 일을 그대로 적는다.
       */
      console.warn('[recovery] 계정은 되찾았지만 동기화에 실패했어요', error);
      throw new Error(t('recovery.restoredButSyncFailed'));
    }
  }, [hydrateCloudAccount]);

  const clearDraft = useCallback(() => setDraft(null), []);

  // 편집 중 변경은 조용히 로컬에 눌러 담는다 — 아이가 "저장"을 누르는 흐름은 없다.
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => {
      void saveDraft();
    }, 400);
    return () => clearTimeout(t);
  }, [draft, saveDraft]);

  /**
   * 참조가 끊긴 blob 청소.
   * 상태가 **가라앉은 뒤에만** 돈다 — 이 effect는 draft가 2초간 변하지 않았을 때만
   * 실행되므로, 저장 직후의 과도기 상태를 보고 방금 만든 자산을 지울 일이 없다.
   * 녹음을 여러 번 다시 하면 안 쓰는 blob이 쌓이므로 청소 자체는 필요하다.
   */
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => {
      void pruneAssets(draft).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [draft]);

  const value = useMemo<AppState>(
    () => ({
      engine,
      nick,
      profile,
      account,
      authReady,
      cloudBackup,
      storageStatus,
      syncRevision,
      draft,
      startNewDraft,
      openDraft,
      patchDraft,
      patchKey,
      setTempo,
      saveDraft,
      retrySaveDraft,
      updateCreatorProfile,
      enableCloudBackup,
      recoverAccount,
      clearDraft,
    }),
    [
      engine,
      nick,
      profile,
      account,
      authReady,
      cloudBackup,
      storageStatus,
      syncRevision,
      draft,
      startNewDraft,
      openDraft,
      patchDraft,
      patchKey,
      setTempo,
      saveDraft,
      retrySaveDraft,
      updateCreatorProfile,
      enableCloudBackup,
      recoverAccount,
      clearDraft,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AppStateProvider 밖에서 useAppState를 불렀어요');
  return ctx;
}
