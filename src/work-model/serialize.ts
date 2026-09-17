/**
 * 직렬화 / 역직렬화 / 마이그레이션.
 *
 * Firestore 문서와 IndexedDB 레코드가 같은 모양을 쓴다.
 * `replay.events`는 배열 그대로 둔다 — 보안 규칙이 `events.size() <= 600`으로
 * 개수를 검사하기 때문에 압축 인코딩으로 바꾸면 규칙이 무력해진다.
 */

import { t } from '../i18n';
import { createDefaultKey } from './defaults';
import { newSeed } from './rng';
import { durationForTempo } from './timing';
import { clampSecretCount } from './validate';
import {
  ENGINE_VERSION,
  PRESET_VERSION,
  SCHEMA_VERSION,
  SECRETS_MAX,
  SECRET_SEQUENCE_MAX,
  SECRET_SEQUENCE_MIN,
  TEMPO_BPM,
  type AssetRef,
  type KeyDef,
  type KeyIndex,
  type Replay,
  type ReplayEvent,
  type Secret,
  type SecretTrigger,
  type Tempo,
  type TempoPreset,
  type Work,
} from './types';

export function serializeWork(work: Work): string {
  return JSON.stringify(work);
}

const MOTIONS = ['squish@1', 'jump@1', 'shake@1', 'spin@1', 'pop@1', 'melt@1'] as const;
const LEDS = ['none', 'flash@1', 'breath@1', 'rainbow@1'] as const;
const HAPTICS = ['tok', 'kkuk', 'tongtong', 'bureure', 'kung', 'dugeun'] as const;
const FACES = ['none', 'happy', 'cat', 'monster'] as const;
const MATERIALS = [
  'plastic', 'jelly', 'ice', 'metal', 'water', 'cotton', 'wood', 'sand',
] as const;
const TRACES = [
  'none', 'catPaw@1', 'dogPaw@1', 'birdFoot@1', 'dinoFoot@1',
  'star@1', 'flower@1', 'flame@1', 'bolt@1', 'myStamp@1',
] as const;
const TRACE_BEHAVIORS = ['fade', 'grow', 'walk'] as const;
const EVENT_TYPES = ['keyDown', 'keyUp', 'loopOn', 'loopOff'] as const;
const SECRET_REVEALS = ['art', 'sound', 'led', 'finale'] as const;

function pick<T extends readonly string[]>(
  allowed: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

/** 신뢰할 수 없는 입력(원격 문서)을 Work로 좁힌다. 모르는 필드는 버린다. */
export function parseWork(raw: unknown): Work | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;

  // v1 문서면 먼저 올린다.
  const src = o.schemaVersion === 1 ? migrateV1ToV2(o) : o;
  if (!Array.isArray(src.keys) || src.keys.length !== 4) return null;

  const tempo = coerceTempo(src.tempo);
  const keys = src.keys.map((k, i) => coerceKey(k, i as KeyIndex)) as Work['keys'];

  return {
    id: src.id as string,
    schemaVersion: SCHEMA_VERSION,
    engineVersion: typeof src.engineVersion === 'string' ? src.engineVersion : ENGINE_VERSION,
    presetVersion: typeof src.presetVersion === 'string' ? src.presetVersion : PRESET_VERSION,
    title: typeof src.title === 'string' ? src.title : '',
    hint: typeof src.hint === 'string' ? src.hint : '',
    authorNick: typeof src.authorNick === 'string' ? src.authorNick : t('serialize.unknownAuthor'),
    authorUid: typeof src.authorUid === 'string' ? src.authorUid : null,
    createdAt: typeof src.createdAt === 'number' ? src.createdAt : Date.now(),
    tempo,
    keys,
    assets: coerceAssets(src.assets),
    replay: coerceReplay(src.replay, tempo),
    secrets: coerceSecrets(src.secrets),
    visibility: src.visibility === 'link' || src.visibility === 'group' ? src.visibility : 'local',
  };
}

/**
 * 비밀은 남이 만든 문서에서 온다. 조건도 결과도 화이트리스트로 좁힌다.
 *
 * **모르는 조건은 통째로 버린다.** 열 방법이 없는 비밀을 살려 두면 감상 화면의
 * "비밀 N개"에는 잡히면서 아무리 눌러도 안 열린다 — 감상자는 없는 것을 영원히 찾는다.
 * 버리면 개수부터 줄어드니 애초에 찾지 않는다.
 *
 * reveal이 가리키는 자산이 실제로 있는지는 여기서 보지 않는다. 그건 assets를
 * 다 읽은 뒤에야 알 수 있고, 판단은 validateWork와 업로드 쪽 몫이다.
 */
function coerceSecrets(raw: unknown): Secret[] {
  if (!Array.isArray(raw)) return [];
  const out: Secret[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (out.length >= SECRETS_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const reveal = (o.reveal ?? {}) as Record<string, unknown>;

    const trigger = coerceTrigger(o.trigger);
    if (!trigger) continue;

    // id가 겹치면 "이 비밀을 찾았는가"를 추적할 수 없다. 뒤엣것을 버린다.
    const id = typeof o.id === 'string' && o.id ? o.id : `s${out.length}`;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      trigger,
      reveal: {
        kind: pick(SECRET_REVEALS, reveal.kind, 'led'),
        assetId: typeof reveal.assetId === 'string' ? reveal.assetId : undefined,
      },
    });
  }
  return out;
}

