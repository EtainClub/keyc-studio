/**
 * 편집 시트 — 탭 5개: 그림 / 소리 / 움직임 / 느낌 / 반복.
 *
 * 순서가 곧 UX 결정이다. 그림이 첫 탭이고 소리가 두 번째다.
 * 마이크 권한 팝업은 "내 목소리 녹음"을 누른 뒤에야 뜬다 —
 * 첫 화면에서 권한을 만나면 아이는 그냥 나가버린다.
 *
 * v2: 자산은 경로가 아니라 assetId로 참조된다. 새 그림·녹음은 새 AssetRef를 만든다.
 */

import { useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { KeycapEngine } from '../../audio-engine/engine';
import { assetSoundKey } from '../../audio-engine/sound-bank';
import type { EncodedSound } from '../../audio-engine/wav';
import {
  EFFECT_PRESETS,
  KEYCAP_PRESETS,
  playbackPresetId,
  type PresetInfo,
} from '../../work-model/presets';
import { newAssetId } from '../../work-model/defaults';
import type {
  AssetRef,
  EveryBeats,
  KeyDef,
  Led,
  Motion,
  OffsetBeats,
} from '../../work-model/types';
import { invalidateAsset } from '../../storage/assets';
import { hashBlob, putAssetBlob } from '../../storage/db';
import { isAdminEmail } from '../../storage/firebase';
import { t } from '../../i18n';
import { FEELS, HAPTIC_ORDER, LEDS, MOTIONS } from '../feel';
import { MATERIALS, materialPatch } from '../material';
import { PALETTE } from '../palette';
import { TRACES, TRACE_BEHAVIORS } from '../trace';
import { useAssetUrl, useModalShell } from '../hooks';
import { useAppState } from '../state';
import { CuteFace } from './Keycap';
import { DrawCanvas, type DrawCanvasHandle } from './DrawCanvas';
import { RecordPanel } from './RecordPanel';

type TabId = 'art' | 'sound' | 'motion' | 'feel' | 'loop';

const TABS: { id: TabId; label: string; emoji: string }[] = [
  { id: 'art', label: t('edit.tab.art'), emoji: '🎨' },
  { id: 'sound', label: t('edit.tab.sound'), emoji: '🔊' },
  { id: 'motion', label: t('edit.tab.motion'), emoji: '🤸' },
  { id: 'feel', label: t('edit.tab.feel'), emoji: '✋' },
  { id: 'loop', label: t('edit.tab.loop'), emoji: '🔁' },
];

/*
 * 키캡 본체 색과 흔적 색은 같은 목록(`ui/palette.ts`)이다. 이 파일에 따로 배열을
 * 두고 있었는데, 그 상태로 흔적에만 색을 더하면 두 목록이 조용히 갈라진다.
 */

type Props = {
  workId: string;
  keyDef: KeyDef;
  engine: KeycapEngine;
  onPatch: (patch: Partial<KeyDef>) => void;
  /** 새 자산을 작품에 등록한다. */
  onAddAsset: (asset: AssetRef) => void;
  /** 지금 붙어 있는 그림이 사진에서 딴 것인가. 이어 그려도 그 표식을 유지한다. */
  artFromPhoto?: boolean;
  onClose: () => void;
};

function demoStyle(keyDef: KeyDef): CSSProperties {
  return { ['--cap-color' as string]: keyDef.appearance.baseColor };
}

export function EditSheet({
  workId,
  keyDef,
  engine,
  onPatch,
  onAddAsset,
  artFromPhoto = false,
  onClose,
}: Props) {
  const [tab, setTab] = useState<TabId>('art');
  const sheetRef = useRef<HTMLElement>(null);

  /**
   * 그림은 "저장" 버튼 없이 자동으로 붙는다.
   * 아이가 열심히 그린 뒤 저장 버튼을 못 찾아 그림을 잃는 것이
   * 이 화면에서 가장 흔하고 가장 아픈 실패다.
   *
   * 그림판이 두 군데다 — 그림 탭의 키캡 그림과, 움직임 탭의 직접 그린 스탬프.
   * 둘을 한 ref로 합치면 탭을 옮길 때 남의 캔버스를 내보내게 된다.
   */
  const saveArt = useRef<(() => Promise<void>) | null>(null);
  const saveStamp = useRef<(() => Promise<void>) | null>(null);

  /** 지금 열려 있는 탭의 그림판만 내보낸다. 안 열린 탭의 클로저는 이미 낡았다. */
  const flushCanvas = async () => {
    if (tab === 'art') await saveArt.current?.();
    if (tab === 'motion') await saveStamp.current?.();
  };

  const close = async () => {
    await flushCanvas();
    onClose();
  };

  const goTab = async (next: TabId) => {
    await flushCanvas();
    setTab(next);
  };

  useModalShell(sheetRef, () => void close());

  return (
    <div className="sheet-backdrop" onClick={close}>
      <section
        ref={sheetRef}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('edit.aria', { n: keyDef.idx + 1 })}
      >
        <header className="sheet-head">
          <span className="sheet-title">{t('edit.title', { n: keyDef.idx + 1 })}</span>
          <button type="button" className="sheet-close" onClick={close} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <nav className="sheet-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`sheet-tab ${tab === t.id ? 'on' : ''}`}
              onClick={() => goTab(t.id)}
            >
              <span aria-hidden>{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="sheet-body">
          {tab === 'art' && (
            <ArtTab
              workId={workId}
              keyDef={keyDef}
              onPatch={onPatch}
              onAddAsset={onAddAsset}
              artFromPhoto={artFromPhoto}
              saveRef={saveArt}
            />
          )}
          {tab === 'sound' && (
            <SoundTab
              workId={workId}
              keyDef={keyDef}
              engine={engine}
              onPatch={onPatch}
              onAddAsset={onAddAsset}
            />
          )}
          {tab === 'motion' && (
            <MotionTab
              workId={workId}
              keyDef={keyDef}
              onPatch={onPatch}
              onAddAsset={onAddAsset}
              saveRef={saveStamp}
            />
          )}
          {tab === 'feel' && <FeelTab keyDef={keyDef} onPatch={onPatch} />}
          {tab === 'loop' && <LoopTab keyDef={keyDef} onPatch={onPatch} />}
        </div>

        <button type="button" className="sheet-done" onClick={close}>
          {t('edit.done')}
        </button>
      </section>
    </div>
  );
}

/* ── 그림 ─────────────────────────────────────────────── */

function ArtTab({
  workId,
  keyDef,
  onPatch,
  onAddAsset,
  artFromPhoto,
  saveRef,
}: {
  workId: string;
  keyDef: KeyDef;
  onPatch: (p: Partial<KeyDef>) => void;
  onAddAsset: (a: AssetRef) => void;
  artFromPhoto: boolean;
  saveRef: RefObject<(() => Promise<void>) | null>;
}) {
  const canvasRef = useRef<DrawCanvasHandle>(null);
  const existing = useAssetUrl(keyDef.appearance.artAssetId);
  const { account } = useAppState();
  // 사진에서 선 따기는 관리자 계정에서만 보인다. 저작권·초상권 판단이 사람 손을 타야 한다.
  const canTracePhoto = account.kind === 'google' && isAdminEmail(account.email);

  // 탭을 옮기거나 시트를 닫을 때 부모가 호출한다. 매 렌더마다 최신 클로저로 갱신.
  saveRef.current = async () => {
    const result = await canvasRef.current?.export();
    if (!result) {
      // 전부 지웠으면 그림도 떼어낸다.
      if (keyDef.appearance.artAssetId) {
        invalidateAsset(keyDef.appearance.artAssetId);
        onPatch({ appearance: { ...keyDef.appearance, artAssetId: null } });
      }
      return;
    }
    const { blob, fromPhoto } = result;
    // 같은 자리에 다시 그려도 새 id를 쓴다 — 캐시 무효화 실수를 원천 차단한다.
    const id = newAssetId();
    const localKey = await putAssetBlob(workId, id, blob);
    onAddAsset({
      id,
      kind: 'art',
      mimeType: 'image/png',
      size: blob.size,
      hash: await hashBlob(blob),
      // 공유 차단의 근거가 되는 태그다. 여기서 안 붙이면 뒤의 어떤 검사도 소용없다.
      source: fromPhoto ? 'photo' : 'draw',
      localKey,
    });
    onPatch({ appearance: { ...keyDef.appearance, artAssetId: id } });
  };

  return (
    <div className="tab-art">
      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span className="sheet-field-step" aria-hidden>1</span> {t('edit.step1')}
        </h3>
        <div className="cap-colors" role="group" aria-label={t('edit.capColorsAria')}>
          {PALETTE.map(({ c, label }) => (
            <button
              key={c}
              type="button"
              className={`cap-swatch ${keyDef.appearance.baseColor === c ? 'on' : ''}`}
              style={{ background: c }}
              aria-label={t('edit.capColorAria', { label })}
              aria-pressed={keyDef.appearance.baseColor === c}
              onClick={() => onPatch({ appearance: { ...keyDef.appearance, baseColor: c } })}
            />
          ))}
        </div>
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span className="sheet-field-step" aria-hidden>2</span> {t('edit.step2')}
        </h3>
        <DrawCanvas
          ref={canvasRef}
          initialUrl={existing}
          capColor={keyDef.appearance.baseColor}
          photoTraceEnabled={canTracePhoto}
          initialFromPhoto={artFromPhoto}
        />
        <p className="note">{t('edit.artNote')}</p>
      </section>
    </div>
  );
}

/* ── 소리 ─────────────────────────────────────────────── */

const PITCH_STEPS: { v: number; label: string }[] = [
  { v: 0.6, label: t('edit.pitch.veryLow') },
  { v: 0.8, label: t('edit.pitch.low') },
  { v: 1, label: t('edit.pitch.same') },
  { v: 1.35, label: t('edit.pitch.high') },
  { v: 1.8, label: t('edit.pitch.veryHigh') },
];

const GAIN_STEPS: { v: number; label: string }[] = [
  { v: 0.45, label: t('edit.gain.soft') },
  { v: 0.75, label: t('edit.gain.normal') },
  { v: 1, label: t('edit.gain.loud') },
];

function SoundTab({
  workId,
  keyDef,
  engine,
  onPatch,
  onAddAsset,
}: {
  workId: string;
  keyDef: KeyDef;
  engine: KeycapEngine;
  onPatch: (p: Partial<KeyDef>) => void;
  onAddAsset: (a: AssetRef) => void;
}) {
  const patchSound = (p: Partial<KeyDef['sound']>) => {
    const next = { ...keyDef.sound, ...p };
    onPatch({ sound: next });
    // 고른 즉시 들려준다 — 설명보다 한 번 들리는 게 빠르다.
    engine.previewKey({ ...keyDef, sound: next });
  };

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
    // 상태 렌더를 기다리지 않고 방금 녹음한 버퍼를 바로 캐시한다. 다음 화면의 첫 탭도
    // 동기적으로 이 버퍼를 꺼낼 수 있어야 한다.
    const buffer = await engine.audioContext.decodeAudioData(await sound.blob.arrayBuffer());
    engine.bank.put(assetSoundKey(id), buffer);
    patchSound({ assetId: id, presetId: null });
  };

  const previewBlob = async (blob: Blob) => {
    const buf = await engine.audioContext.decodeAudioData(await blob.arrayBuffer());
    engine.previewBuffer(keyDef, buf);
  };

  const presetButtons = (presets: PresetInfo[]) => (
    <div className="chip-grid">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={`chip ${playbackPresetId(keyDef.sound.presetId ?? '') === preset.id ? 'on' : ''}`}
          onClick={() => patchSound({ presetId: preset.id, assetId: null })}
        >
          <span aria-hidden>{preset.emoji}</span> {preset.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="tab-sound">
      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🎙️</span> {t('edit.recordOwn')}
        </h3>
        <RecordPanel onAccept={acceptRecording} onPreview={previewBlob} />
        {keyDef.sound.assetId && <p className="note">{t('edit.usingOwn')}</p>}
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>⌨️</span> {t('edit.realKeys')}
        </h3>
        <p className="note">{t('edit.realKeysNote')}</p>
        {presetButtons(KEYCAP_PRESETS)}
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>✨</span> {t('edit.effects')}
        </h3>
        {presetButtons(EFFECT_PRESETS)}
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🎵</span> {t('edit.pitchLabel')}
        </h3>
        <div className="chip-grid">
          {PITCH_STEPS.map((s) => (
            <button
              key={s.v}
              type="button"
              className={`chip ${Math.abs(keyDef.sound.pitch - s.v) < 0.01 ? 'on' : ''}`}
              onClick={() => patchSound({ pitch: s.v })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🔉</span> {t('edit.gainLabel')}
        </h3>
        <div className="chip-grid">
          {GAIN_STEPS.map((s) => (
            <button
              key={s.v}
              type="button"
              className={`chip ${Math.abs(keyDef.sound.gain - s.v) < 0.01 ? 'on' : ''}`}
              onClick={() => patchSound({ gain: s.v })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ── 움직임 ───────────────────────────────────────────── */

function MotionTab({
  workId,
  keyDef,
  onPatch,
  onAddAsset,
  saveRef,
}: {
  workId: string;
  keyDef: KeyDef;
  onPatch: (p: Partial<KeyDef>) => void;
  onAddAsset: (a: AssetRef) => void;
  saveRef: RefObject<(() => Promise<void>) | null>;
}) {
  const [demo, setDemo] = useState(0);
  const bump = () => setDemo((d) => d + 1);
  const patchTrace = (p: Partial<KeyDef['trace']>) => onPatch({ trace: { ...keyDef.trace, ...p } });

  return (
    <div className="tab-motion">
      <div className="demo-stage">
        <span key={demo} className="keycap-unit demo-unit" style={demoStyle(keyDef)}>
          <span className="keycap-housing" aria-hidden>
            <span className="housing-slot">
              <span className="switch-stem" />
              <span className="switch-contact left" />
              <span className="switch-contact right" />
            </span>
            <span className="housing-base" />
          </span>
          <span
            className={`keycap mat-${keyDef.material} motion-${keyDef.motion.split('@')[0]} led-${keyDef.led.split('@')[0]} is-firing`}
          >
            <span className="keycap-top">
              <CuteFace />
            </span>
            <span className="keycap-gloss" aria-hidden />
            <span className="keycap-led" aria-hidden />
          </span>
        </span>
      </div>

      {/*
       * 재질이 맨 위인 것은 그것이 **나머지를 정하는 선택**이기 때문이다.
       * 아래 칩들(움직임·빛)은 재질을 누르는 순간 함께 바뀌고, 아이는 그 변화를
       * 같은 화면에서 본다 — 무엇이 묶여 있는지 설명 없이 알게 하는 유일한 방법이다.
       */}
      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🧊</span> {t('edit.materialLabel')}
        </h3>
        <div className="chip-grid">
          {MATERIALS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip ${keyDef.material === m.id ? 'on' : ''}`}
              onClick={() => {
                onPatch(materialPatch(keyDef, m.id));
                bump();
              }}
            >
              <span aria-hidden>{m.emoji}</span> {m.label}
            </button>
          ))}
        </div>
        <p className="note">
          {keyDef.sound.assetId ? t('edit.materialNoteOwnSound') : t('edit.materialNote')}
        </p>
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🤸</span> {t('edit.motionLabel')}
        </h3>
        <div className="chip-grid">
          {MOTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip ${keyDef.motion === m.id ? 'on' : ''}`}
              onClick={() => {
                onPatch({ motion: m.id as Motion });
                bump();
              }}
            >
              <span aria-hidden>{m.emoji}</span> {m.label}
            </button>
          ))}
        </div>
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>💡</span> {t('edit.ledLabel')}
        </h3>
        <div className="chip-grid">
          {LEDS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`chip ${keyDef.led === l.id ? 'on' : ''}`}
              onClick={() => {
                onPatch({ led: l.id as Led });
                bump();
              }}
            >
              <span aria-hidden>{l.emoji}</span> {l.label}
            </button>
          ))}
        </div>
      </section>

      {/*
       * 흔적은 키캡이 아니라 **화면**에 남는 것이라 위의 데모 상자에서 보여줄 수 없다.
       * 시트를 닫고 한 번 누르는 게 유일한 미리보기다 — 그걸 note가 대신 설명한다.
       */}
      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🐾</span> {t('edit.traceLabel')}
        </h3>
        <div className="chip-grid">
          {TRACES.map((tr) => (
            <button
              key={tr.id}
              type="button"
              className={`chip ${keyDef.trace.type === tr.id ? 'on' : ''}`}
              onClick={() => patchTrace({ type: tr.id })}
            >
              <span aria-hidden>{tr.emoji}</span> {tr.label}
            </button>
          ))}
        </div>

        {/* 흔적을 끄면 나머지는 고를 이유가 없다. 쓸모없는 선택지를 치우면 그만큼 쉬워진다. */}
        {keyDef.trace.type !== 'none' && (
          <>
            <h4 className="sheet-field-sub">{t('edit.traceBehaviorLabel')}</h4>
            <div className="chip-grid">
              {TRACE_BEHAVIORS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`chip ${keyDef.trace.behavior === b.id ? 'on' : ''}`}
                  onClick={() => patchTrace({ behavior: b.id })}
                >
                  <span aria-hidden>{b.emoji}</span> {b.label}
                </button>
              ))}
            </div>

            {/*
             * 직접 그린 스탬프에는 색 고르기를 내놓지 않는다. 그림에 이미 아이가 고른
             * 색이 들어 있는데 그 위에 한 색을 덮어씌우면 그린 것을 지우는 셈이 된다.
             */}
            {keyDef.trace.type === 'myStamp@1' ? (
              <StampField
                workId={workId}
                keyDef={keyDef}
                onPatch={onPatch}
                onAddAsset={onAddAsset}
                saveRef={saveRef}
              />
            ) : (
              <div className="cap-colors" role="group" aria-label={t('edit.traceColorsAria')}>
                {PALETTE.map(({ c, label }) => (
                  <button
                    key={c}
                    type="button"
                    className={`cap-swatch ${keyDef.trace.color === c ? 'on' : ''}`}
                    style={{ background: c }}
                    aria-label={t('edit.traceColorAria', { label })}
                    aria-pressed={keyDef.trace.color === c}
                    onClick={() => patchTrace({ color: c })}
                  />
                ))}
              </div>
            )}

            <p className="note">{t(`edit.traceNote.${keyDef.trace.behavior}`)}</p>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * 직접 그린 스탬프의 그림판.
 *
 * ArtTab과 같은 규칙으로 **저장 버튼 없이** 붙는다 — 탭을 옮기거나 시트를 닫을 때
 * 부모가 saveRef를 호출한다. 아이가 열심히 그린 뒤 저장 버튼을 못 찾아 그림을
 * 잃는 것이 이 화면에서 가장 흔하고 가장 아픈 실패이기 때문이다.
 *
 * 바탕색이 키캡 색이 아니라 무대 배경색인 이유: 이 그림은 키캡 위가 아니라
 * **어두운 화면 위**에 찍힌다. 키캡 색을 깔아 두면 아이가 거기서는 잘 보이는 색으로
 * 그려 놓고, 정작 무대에서는 아무것도 안 보이는 일이 생긴다.
 */
function StampField({
  workId,
  keyDef,
  onPatch,
  onAddAsset,
  saveRef,
}: {
  workId: string;
  keyDef: KeyDef;
  onPatch: (p: Partial<KeyDef>) => void;
  onAddAsset: (a: AssetRef) => void;
  saveRef: RefObject<(() => Promise<void>) | null>;
}) {
  const canvasRef = useRef<DrawCanvasHandle>(null);
  const existing = useAssetUrl(keyDef.trace.assetId);

  // 매 렌더마다 최신 클로저로 갱신한다. 부모가 탭 전환·닫기 직전에 호출한다.
  saveRef.current = async () => {
    const result = await canvasRef.current?.export();
    if (!result) {
      // 전부 지웠으면 스탬프도 떼어낸다. 그림이 없으면 찍히지도 않는다.
      if (keyDef.trace.assetId) {
        invalidateAsset(keyDef.trace.assetId);
        onPatch({ trace: { ...keyDef.trace, assetId: null } });
      }
      return;
    }
    // 같은 자리에 다시 그려도 새 id를 쓴다 — 캐시 무효화 실수를 원천 차단한다.
    const id = newAssetId();
    const localKey = await putAssetBlob(workId, id, result.blob);
    onAddAsset({
      id,
      kind: 'art',
      mimeType: 'image/png',
      size: result.blob.size,
      hash: await hashBlob(result.blob),
      source: 'draw',
      localKey,
    });
    onPatch({ trace: { ...keyDef.trace, assetId: id } });
  };

  return (
    <div className="stamp-field">
      <DrawCanvas ref={canvasRef} initialUrl={existing} capColor="#FEF4F8" />
      <p className="note">{t('edit.stampHint')}</p>
      {!keyDef.trace.assetId && <p className="note warn">{t('edit.stampNeeded')}</p>}
    </div>
  );
}

/* ── 느낌 ─────────────────────────────────────────────── */

function FeelTab({ keyDef, onPatch }: { keyDef: KeyDef; onPatch: (p: Partial<KeyDef>) => void }) {
  const feel = FEELS[keyDef.haptic];
  return (
    <div className="tab-feel">
      <p className="note">{t('edit.feelNote')}</p>
      <div className="demo-stage">
        <button
          type="button"
          className="demo-slot"
          style={{
            ['--cap-color' as string]: keyDef.appearance.baseColor,
            ['--press-depth' as string]: `${feel.depth}px`,
            ['--press-scale' as string]: String(feel.scale),
            ['--rebound' as string]: `${feel.reboundMs}ms`,
            ['--rebound-ease' as string]: feel.easing,
          }}
          onPointerDown={(e) =>
            e.currentTarget.querySelector('.keycap')?.classList.add('is-pressed')
          }
          onPointerUp={(e) =>
            e.currentTarget.querySelector('.keycap')?.classList.remove('is-pressed')
          }
          onPointerLeave={(e) =>
            e.currentTarget.querySelector('.keycap')?.classList.remove('is-pressed')
          }
        >
          <span className="keycap-unit demo-unit">
            <span className="keycap-housing" aria-hidden>
              <span className="housing-slot">
                <span className="switch-stem" />
                <span className="switch-contact left" />
                <span className="switch-contact right" />
              </span>
              <span className="housing-base" />
            </span>
            <span className={`keycap mat-${keyDef.material}`}>
              <span className="keycap-top">
                <CuteFace />
              </span>
              <span className="keycap-gloss" aria-hidden />
              <span className="keycap-led" aria-hidden />
            </span>
          </span>
        </button>
      </div>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>✋</span> {t('edit.feelLabel')}
        </h3>
        <div className="chip-grid">
          {HAPTIC_ORDER.map((h) => (
            <button
              key={h}
              type="button"
              className={`chip ${keyDef.haptic === h ? 'on' : ''}`}
              onClick={() => onPatch({ haptic: h })}
            >
              <span aria-hidden>{FEELS[h].emoji}</span> {FEELS[h].label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ── 반복 ─────────────────────────────────────────────── */

const EVERY: { v: EveryBeats; label: string }[] = [
  { v: 1, label: t('edit.every.1') },
  { v: 2, label: t('edit.every.2') },
  { v: 4, label: t('edit.every.4') },
  { v: 8, label: t('edit.every.8') },
];

const OFFSET: { v: OffsetBeats; label: string }[] = [
  { v: 0, label: t('edit.offset.0') },
  { v: 1, label: t('edit.offset.1') },
  { v: 2, label: t('edit.offset.2') },
  { v: 3, label: t('edit.offset.3') },
];

function LoopTab({ keyDef, onPatch }: { keyDef: KeyDef; onPatch: (p: Partial<KeyDef>) => void }) {
  const patchLoop = (p: Partial<KeyDef['loop']>) => onPatch({ loop: { ...keyDef.loop, ...p } });

  return (
    <div className="tab-loop">
      <p className="note">
        {t('edit.loopNote')}
      </p>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>⏱️</span> {t('edit.everyLabel')}
        </h3>
        <div className="chip-grid">
          {EVERY.map((e) => (
            <button
              key={e.v}
              type="button"
              className={`chip ${keyDef.loop.everyBeats === e.v ? 'on' : ''}`}
              onClick={() => patchLoop({ everyBeats: e.v })}
            >
              {e.label}
            </button>
          ))}
        </div>
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🚦</span> {t('edit.offsetLabel')}
        </h3>
        <div className="chip-grid">
          {OFFSET.map((o) => (
            <button
              key={o.v}
              type="button"
              className={`chip ${keyDef.loop.offsetBeats === o.v ? 'on' : ''}`}
              onClick={() => patchLoop({ offsetBeats: o.v })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
