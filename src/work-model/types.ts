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
/**
 * 재질 8종.
 *
 * v2.5부터 재질은 외형만이 아니라 **소리·움직임·빛·느낌의 묶음**이다.
 * 무엇을 함께 갈아끼우는지는 `ui/material.ts`의 `MATERIALS` 표에 있다 —
 * 이 모듈은 화면도 오디오도 모르므로 여기에는 값 목록만 둔다.
 *
 * 여기서 정한 값은 키에 **그대로 저장된다**(motion/led/haptic이 함께 바뀐다).
 * 재질에서 파생해 렌더 시점에 계산하지 않는 이유: 그러면 표를 한 번 손보는 순간
 * 과거 작품 전체가 다르게 재생된다. 프리셋은 "고를 때 적용되는 것"이지
 * "재생할 때 해석되는 것"이 아니다.
 */
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

/**
 * 흔적의 모양.
 *
 * 발자국이 넷인 것은 아이가 **누가 지나갔는지**를 고르게 하기 위해서다.
 * 로드맵 2번이 흔적을 그림 그리기 도구로 본 이유가 그것이고, 거기에 예시로 적힌
 * "고양이가 걸어간 길", "공룡 발자국이 동굴까지 이어짐"이 그대로 여기 있다.
 *
 * 뒤의 넷(별·꽃·불꽃·번개)은 지나간 자국이 아니라 **터진 흔적**이다. 키 하나에
 * 성격을 입히는 쪽에 가깝고, 그래서 `grow`보다 `fade`·`walk`와 잘 맞는다.
 *
 * `myStamp@1`은 아이가 직접 그린 스탬프다 — 모양이 `trace.assetId`에 들어 있다.
 *
 * 값을 추가하면 `ui/trace.ts`의 `TRACE_SHAPE_CLASS`에도 반드시 넣어야 한다.
 * 안 넣으면 목록에는 뜨는데 화면에는 아무것도 안 찍힌다(trace.test.ts가 잡는다).
 */
export type TraceType =
  | 'none'
  | 'catPaw@1'
  | 'dogPaw@1'
  | 'birdFoot@1'
  | 'dinoFoot@1'
  | 'star@1'
  | 'flower@1'
  | 'flame@1'
  | 'bolt@1'
  | 'myStamp@1';

/**
 * 찍힌 뒤에 무엇을 하는가 (v2.5).
 *
 * 'fade' — v1.6의 그것. 찍히고, 머물고, 사라진다.
 * 'grow' — 성장형. 사라지지 않고 쌓인다. 15초 뒤 마지막 화면이 곧 아이가 그린 그림이다.
 * 'walk' — 이동형. 찍힌 자리에서 제 방향으로 걸어가며 사라진다.
 *
 * 이동 방향까지 (seed, eventIndex)에서 유도한다. 여기가 흔들리면 같은 작품이
 * 기기마다 다른 그림이 된다 — 흔적은 영상이 아니라 리플레이의 결과물이다.
 */
export type TraceBehavior = 'fade' | 'grow' | 'walk';

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
  /**
   * 누를 때 화면에 남는 흔적. 기본은 'none'이다.
   *
   * `assetId`는 `type === 'myStamp@1'`일 때만 의미가 있다. 타입을 바꿔도 지우지
   * 않는다 — 아이가 발자국을 잠깐 써 보고 돌아왔을 때 그린 그림이 그대로 있어야 한다.
   * 대신 그 자산은 계속 참조된 것으로 친다(validate.ts의 isAssetReferenced).
   */
  trace: {
    type: TraceType;
    color: string;
    behavior: TraceBehavior;
    /** AssetRef.id. 직접 그린 스탬프의 그림. 안 그렸으면 null. */
    assetId: string | null;
  };
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

/* ── 비밀 반응 (v1.5, 순서 조건은 v2.6) ──────────── */

