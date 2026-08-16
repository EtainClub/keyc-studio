/**
 * 비밀 숨기기 시트.
 *
 * 두 단계다. 목록에서 비밀 전체를 한눈에 보고, 하나를 골라 들어가 고친다.
 * 한 화면에 다 펼치지 않는 이유: 비밀 하나에 그림 캔버스나 녹음판이 들어가는데,
 * 셋을 동시에 펼치면 스크롤만 남고 "몇 개 숨겼는지"가 안 보인다.
 *
 * 편집 시트가 아니라 무대 화면에 붙는 이유는 로드맵의 제작 순서다 —
 * ①키캡 ②무대 ③반복 **④비밀** ⑤공연. 비밀은 키 하나의 장식이 아니라
 * 작품 전체에 몇 개를 숨겼는가의 문제다.
 *
 * 정답은 여기서만 보인다. 감상 화면은 개수만 알려준다.
 */

import { useRef, useState, type RefObject } from 'react';
import type { KeycapEngine } from '../../audio-engine/engine';
import { assetSoundKey } from '../../audio-engine/sound-bank';
import type { EncodedSound } from '../../audio-engine/wav';
import { t } from '../../i18n';
import { newAssetId, newSecretId } from '../../work-model/defaults';
import {
  SECRETS_MAX,
  SECRET_SEQUENCE_MAX,
  SECRET_SEQUENCE_MIN,
  revealNeedsAsset,
  type AssetRef,
  type KeyDef,
  type KeyIndex,
  type Secret,
  type SecretRevealKind,
  type SecretTrigger,
} from '../../work-model/types';
import { invalidateAsset } from '../../storage/assets';
import { hashBlob, putAssetBlob } from '../../storage/db';
import { useAssetUrl, useModalShell } from '../hooks';
import { DrawCanvas, type DrawCanvasHandle } from './DrawCanvas';
import { RecordPanel } from './RecordPanel';

/** 아이에게 내놓는 횟수. SECRET_COUNT_MIN~MAX 안에서 고른 네 개다. */
const COUNTS = [3, 5, 7, 10];

/**
 * 조건 두 가지.
 *
 * "몇 번 누르면"이 먼저인 것은 그쪽이 만들기 쉬워서다 — 칩 두 번이면 끝난다.
 * 순서 조건은 키를 차례로 찍어 넣어야 하므로 손이 더 간다.
 */
const TRIGGERS: { kind: SecretTrigger['kind']; label: string; emoji: string }[] = [
  { kind: 'pressCount', label: t('secret.trigger.pressCount'), emoji: '🔢' },
  { kind: 'sequence', label: t('secret.trigger.sequence'), emoji: '🔀' },
];

const REVEALS: { kind: SecretRevealKind; label: string; emoji: string }[] = [
  { kind: 'art', label: t('secret.reveal.art'), emoji: '🖼️' },
  { kind: 'sound', label: t('secret.reveal.sound'), emoji: '🔊' },
  { kind: 'led', label: t('secret.reveal.led'), emoji: '💥' },
  { kind: 'finale', label: t('secret.reveal.finale'), emoji: '🎆' },
];

function revealLabel(kind: SecretRevealKind): string {
  return REVEALS.find((r) => r.kind === kind)?.label ?? kind;
}

/** 자산이 있어야 하는 결과인데 아직 없다 — 지금 공유하면 열리지 않는 비밀이 된다. */
function isIncomplete(secret: Secret, assets: readonly AssetRef[]): boolean {
  if (!revealNeedsAsset(secret.reveal.kind)) return false;
  return !assets.some((a) => a.id === secret.reveal.assetId);
}

/** 목록 한 줄에 조건을 한 문장으로. 정답은 여기서만 보인다. */
function triggerSummary(trigger: SecretTrigger): string {
  if (trigger.kind === 'pressCount') {
    return t('secret.rowSummary', { key: trigger.key + 1, count: trigger.count });
  }
  return t('secret.rowSequence', { keys: trigger.keys.map((k) => k + 1).join(' → ') });
}

