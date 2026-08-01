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
  connectGoogleAccount,
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
import { removePublicAvatar, syncPublicAvatar } from '../storage/public-avatar';
import { renderListThumb } from '../storage/thumbnail';
import { createWork } from '../work-model/defaults';
import { durationForTempo } from '../work-model/timing';
import { tempoOf, type KeyDef, type KeyIndex, type TempoPreset, type Work } from '../work-model/types';

type AppState = {
  engine: KeycapEngine;
  nick: string;
  profile: CreatorProfile;
  account: { kind: 'local' | 'anonymous' | 'syncing' | 'google'; email: string | null };
  syncRevision: number;
  draft: Work | null;
  startNewDraft: () => Promise<Work>;
  openDraft: (id: string) => Promise<Work | null>;
  patchDraft: (patch: Partial<Work>) => void;
  patchKey: (idx: KeyIndex, patch: Partial<KeyDef>) => void;
  setTempo: (preset: TempoPreset) => void;
  /** work를 주면 그것을, 안 주면 현재 draft를 저장한다. */
  saveDraft: (opts?: { thumb?: boolean; work?: Work }) => Promise<void>;
  updateCreatorProfile: (profile: CreatorProfile) => Promise<void>;
  connectGoogle: () => Promise<void>;
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
  const [syncRevision, setSyncRevision] = useState(0);
  const accountSyncRef = useRef<Promise<void> | null>(null);
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

  const hydratePermanentAccount = useCallback(async (user: import('firebase/auth').User) => {
    if (accountSyncRef.current) return accountSyncRef.current;
    const syncing = (async () => {
      setAccount({ kind: 'syncing', email: user.email });
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
      setAccount({ kind: 'google', email: user.email });
    })().finally(() => {
      accountSyncRef.current = null;
    });
    accountSyncRef.current = syncing;
    return syncing;
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return watchUser((user) => {
      if (!user) {
        setAccount({ kind: 'local', email: null });
      } else if (user.isAnonymous) {
        setAccount({ kind: 'anonymous', email: null });
      } else {
        void hydratePermanentAccount(user).catch((error) => {
          console.warn('[account] 계정 동기화에 실패했어요', error);
          setAccount({ kind: 'google', email: user.email });
        });
      }
    });
  }, [hydratePermanentAccount]);

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
    void putWorkRecord({ work, updatedAt: Date.now(), published: false }).catch((e) =>
      console.warn('[storage] 작품을 저장하지 못했어요 — 이어서 만들기가 안 될 수 있어요', e),
    );
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
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const patchKey = useCallback((idx: KeyIndex, patch: Partial<KeyDef>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const keys = prev.keys.map((k) => (k.idx === idx ? { ...k, ...patch } : k)) as Work['keys'];
      return { ...prev, keys };
    });
  }, []);

  /** 템포를 바꾸면 공연 길이도 같이 바뀐다 — 마디 단위로 끊기 때문에. */
  const setTempo = useCallback((preset: TempoPreset) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const tempo = tempoOf(preset);
      return {
        ...prev,
        tempo,
        replay: { ...prev.replay, durationMs: durationForTempo(tempo) },
      };
    });
  }, []);

  const saveDraft = useCallback(async (opts: { thumb?: boolean; work?: Work } = {}) => {
    const work = opts.work ?? draftRef.current;
    if (!work) return;
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
      };
      await putWorkRecord(record);
      scheduleWorkBackup(record);
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
    }
  }, []);

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
        if (isPermanentUser(user)) {
          await saveCloudProfile(user.uid, saved);
          for (const record of records) scheduleWorkBackup(record);
        }
      }
    }
    setSyncRevision((value) => value + 1);
  }, []);

  const connectGoogle = useCallback(async () => {
    if (!isFirebaseConfigured) throw new Error('Firebase 설정이 필요해요');
    setAccount({ kind: 'syncing', email: null });
    try {
      const result = await connectGoogleAccount({ beforeAccountSwitch: removePublicAvatar });
      await hydratePermanentAccount(result.user);
      if (result.mergedExistingAccount && profileRef.current.stageAvatarEnabled) {
        await syncPublicAvatar(profileRef.current);
      }
    } catch (error) {
      const user = auth().currentUser;
      setAccount(isPermanentUser(user)
        ? { kind: 'google', email: user.email }
        : { kind: user?.isAnonymous ? 'anonymous' : 'local', email: null });
      throw error;
    }
  }, [hydratePermanentAccount]);

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
      syncRevision,
      draft,
      startNewDraft,
      openDraft,
      patchDraft,
      patchKey,
      setTempo,
      saveDraft,
      updateCreatorProfile,
      connectGoogle,
      clearDraft,
    }),
    [
      engine,
      nick,
      profile,
      account,
      syncRevision,
      draft,
      startNewDraft,
      openDraft,
      patchDraft,
      patchKey,
      setTempo,
      saveDraft,
      updateCreatorProfile,
      connectGoogle,
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