/**
 * 비밀이 열리는 조건.
 *
 * v1.5는 `pressCount` 하나였다. `sequence`가 v2.6에서 붙었고, 둘의 차이는
 * 개수가 아니라 **무엇을 숨기는가**다:
 *   · pressCount — 키 하나를 계속 누르다 보면 열린다. 우연히 찾을 수 있다.
 *   · sequence   — 네 키를 정해진 차례로 눌러야 열린다. 우연으로는 못 연다.
 *
 * 순서 조건이 있어야 로드맵 3번의 "정해진 순서대로 눌렀을 때"가 성립하고,
 * 그때 비로소 작품이 **이야기를 가진다** — 등장인물 넷을 차례로 불러내는 것 같은.
 *
 * 유니온에 케이스를 더하는 것은 파괴적 변경이 아니다. 남은 두 종(길게 누르기,
 * 두 키 동시 누르기)도 같은 방식으로 붙일 수 있다.
 */
export type SecretTrigger =
  | { kind: 'pressCount'; key: KeyIndex; count: number }
  | { kind: 'sequence'; keys: KeyIndex[] };

/**
 * 비밀이 열렸을 때 무엇이 나타나는가.
 *
 * `finale`은 자산이 없는 대신 **작품이 이미 가진 것을 한꺼번에 터뜨린다** —
 * 화면이 어두워지고 키 넷의 소리·움직임·빛·흔적이 동시에 발화한다.
 * 아이가 따로 그리거나 녹음할 것이 없는데도 가장 큰 연출이 나오는 이유가 이것이다.
 */
export type SecretRevealKind = 'art' | 'sound' | 'led' | 'finale';

export type SecretReveal = { kind: SecretRevealKind; assetId?: string };

/**
 * 이 결과는 자산(그림·소리)이 있어야 열리는가.
 *
 * 한 군데에 모아 둔 이유: 이 판정이 파서·검증·업로드·편집 화면 네 군데에 흩어져
 * 있었고, v1.5에서 그중 하나만 어긋나도 **"비밀 N개"라고 표시되는데 아무리 눌러도
 * 안 열리는** 상태가 됐다. 결과 종류를 하나 더할 때 고칠 곳이 여기 하나여야 한다.
 */
export function revealNeedsAsset(kind: SecretRevealKind): boolean {
  return kind === 'art' || kind === 'sound';
}

export type Secret = {
  id: string;
  trigger: SecretTrigger;
  reveal: SecretReveal;
};

/** 작품 하나에 숨길 수 있는 비밀 개수. Firestore 보안 규칙과 같은 값이다. */
export const SECRETS_MAX = 3;

/**
 * 비밀을 여는 누름 횟수의 범위.
 *
 * 3번보다 적으면 그냥 눌러보다 우연히 열려 "숨겨졌다"는 느낌이 안 남고,
 * 10번을 넘으면 힌트 없이는 아무도 못 찾는다.
 */
export const SECRET_COUNT_MIN = 3;
export const SECRET_COUNT_MAX = 10;

/**
 * 순서 조건의 길이 범위.
 *
 * 2보다 짧으면 그냥 한 번 누르는 것이라 순서가 아니고, 6을 넘으면 힌트 없이
 * 맞히는 것이 사실상 불가능하다. 키가 4개뿐이라 같은 키를 두 번 넣을 수 있고
 * (탄지로 → 네즈코 → 탄지로), 그래서 상한이 키 개수보다 크다.
 */
export const SECRET_SEQUENCE_MIN = 2;
export const SECRET_SEQUENCE_MAX = 6;

/** 비밀 id. 한 작품 안에서만 구별되면 되므로 짧다. */
export const SECRET_ID_LENGTH = 6;

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

/*
 * 빠르기 이름(느리게/보통/빠르게)은 여기 없다.
 * 이 모듈은 화면도 언어도 모르는 순수 스키마다 — 이름은 StageScreen이
 * i18n 사전에서 가져온다.
 */

export function tempoOf(preset: TempoPreset): Tempo {
  return { preset, bpm: TEMPO_BPM[preset] };
}

/* ── 작품 ────────────────────────────────────────── */

/**
 * 'local'  — 이 기기에만 있다. 서버에 아무것도 올라가 있지 않다.
 * 'link'   — 공유 완료. 링크로 열 수 있다. 원격 discoverable 메타가 true면 피드에도 표시된다.
 */
/**
 * `group` 작품은 초대 그룹의 현재 멤버만 열 수 있다. `link`는 기존 공개/미등재
 * 공유 호환용으로 남긴다 — 두 정책을 같은 값으로 취급하면 회사용 비공개 약속이
 * 다시 깨진다.
 */
export type Visibility = 'local' | 'link' | 'group';

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