/** 목록의 색 점이 가리킬 키. 순서 조건이면 첫 키다. */
function triggerKey(trigger: SecretTrigger): KeyIndex {
  return trigger.kind === 'pressCount' ? trigger.key : (trigger.keys[0] ?? 0);
}

type Props = {
  workId: string;
  keys: readonly KeyDef[];
  secrets: readonly Secret[];
  assets: readonly AssetRef[];
  engine: KeycapEngine;
  onPatchSecrets: (next: Secret[]) => void;
  onAddAsset: (asset: AssetRef) => void;
  onClose: () => void;
};

export function SecretSheet({
  workId,
  keys,
  secrets,
  assets,
  engine,
  onPatchSecrets,
  onAddAsset,
  onClose,
}: Props) {
  const sheetRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<number | null>(null);

  /**
   * 그림은 저장 버튼 없이 자동으로 붙는다 — 편집 시트와 같은 규칙이다.
   * 아이가 열심히 그린 뒤 저장을 못 찾아 잃는 것이 이 화면에서 가장 아픈 실패다.
   */
  const saveArt = useRef<(() => Promise<void>) | null>(null);

  const flushArt = async () => {
    await saveArt.current?.();
  };

  const backToList = async () => {
    await flushArt();
    saveArt.current = null;
    setEditing(null);
  };

  const close = async () => {
    await flushArt();
    onClose();
  };

  useModalShell(sheetRef, () => void close());

  const patchAt = (i: number, patch: Partial<Secret>) => {
    onPatchSecrets(secrets.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  };

  const addSecret = () => {
    if (secrets.length >= SECRETS_MAX) return;
    const next: Secret = {
      id: newSecretId(),
      trigger: { kind: 'pressCount', key: 0, count: 5 },
      // 기본값은 빛 폭발이다 — 자산이 필요 없어서, 만들자마자 이미 완성된 비밀이다.
      reveal: { kind: 'led' },
    };
    onPatchSecrets([...secrets, next]);
    setEditing(secrets.length);
  };

  const removeAt = (i: number) => {
    onPatchSecrets(secrets.filter((_, n) => n !== i));
    setEditing(null);
  };

  const current = editing !== null ? secrets[editing] : null;

  return (
    <div className="sheet-backdrop" onClick={() => void close()}>
      <section
        ref={sheetRef}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('secret.aria')}
      >
        <header className="sheet-head">
          {current ? (
            <button type="button" className="bar-back" onClick={() => void backToList()}>
              {t('secret.backToList')}
            </button>
          ) : (
            <span className="sheet-title">{t('secret.title')}</span>
          )}
          <button
            type="button"
            className="sheet-close"
            onClick={() => void close()}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </header>

        <div className="sheet-body">
          {current && editing !== null ? (
            <SecretEditor
              workId={workId}
              keys={keys}
              secret={current}
              assets={assets}
              engine={engine}
              onPatch={(patch) => patchAt(editing, patch)}
              onAddAsset={onAddAsset}
              onRemove={() => removeAt(editing)}
              index={editing}
              saveRef={saveArt}
            />
          ) : (
            <SecretList
              keys={keys}
              secrets={secrets}
              assets={assets}
              onOpen={setEditing}
              onAdd={addSecret}
              onRemove={removeAt}
            />
          )}
        </div>

        <button type="button" className="sheet-done" onClick={() => void close()}>
          {t('edit.done')}
        </button>
      </section>
    </div>
  );
}

/* ── 목록 ─────────────────────────────────────────────── */

