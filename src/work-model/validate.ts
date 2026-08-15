/**
 * 검증 + 정규화.
 *
 * Firestore 보안 규칙이 서버쪽 방어선이고, 여기는 클라이언트쪽 방어선이다.
 * 두 곳의 상한값(title 20 / hint 40 / events 600 / keys 4)은 항상 같아야 한다.
 */

import { t } from '../i18n';
import { durationForTempo } from './timing';
import {
  HINT_MAX,
  KEY_COUNT,
  REPLAY_EVENTS_MAX,
  SCHEMA_VERSION,
  SECRETS_MAX,
  SECRET_COUNT_MAX,
  SECRET_COUNT_MIN,
  TITLE_MAX,
  WORK_ID_LENGTH,
  type KeyDef,
  type Replay,
  type ReplayEvent,
  type Work,
} from './types';

export function clampPitch(v: number): number {
  return Math.min(2, Math.max(0.5, v));
}

export function clampGain(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 비밀을 여는 누름 횟수. 아이가 고르는 값이라 오류로 막지 않고 범위 안으로 당긴다. */
export function clampSecretCount(v: number): number {
  if (!Number.isFinite(v)) return SECRET_COUNT_MIN;
  return Math.min(SECRET_COUNT_MAX, Math.max(SECRET_COUNT_MIN, Math.round(v)));
}

/** 자소 단위가 아니라 코드포인트 기준으로 자른다(이모지 깨짐 방지). */
export function trimToLength(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

/**
 * 이벤트가 상한을 넘으면 시간순 앞에서부터 남긴다.
 * 잘린 뒤에도 keyDown/keyUp 짝과 loopOn/loopOff 짝이 깨지지 않도록
 * i를 다시 매기지 않는다 — i는 난수 유도에 쓰이므로 절대 재배치하면 안 된다.
 */
export function capEvents(events: ReplayEvent[], max = REPLAY_EVENTS_MAX): ReplayEvent[] {
  const sorted = [...events].sort((a, b) => a.t - b.t || a.i - b.i);
  return sorted.length <= max ? sorted : sorted.slice(0, max);
}

export type ValidationError = { field: string; message: string };

export function validateWork(work: Work): ValidationError[] {
  const errors: ValidationError[] = [];

  if (work.schemaVersion !== SCHEMA_VERSION) {
    errors.push({ field: 'schemaVersion', message: t('validate.schemaVersion') });
  }
  if (!work.id || work.id.length !== WORK_ID_LENGTH) {
    errors.push({ field: 'id', message: t('validate.id') });
  }
  if (Array.from(work.title).length > TITLE_MAX) {
    errors.push({ field: 'title', message: t('validate.title', { max: TITLE_MAX }) });
  }
  if (Array.from(work.hint).length > HINT_MAX) {
    errors.push({ field: 'hint', message: t('validate.hint', { max: HINT_MAX }) });
  }
  if (work.keys.length !== KEY_COUNT) {
    errors.push({ field: 'keys', message: t('validate.keyCount') });
  }
  if (work.replay.events.length > REPLAY_EVENTS_MAX) {
    errors.push({ field: 'replay.events', message: t('validate.eventsTooLong') });
  }
  if (!Number.isInteger(work.replay.seed) || work.replay.seed < 0) {
    errors.push({ field: 'replay.seed', message: t('validate.seed') });
  }
  if (work.replay.durationMs !== durationForTempo(work.tempo)) {
    // 템포를 바꾸고 길이를 안 고친 경우. 조용히 넘기면 리플레이가 어긋난다.
    errors.push({ field: 'replay.durationMs', message: t('validate.duration') });
  }

  work.keys.forEach((k, i) => {
    if (k.sound.pitch < 0.5 || k.sound.pitch > 2) {
      errors.push({ field: `keys[${i}].sound.pitch`, message: t('validate.pitch') });
    }
    if (k.sound.gain < 0 || k.sound.gain > 1) {
      errors.push({ field: `keys[${i}].sound.gain`, message: t('validate.gain') });
    }
    if (!k.sound.assetId && !k.sound.presetId) {
      errors.push({ field: `keys[${i}].sound`, message: t('validate.noSound') });
    }
    if (k.sound.assetId && !work.assets.some((a) => a.id === k.sound.assetId)) {
      errors.push({ field: `keys[${i}].sound.assetId`, message: t('validate.soundMissing') });
    }
    if (
      k.appearance.artAssetId &&
      !work.assets.some((a) => a.id === k.appearance.artAssetId)
    ) {
      errors.push({
        field: `keys[${i}].appearance.artAssetId`,
        message: t('validate.artMissing'),
      });
    }
  });

  if (work.secrets.length > SECRETS_MAX) {
    errors.push({ field: 'secrets', message: t('validate.secretsTooMany', { max: SECRETS_MAX }) });
  }

  work.secrets.forEach((s, i) => {
    if (s.trigger.count < SECRET_COUNT_MIN || s.trigger.count > SECRET_COUNT_MAX) {
      errors.push({ field: `secrets[${i}].trigger.count`, message: t('validate.secretCount') });
    }
    /*
     * 자산을 가리키는데 그 자산이 없으면 **눌러도 아무 일이 없는 비밀**이 된다.
     * 감상자에게는 "비밀 1개 있어요"라고 표시되므로, 있지도 않은 것을 영원히 찾는다.
     * 키의 소리·그림 누락과 같은 무게로 막는다.
     */
    if (s.reveal.kind !== 'led' && !work.assets.some((a) => a.id === s.reveal.assetId)) {
      errors.push({ field: `secrets[${i}].reveal.assetId`, message: t('validate.secretMissing') });
    }
  });

  return errors;
}

/** 저장 직전 정규화. 상한을 넘긴 값은 오류가 아니라 잘라서 통과시킨다. */
export function normalizeWork(work: Work): Work {
  const replay: Replay = {
    ...work.replay,
    durationMs: durationForTempo(work.tempo),
    events: capEvents(work.replay.events),
  };
  const secrets = work.secrets.slice(0, SECRETS_MAX).map((s) => ({
    ...s,
    trigger: { ...s.trigger, count: clampSecretCount(s.trigger.count) },
  }));
  const trimmed: Work = {
    ...work,
    title: trimToLength(work.title.trim(), TITLE_MAX),
    hint: trimToLength(work.hint.trim(), HINT_MAX),
    keys: work.keys.map((k) => normalizeKey(k)) as Work['keys'],
    replay,
    secrets,
  };
  return {
    ...trimmed,
    /*
     * 참조되지 않는 자산은 버린다 — 안 그러면 안 쓰는 녹음이 계속 업로드된다.
     * 원본이 아니라 **잘라낸 뒤의 작품**을 기준으로 본다. 상한을 넘겨 떨어져 나간
     * 비밀이 쓰던 자산까지 남으면 아무도 안 쓰는 파일이 계속 따라다닌다.
     */
    assets: trimmed.assets.filter((a) => isAssetReferenced(trimmed, a.id)),
  };
}

/**
 * 이 자산을 쓰는 데가 한 군데라도 있는가.
 *
 * **비밀이 쓰는 자산도 반드시 여기 포함되어야 한다.** normalizeWork가 이 판정으로
 * assets를 걸러내므로, 빠뜨리면 비밀에만 붙어 있는 그림·소리가 업로드 직전에
 * 조용히 삭제된다. 그러면 눌러도 아무 일이 없는 비밀이 남는다.
 */
export function isAssetReferenced(work: Work, assetId: string): boolean {
  return (
    work.keys.some((k) => k.sound.assetId === assetId || k.appearance.artAssetId === assetId) ||
    work.secrets.some((s) => s.reveal.assetId === assetId)
  );
}

export function normalizeKey(key: KeyDef): KeyDef {
  return {
    ...key,
    sound: {
      ...key.sound,
      pitch: clampPitch(key.sound.pitch),
      gain: clampGain(key.sound.gain),
    },
  };
}