/** 0~3 범위의 키 번호인가. 남의 문서에서 온 값이라 정수인지까지 본다. */
function asKeyIndex(v: unknown): KeyIndex | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  return n >= 0 && n <= 3 ? (n as KeyIndex) : null;
}

/**
 * 조건 하나를 좁힌다. 모르거나 망가진 조건이면 null — 부르는 쪽이 비밀째 버린다.
 *
 * 순서 조건에서 **길이를 반드시 검사해야 한다.** 빈 배열이 통과하면 SecretTracker의
 * 대조가 아무 누름에나 맞아 첫 탭에 열리고, 너무 길면 아무도 못 연다. 둘 다 화면에는
 * "비밀 1개"로 똑같이 보인다.
 */
function coerceTrigger(raw: unknown): SecretTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;

  if (t.kind === 'pressCount') {
    const key = asKeyIndex(t.key);
    if (key === null || typeof t.count !== 'number') return null;
    return { kind: 'pressCount', key, count: clampSecretCount(t.count) };
  }

  if (t.kind === 'sequence') {
    if (!Array.isArray(t.keys)) return null;
    const keys: KeyIndex[] = [];
    for (const k of t.keys) {
      const key = asKeyIndex(k);
      // 하나라도 알 수 없는 키면 순서가 통째로 어긋난다. 조용히 빼면 안 된다.
      if (key === null) return null;
      keys.push(key);
    }
    if (keys.length < SECRET_SEQUENCE_MIN || keys.length > SECRET_SEQUENCE_MAX) return null;
    return { kind: 'sequence', keys };
  }

  return null;
}

function coerceTempo(raw: unknown): Tempo {
  const o = (raw ?? {}) as Record<string, unknown>;
  const preset = pick(['slow', 'normal', 'fast'] as const, o.preset, 'normal') as TempoPreset;
  return { preset, bpm: TEMPO_BPM[preset] };
}

function coerceAssets(raw: unknown): AssetRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AssetRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (typeof a.id !== 'string') continue;
    const kind = a.kind === 'sound' ? 'sound' : 'art';
    out.push({
      id: a.id,
      kind,
      mimeType: kind === 'sound' ? 'audio/wav' : 'image/png',
      size: typeof a.size === 'number' ? a.size : 0,
      hash: typeof a.hash === 'string' ? a.hash : '',
      durationMs: typeof a.durationMs === 'number' ? a.durationMs : undefined,
      // 사진 유래 태그는 반드시 살아남아야 한다. 여기서 흘리면 저장/불러오기 한 번에
      // 공유 차단이 풀린다 — 이 파서는 "모르는 필드는 버린다"가 기본이라 더 위험하다.
      source: a.source === 'photo' ? 'photo' : undefined,
      localKey: typeof a.localKey === 'string' ? a.localKey : undefined,
      remotePath: typeof a.remotePath === 'string' ? a.remotePath : undefined,
    });
  }
  return out;
}

function coerceReplay(raw: unknown, tempo: Tempo): Replay {
  const o = (raw ?? {}) as Record<string, unknown>;
  const events: ReplayEvent[] = Array.isArray(o.events)
    ? (o.events as unknown[])
        .map((e) => coerceEvent(e))
        .filter((e): e is ReplayEvent => e !== null)
    : [];
  return {
    seed: typeof o.seed === 'number' && Number.isFinite(o.seed) ? o.seed >>> 0 : newSeed(),
    durationMs: durationForTempo(tempo),
    events,
  };
}

function coerceEvent(raw: unknown): ReplayEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.t !== 'number' || typeof o.key !== 'number') return null;
  if (o.key < 0 || o.key > 3) return null;
  if (typeof o.type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(o.type)) {
    return null;
  }
  return {
    i: typeof o.i === 'number' ? o.i : 0,
    t: o.t,
    type: o.type as ReplayEvent['type'],
    key: Math.trunc(o.key) as KeyIndex,
  };
}