function SecretList({
  keys,
  secrets,
  assets,
  onOpen,
  onAdd,
  onRemove,
}: {
  keys: readonly KeyDef[];
  secrets: readonly Secret[];
  assets: readonly AssetRef[];
  onOpen: (i: number) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="secret-list">
      {secrets.length === 0 && <p className="note">{t('secret.empty')}</p>}

      {secrets.map((s, i) => (
        <div className="secret-row" key={s.id}>
          <button
            type="button"
            className="secret-row-main"
            aria-label={t('secret.rowAria', { n: i + 1 })}
            onClick={() => onOpen(i)}
          >
            <span
              className="secret-dot"
              style={{ background: keys[triggerKey(s.trigger)]?.appearance.baseColor }}
              aria-hidden
            />
            <span className="secret-row-text">
              <span className="secret-row-when">{triggerSummary(s.trigger)}</span>
              <span className="secret-row-what">→ {revealLabel(s.reveal.kind)}</span>
            </span>
            {/* 미완성 표식. 공유 전에 알아야 "열리지 않는 비밀"을 안 내보낸다. */}
            {isIncomplete(s, assets) && (
              <span className="secret-warn" aria-hidden>
                !
              </span>
            )}
          </button>
          <button
            type="button"
            className="chip secret-remove"
            aria-label={t('secret.removeAria', { n: i + 1 })}
            onClick={() => onRemove(i)}
          >
            {t('secret.remove')}
          </button>
        </div>
      ))}

      {secrets.length < SECRETS_MAX ? (
        <button type="button" className="chip big secret-add" onClick={onAdd}>
          {t('secret.add')}
        </button>
      ) : (
        <p className="note">{t('secret.full', { max: SECRETS_MAX })}</p>
      )}

      {secrets.length > 0 && <p className="note">{t('secret.tryHint')}</p>}
    </div>
  );
}

/* ── 비밀 하나 ────────────────────────────────────────── */

