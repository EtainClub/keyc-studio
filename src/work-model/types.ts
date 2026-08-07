/**
 * 작품 스키마 v2.
 *
 * 이 모듈은 React / DOM / Web Audio 어느 것도 import 하지 않는다.
 * 네이티브(React Native) 이식 시 이 디렉터리는 그대로 재사용된다.
 *
 * v1 → v2에서 바뀐 핵심:
 *   Tap[] → Replay(seed + ReplayEvent[])   공연이 "탭 목록"이 아니라 "재생 가능한 기록"이 됐다
 *   경로 직접 참조 → AssetRef(assetId)      로컬/원격 자산이 분리됐다
 *   stats 내장 → 별도 컬렉션               남이 쓰는 값을 작품 문서에 두지 않는다
 */

export const SCHEMA_VERSION = 2 as const;

/**
 * 엔진·프리셋 버전.
 * 프리셋을 고칠 때는 기존 값을 바꾸지 말고 `squish@2`를 추가한다.
 * 이걸 어기면 6개월 뒤 애니메이션 하나 손봤을 때 과거 작품 전체가 다르게 재생된다.
 */
export const ENGINE_VERSION = '1.0.0';
export const PRESET_VERSION = '2026-08-v1';

/** 키캡 개수는 고정. keys 튜플과 UI 한 줄 배치가 이 값에 묶여 있다. */
export const KEY_COUNT = 4;

export const TITLE_MAX = 20;
export const HINT_MAX = 40;

/** Firestore 보안 규칙과 같은 값. 규칙을 바꾸면 여기도 바꿔야 한다. */
export const REPLAY_EVENTS_MAX = 600;

/** 작품 id는 URL과 자산 경로에 쓰는 충돌 방지용 nanoid 12자. */
export const WORK_ID_LENGTH = 12;
export const ASSET_ID_LENGTH = 8;

export type KeyIndex = 0 | 1 | 2 | 3;

export type Face = 'none' | 'happy' | 'cat' | 'monster';
/** v1은 'plastic' 고정. 값 체계가 확정된 enum이라 미리 넣는 비용이 0이다. */
export type Material =
  | 'plastic'
  | 'jelly'
  | 'ice'
  | 'metal'
  | 'water'
  | 'cotton'
  | 'wood'
  | 'sand';

export type Motion =
  | 'squish@1'
  | 'jump@1'
  | 'shake@1'
  | 'spin@1'
  | 'pop@1'
  | 'melt@1';

export type Led = 'none' | 'flash@1' | 'breath@1' | 'rainbow@1';

export type TraceType = 'none' | 'catPaw@1' | 'star@1' | 'flower@1';

export type Haptic = 'tok' | 'kkuk' | 'tongtong' | 'bureure' | 'kung' | 'dugeun';

export type EveryBeats = 1 | 2 | 4 | 8;
export type OffsetBeats = 0 | 1 | 2 | 3;

/* ── 자산 ────────────────────────────────────────── */

export type AssetKind = 'art' | 'sound';

/**
 * 자산이 어디서 왔는가.
 *
 * 'photo'는 사용자가 올린 사진에서 윤곽선을 따 만든 그림이다.
 * 만드는 것도 공유하는 것도 **관리자 계정에서만** 허용된다 — 저작권·초상권 판단이
 * 사람 손을 타야 하는 입력이기 때문이다(remote.ts publishWork).
 *
 * 이 태그가 사라지면 그 구분도 사라진다 —
 * serialize.ts의 coerceAssets와 portable-work.ts가 반드시 이 필드를 보존해야 한다.
 */
export type AssetSource = 'draw' | 'photo';

export type AssetRef = {
  id: string; // nanoid 8
  kind: AssetKind;
  mimeType: 'image/png' | 'audio/wav';
  size: number;
  /** SHA-256 앞 16자 — 같은 바이트를 두 번 올리지 않기 위한 것 */
  hash: string;
  durationMs?: number;
  /** 없으면 'draw'로 본다 — 이 필드가 생기기 전 작품은 전부 직접 그린 것이다. */
  source?: AssetSource;
  /** IndexedDB Blob 키. 로컬에만 있는 자산은 이것만 있다. */
  localKey?: string;
  /** 'works/{workId}/sound/{assetId}.wav'. 업로드 후에만 채워진다. */
  remotePath?: string;
};

/* ── 키캡 ────────────────────────────────────────── */