function coerceKey(raw: unknown, idx: KeyIndex): KeyDef {
  const fallback = createDefaultKey(idx);
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const appearance = (o.appearance ?? {}) as Record<string, unknown>;
  const sound = (o.sound ?? {}) as Record<string, unknown>;
  const loop = (o.loop ?? {}) as Record<string, unknown>;
  const trace = (o.trace ?? {}) as Record<string, unknown>;

  return {
    idx,
    appearance: {
      baseColor:
        typeof appearance.baseColor === 'string'
          ? appearance.baseColor
          : fallback.appearance.baseColor,
      artAssetId:
        typeof appearance.artAssetId === 'string' ? appearance.artAssetId : null,
      face: pick(FACES, appearance.face, 'none'),
    },
    material: pick(MATERIALS, o.material, 'plastic'),
    sound: {
      assetId: typeof sound.assetId === 'string' ? sound.assetId : null,
      presetId:
        typeof sound.presetId === 'string'
          ? sound.presetId
          : sound.assetId
            ? null
            : fallback.sound.presetId,
      pitch: typeof sound.pitch === 'number' ? sound.pitch : 1,
      gain: typeof sound.gain === 'number' ? sound.gain : 0.9,
    },
    motion: pick(MOTIONS, o.motion, fallback.motion),
    led: pick(LEDS, o.led, fallback.led),
    loop: {
      enabled: loop.enabled === true,
      everyBeats: ([1, 2, 4, 8] as const).includes(loop.everyBeats as never)
        ? (loop.everyBeats as KeyDef['loop']['everyBeats'])
        : 2,
      offsetBeats: ([0, 1, 2, 3] as const).includes(loop.offsetBeats as never)
        ? (loop.offsetBeats as KeyDef['loop']['offsetBeats'])
        : 0,
    },
    haptic: pick(HAPTICS, o.haptic, fallback.haptic),
    trace: {
      type: pick(TRACES, trace.type, 'none'),
      color: typeof trace.color === 'string' ? trace.color : '#FFFFFF',
      // v2.5 이전 문서에는 없는 필드다. 없으면 v1.6이 하던 그대로 — 찍히고 사라진다.
      behavior: pick(TRACE_BEHAVIORS, trace.behavior, 'fade'),
      assetId: typeof trace.assetId === 'string' ? trace.assetId : null,
    },
  };
}

/**
 * v1 → v2 마이그레이션.
 *
 * v1은 Tap[]만 있고 keyUp도 loop 토글도 없다.
 * 각 탭을 keyDown 하나로 옮기고, loop.on은 초기 상태로 그대로 살린다.
 * 완전히 같은 소리가 나지는 않지만(그때는 루프 토글이 없었으므로 그럴 필요도 없다),
 * 작품이 사라지지는 않는다.
 */
export function migrateV1ToV2(v1: Record<string, unknown>): Record<string, unknown> {
  const bpm = typeof v1.bpm === 'number' ? v1.bpm : 100;
  const preset: TempoPreset = bpm <= 90 ? 'slow' : bpm >= 115 ? 'fast' : 'normal';

  const taps = Array.isArray(v1.performance) ? (v1.performance as Record<string, unknown>[]) : [];
  const events = taps
    .filter((t) => typeof t.t === 'number' && typeof t.k === 'number')
    .map((t, i) => ({ i, t: t.t as number, type: 'keyDown', key: t.k as number }));

  const assets: Record<string, unknown>[] = [];
  const keys = (Array.isArray(v1.keys) ? v1.keys : []).map((raw, idx) => {
    const k = (raw ?? {}) as Record<string, unknown>;
    const oldSound = (k.sound ?? {}) as Record<string, unknown>;
    const oldSrc = typeof oldSound.src === 'string' ? oldSound.src : 'preset:tok';

    // v1은 경로를 직접 참조했다. 경로를 자산으로 승격시킨다.
    let soundAssetId: string | null = null;
    let presetId: string | null = null;
    if (oldSrc.startsWith('preset:')) {
      presetId = `${oldSrc.slice('preset:'.length)}@1`;
    } else {
      soundAssetId = `v1s${idx}`;
      assets.push({
        id: soundAssetId,
        kind: 'sound',
        mimeType: 'audio/wav',
        size: 0,
        hash: '',
        localKey: oldSrc,
      });
    }

    let artAssetId: string | null = null;
    if (typeof k.artPath === 'string') {
      artAssetId = `v1a${idx}`;
      assets.push({
        id: artAssetId,
        kind: 'art',
        mimeType: 'image/png',
        size: 0,
        hash: '',
        localKey: k.artPath,
      });
    }

    const oldLoop = (k.loop ?? {}) as Record<string, unknown>;
    const oldMotion = typeof k.motion === 'string' ? k.motion : 'squish';
    const oldLed = typeof k.led === 'string' ? k.led : 'flash';

    return {
      idx,
      appearance: { baseColor: k.baseColor, artAssetId, face: 'none' },
      material: 'plastic',
      sound: {
        assetId: soundAssetId,
        presetId,
        pitch: oldSound.pitch,
        gain: oldSound.gain,
      },
      motion: `${oldMotion}@1`,
      led: oldLed === 'none' ? 'none' : `${oldLed}@1`,
      loop: {
        enabled: oldLoop.on === true,
        everyBeats: oldLoop.everyBeats,
        offsetBeats: oldLoop.offsetBeats,
      },
      haptic: k.haptic,
      trace: { type: 'none', color: '#FFFFFF', behavior: 'fade', assetId: null },
    };
  });

  return {
    ...v1,
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    presetVersion: PRESET_VERSION,
    tempo: { preset, bpm: TEMPO_BPM[preset] },
    keys,
    assets,
    replay: { seed: newSeed(), durationMs: 0, events },
    secrets: [],
    visibility: v1.visibility === 'link' ? 'link' : 'local',
  };
}

/** 용량 견적(완료 정의: 작품 1개 총용량 250KB 이하). */
export function metaBytes(work: Work): number {
  return new TextEncoder().encode(serializeWork(work)).length;
}