function SecretEditor({
  workId,
  keys,
  secret,
  assets,
  engine,
  onPatch,
  onAddAsset,
  onRemove,
  index,
  saveRef,
}: {
  workId: string;
  keys: readonly KeyDef[];
  secret: Secret;
  assets: readonly AssetRef[];
  engine: KeycapEngine;
  onPatch: (patch: Partial<Secret>) => void;
  onAddAsset: (asset: AssetRef) => void;
  onRemove: () => void;
  index: number;
  saveRef: RefObject<(() => Promise<void>) | null>;
}) {
  const canvasRef = useRef<DrawCanvasHandle>(null);
  const existingArt = useAssetUrl(secret.reveal.kind === 'art' ? (secret.reveal.assetId ?? null) : null);

  const trigger = secret.trigger;

  /**
   * 조건 종류를 바꾼다.
   *
   * 두 조건은 담는 값이 아예 달라(키 하나+횟수 / 키 목록) 섞을 수가 없다.
   * 그래서 갈아끼울 때 **각자의 기본값으로 새로 만든다.** 순서의 기본값을
   * 비워 두지 않고 두 키로 채우는 이유: 빈 순서는 아무 누름에나 열리는 비밀이라
   * 잠깐이라도 그 상태가 존재하면 안 된다.
   */
  const setTriggerKind = (kind: SecretTrigger['kind']) => {
    if (kind === trigger.kind) return;
    onPatch({
      trigger:
        kind === 'pressCount'
          ? { kind: 'pressCount', key: triggerKey(trigger), count: 5 }
          : { kind: 'sequence', keys: [0, 1] },
    });
  };

  const setCountTrigger = (patch: { key?: KeyIndex; count?: number }) => {
    if (trigger.kind !== 'pressCount') return;
    onPatch({ trigger: { ...trigger, ...patch } });
  };

  const setSequence = (keys: KeyIndex[]) => {
    onPatch({ trigger: { kind: 'sequence', keys } });
  };

  const setReveal = (kind: SecretRevealKind) => {
    // 결과 종류를 바꾸면 앞의 자산은 떼어낸다. 그림에 소리 id가 붙어 있으면 안 열린다.
    onPatch({ reveal: kind === secret.reveal.kind ? secret.reveal : { kind } });
  };

  /*
   * 그림 자동 저장. 뒤로 가거나 시트를 닫을 때 부모가 부른다.
   * 그림 결과일 때만 등록한다 — 다른 결과로 바꿔 놓고 캔버스가 사라진 뒤에는
   * 저장할 것도 없다.
   */
  saveRef.current =
    secret.reveal.kind === 'art'
      ? async () => {
          const result = await canvasRef.current?.export();
          if (!result) {
            if (secret.reveal.assetId) {
              invalidateAsset(secret.reveal.assetId);
              onPatch({ reveal: { kind: 'art' } });
            }
            return;
          }
          const id = newAssetId();
          const localKey = await putAssetBlob(workId, id, result.blob);
          onAddAsset({
            id,
            kind: 'art',
            mimeType: 'image/png',
            size: result.blob.size,
            hash: await hashBlob(result.blob),
            source: result.fromPhoto ? 'photo' : 'draw',
            localKey,
          });
          onPatch({ reveal: { kind: 'art', assetId: id } });
        }
      : null;

  const acceptRecording = async (sound: EncodedSound) => {
    const id = newAssetId();
    const localKey = await putAssetBlob(workId, id, sound.blob);
    onAddAsset({
      id,
      kind: 'sound',
      mimeType: 'audio/wav',
      size: sound.blob.size,
      hash: await hashBlob(sound.blob),
      durationMs: Math.round(sound.durationSec * 1000),
      localKey,
    });
    // 방금 녹음한 버퍼를 바로 캐시한다. 비밀이 열리는 순간에 로딩이 있으면 안 된다.
    const buffer = await engine.audioContext.decodeAudioData(await sound.blob.arrayBuffer());
    engine.bank.put(assetSoundKey(id), buffer);
    onPatch({ reveal: { kind: 'sound', assetId: id } });
  };

  const previewBlob = async (blob: Blob) => {
    const buf = await engine.audioContext.decodeAudioData(await blob.arrayBuffer());
    // 비밀 소리는 녹음 그대로 들려준다 — 키처럼 높낮이·크기를 만질 데가 없다.
    engine.previewBuffer({ sound: { assetId: null, presetId: null, pitch: 1, gain: 1 } }, buf);
  };

  return (
    <div className="secret-editor">
      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🕵️</span> {t('secret.whenLabel')}
        </h3>
        <div className="chip-grid">
          {TRIGGERS.map((tr) => (
            <button
              key={tr.kind}
              type="button"
              className={`chip ${trigger.kind === tr.kind ? 'on' : ''}`}
              onClick={() => setTriggerKind(tr.kind)}
            >
              <span aria-hidden>{tr.emoji}</span> {tr.label}
            </button>
          ))}
        </div>
      </section>

      {trigger.kind === 'pressCount' ? (
        <>
          <section className="sheet-field">
            <h3 className="sheet-field-head">
              <span aria-hidden>👆</span> {t('secret.whichKey')}
            </h3>
            <div className="cap-colors" role="group" aria-label={t('secret.whichKey')}>
              {keys.map((k) => (
                <button
                  key={k.idx}
                  type="button"
                  className={`cap-swatch ${trigger.key === k.idx ? 'on' : ''}`}
                  style={{ background: k.appearance.baseColor }}
                  aria-label={t('secret.keyAria', { n: k.idx + 1 })}
                  aria-pressed={trigger.key === k.idx}
                  onClick={() => setCountTrigger({ key: k.idx as KeyIndex })}
                />
              ))}
            </div>
          </section>

          <section className="sheet-field">
            <h3 className="sheet-field-head">
              <span aria-hidden>🔢</span> {t('secret.howMany')}
            </h3>
            <div className="chip-grid">
              {COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`chip ${trigger.count === n ? 'on' : ''}`}
                  onClick={() => setCountTrigger({ count: n })}
                >
                  {t('secret.times', { n })}
                </button>
              ))}
            </div>
          </section>
        </>
      ) : (
        <SequenceField keys={keys} sequence={trigger.keys} onChange={setSequence} />
      )}

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🤫</span> {t('secret.whatHappens')}
        </h3>
        <div className="chip-grid">
          {REVEALS.map((r) => (
            <button
              key={r.kind}
              type="button"
              className={`chip ${secret.reveal.kind === r.kind ? 'on' : ''}`}
              onClick={() => setReveal(r.kind)}
            >
              <span aria-hidden>{r.emoji}</span> {r.label}
            </button>
          ))}
        </div>
      </section>

      {secret.reveal.kind === 'art' && (
        <section className="sheet-field">
          <DrawCanvas ref={canvasRef} initialUrl={existingArt} capColor="#2b1f52" />
          <p className="note">{t('secret.drawHint')}</p>
        </section>
      )}

      {secret.reveal.kind === 'sound' && (
        <section className="sheet-field">
          <RecordPanel onAccept={acceptRecording} onPreview={previewBlob} />
          <p className="note">{t('secret.recordHint')}</p>
        </section>
      )}

      {isIncomplete(secret, assets) && (
        <p className="warn">
          {secret.reveal.kind === 'art' ? t('secret.needArt') : t('secret.needSound')}
        </p>
      )}

      <button
        type="button"
        className="chip secret-remove"
        aria-label={t('secret.removeAria', { n: index + 1 })}
        onClick={onRemove}
      >
        {t('secret.remove')}
      </button>
    </div>
  );
}