export type KeyDef = {
  idx: KeyIndex;
  appearance: {
    /** hex, `#RRGGBB` */
    baseColor: string;
    /** AssetRef.id. 안 그렸으면 null. */
    artAssetId: string | null;
    /** v1 UI 미노출, 기본 'none' */
    face: Face;
  };
  /** v1은 'plastic' 고정 */
  material: Material;
  sound: {
    /** 내가 녹음한 소리. presetId와 둘 중 하나만 채워진다. */
    assetId: string | null;
    /** 'tok@1' 형식 */
    presetId: string | null;
    /** 0.5 ~ 2.0. playbackRate로 구현하므로 속도도 함께 변한다(의도된 재미). */
    pitch: number;
    /** 0 ~ 1 */
    gain: number;
  };
  motion: Motion;
  led: Led;
  loop: {
    /** 공연 시작 시점의 초기 상태. 공연 중 토글은 ReplayEvent로 기록된다. */
    enabled: boolean;
    everyBeats: EveryBeats;
    offsetBeats: OffsetBeats;
  };
  /**
   * 웹에서는 진동 대신 눌림 깊이·반동 애니메이션 차이로 표현한다.
   * 필드는 v1부터 저장한다 — 네이티브 전환 시 마이그레이션 없이 켜지게 하기 위함.
   */
  haptic: Haptic;
  /** v1은 'none' 고정 */
  trace: { type: TraceType; color: string };
};

/* ── 리플레이 ────────────────────────────────────── */

export type ReplayEventType = 'keyDown' | 'keyUp' | 'loopOn' | 'loopOff';

export type ReplayEvent = {
  /** 이벤트 인덱스(0부터). 난수 유도에 쓰이므로 저장 순서가 곧 의미다. */
  i: number;
  /** ms, 공연 시작 기준. 반드시 AudioContext 시계로만 계산한다. */
  t: number;
  type: ReplayEventType;
  key: KeyIndex;
};

export type Replay = {
  /** uint32 */
  seed: number;
  /** 템포별 마디 단위로 계산된 값. 15초 벽시계가 아니다. */
  durationMs: number;
  events: ReplayEvent[];
};

/* ── 비밀 반응 (v1.5) ────────────────────────────── */

/**
 * v1.5에서 pressCount 하나만 구현한다.
 * 유니온에 케이스를 나중에 추가하는 것은 파괴적 변경이 아니므로,
 * 지금 4종을 다 정의해 죽은 분기를 만들지 않는다.
 */
export type SecretTrigger = { kind: 'pressCount'; key: KeyIndex; count: number };

export type Secret = {
  id: string;
  trigger: SecretTrigger;
  reveal: { kind: 'art' | 'sound' | 'led'; assetId?: string };
};

/* ── 템포 ────────────────────────────────────────── */

/** 속도는 아이에게 숫자로 노출하지 않는다. 느리게/보통/빠르게 3단계뿐. */
export type TempoPreset = 'slow' | 'normal' | 'fast';
export type TempoBpm = 80 | 100 | 130;

export type Tempo = { preset: TempoPreset; bpm: TempoBpm };

export const TEMPO_BPM: Record<TempoPreset, TempoBpm> = {
  slow: 80,
  normal: 100,
  fast: 130,
};

export const TEMPO_LABEL: Record<TempoPreset, string> = {
  slow: '느리게',
  normal: '보통',
  fast: '빠르게',
};

export function tempoOf(preset: TempoPreset): Tempo {
  return { preset, bpm: TEMPO_BPM[preset] };
}

/* ── 작품 ────────────────────────────────────────── */

/**
 * 'local'  — 이 기기에만 있다. 서버에 아무것도 올라가 있지 않다.
 * 'link'   — 공유 완료. 링크로 열 수 있다. 원격 discoverable 메타가 true면 피드에도 표시된다.
 */
export type Visibility = 'local' | 'link';

export type Work = {
  /** nanoid 12자 */
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  engineVersion: string;
  presetVersion: string;
  title: string;
  hint: string;
  /** 형용사+명사+숫자 자동 조합. 자유 입력 금지. */
  authorNick: string;
  /** 로컬 전용 작품은 null — 만드는 동안에는 계정이 존재하지 않는다. */
  authorUid: string | null;
  createdAt: number;
  tempo: Tempo;
  keys: [KeyDef, KeyDef, KeyDef, KeyDef];
  /** 이 작품이 참조하는 모든 자산 */
  assets: AssetRef[];
  replay: Replay;
  /** v1에서는 빈 배열. 스키마 자리만 확보한다. */
  secrets: Secret[];
  visibility: Visibility;
};

export function findAsset(work: Work, assetId: string | null): AssetRef | null {
  if (!assetId) return null;
  return work.assets.find((a) => a.id === assetId) ?? null;
}

/**
 * 사진에서 딴 그림이 붙어 있는 키캡 번호(1부터).
 *
 * 공유 게이트가 "몇 번 키캡을 고쳐야 하는지" 말해주기 위한 것이고,
 * publishWork가 업로드를 거절하는 근거이기도 하다. 둘이 같은 판정을 써야
 * "막혔는데 왜 막혔는지 모르는" 상태가 생기지 않는다.
 */
export function photoArtKeyNumbers(work: Work): number[] {
  return work.keys
    .filter((key) => findAsset(work, key.appearance.artAssetId)?.source === 'photo')
    .map((key) => key.idx + 1);
}