/* ── 순서 만들기 ──────────────────────────────────────── */

/**
 * 누를 차례를 만드는 칸.
 *
 * 만드는 방법이 **비밀을 여는 방법과 같다** — 키캡을 차례로 누르면 그 순서가
 * 그대로 조건이 된다. 목록에서 항목을 고르고 위아래로 옮기는 편집기를 두지 않은
 * 이유가 이것이다. 아이는 "탄지로 다음 네즈코"를 만들려고 탄지로와 네즈코를
 * 차례로 누르면 되고, 그게 나중에 그 비밀을 여는 동작 그 자체다.
 *
 * 되돌리기는 **마지막 하나 지우기**뿐이다. 순서 중간을 고치는 일은 드물고,
 * 그걸 위해 각 칸에 삭제 버튼을 달면 다섯 칸짜리 줄이 아이 손가락에 너무 좁아진다.
 */
function SequenceField({
  keys,
  sequence,
  onChange,
}: {
  keys: readonly KeyDef[];
  sequence: readonly KeyIndex[];
  onChange: (keys: KeyIndex[]) => void;
}) {
  const full = sequence.length >= SECRET_SEQUENCE_MAX;
  const tooShort = sequence.length < SECRET_SEQUENCE_MIN;

  return (
    <section className="sheet-field">
      <h3 className="sheet-field-head">
        <span aria-hidden>🔀</span> {t('secret.sequenceLabel')}
      </h3>

      {/* 지금까지 만든 순서. 아이가 만든 것을 그대로 되비춰 준다. */}
      <div className="secret-seq" aria-label={t('secret.sequenceLabel')}>
        {sequence.length === 0 ? (
          <span className="secret-seq-empty">{t('secret.sequenceEmpty')}</span>
        ) : (
          sequence.map((k, i) => (
            <span className="secret-seq-step" key={`${k}-${i}`}>
              <span
                className="secret-seq-dot"
                style={{ background: keys[k]?.appearance.baseColor }}
              >
                {i + 1}
              </span>
              {i < sequence.length - 1 && (
                <span className="secret-seq-arrow" aria-hidden>
                  →
                </span>
              )}
            </span>
          ))
        )}
      </div>

      <p className="note">{t('secret.sequenceHint')}</p>

      <div className="cap-colors" role="group" aria-label={t('secret.sequenceAdd')}>
        {keys.map((k) => (
          <button
            key={k.idx}
            type="button"
            className="cap-swatch"
            style={{ background: k.appearance.baseColor }}
            aria-label={t('secret.sequenceAddAria', { n: k.idx + 1 })}
            disabled={full}
            onClick={() => onChange([...sequence, k.idx])}
          />
        ))}
      </div>

      <div className="chip-grid">
        <button
          type="button"
          className="chip"
          disabled={sequence.length === 0}
          onClick={() => onChange(sequence.slice(0, -1))}
        >
          {t('secret.sequenceUndo')}
        </button>
        <button
          type="button"
          className="chip"
          disabled={sequence.length === 0}
          onClick={() => onChange([])}
        >
          {t('secret.sequenceClear')}
        </button>
      </div>

      {/*
       * 너무 짧으면 우연히 열리고, 꽉 차면 더 못 넣는다. 둘 다 지금 말해 줘야
       * 공유 직전에 처음 알게 되는 일이 없다.
       */}
      {tooShort && (
        <p className="note warn">{t('secret.sequenceTooShort', { min: SECRET_SEQUENCE_MIN })}</p>
      )}
      {full && <p className="note">{t('secret.sequenceFull', { max: SECRET_SEQUENCE_MAX })}</p>}
    </section>
  );
}
