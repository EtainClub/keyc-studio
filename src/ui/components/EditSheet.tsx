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
import { DEFAULT_COLORS, newAssetId } from '../../work-model/defaults';
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
import { FEELS, HAPTIC_ORDER, LEDS, MOTIONS } from '../feel';
import { useAssetUrl, useModalShell } from '../hooks';
import { useAppState } from '../state';
import { CuteFace } from './Keycap';
import { DrawCanvas, type DrawCanvasHandle } from './DrawCanvas';
import { RecordPanel } from './RecordPanel';

type TabId = 'art' | 'sound' | 'motion' | 'feel' | 'loop';

const TABS: { id: TabId; label: string; emoji: string }[] = [
  { id: 'art', label: '그림', emoji: '🎨' },
  { id: 'sound', label: '소리', emoji: '🔊' },
  { id: 'motion', label: '움직임', emoji: '🤸' },
  { id: 'feel', label: '느낌', emoji: '✋' },
  { id: 'loop', label: '반복', emoji: '🔁' },
];

/** 키캡 본체 색. 그림 색과 헷갈리지 않게 이 탭에서만 쓰는 별도 목록이다. */
const CAP_COLORS: { c: string; label: string }[] = [
  { c: DEFAULT_COLORS[0], label: '분홍' },
  { c: DEFAULT_COLORS[1], label: '노랑' },
  { c: DEFAULT_COLORS[2], label: '초록' },
  { c: DEFAULT_COLORS[3], label: '파랑' },
  { c: '#FFFFFF', label: '하양' },
  { c: '#B98CFF', label: '보라' },
];

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
   */
  const saveArt = useRef<(() => Promise<void>) | null>(null);

  const flushArt = async () => {
    if (tab === 'art') await saveArt.current?.();
  };

  const close = async () => {
    await flushArt();
    onClose();
  };

  const goTab = async (next: TabId) => {
    await flushArt();
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
        aria-label={`키캡 ${keyDef.idx + 1} 꾸미기`}
      >
        <header className="sheet-head">
          <span className="sheet-title">키캡 {keyDef.idx + 1} 꾸미기</span>
          <button type="button" className="sheet-close" onClick={close} aria-label="닫기">
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
          {tab === 'motion' && <MotionTab keyDef={keyDef} onPatch={onPatch} />}
          {tab === 'feel' && <FeelTab keyDef={keyDef} onPatch={onPatch} />}
          {tab === 'loop' && <LoopTab keyDef={keyDef} onPatch={onPatch} />}
        </div>

        <button type="button" className="sheet-done" onClick={close}>
          다 됐어요
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
          <span className="sheet-field-step" aria-hidden>1</span> 키캡 색을 골라요
        </h3>
        <div className="cap-colors" role="group" aria-label="키캡 색">
          {CAP_COLORS.map(({ c, label }) => (
            <button
              key={c}
              type="button"
              className={`cap-swatch ${keyDef.appearance.baseColor === c ? 'on' : ''}`}
              style={{ background: c }}
              aria-label={`키캡 색 ${label}`}
              aria-pressed={keyDef.appearance.baseColor === c}
              onClick={() => onPatch({ appearance: { ...keyDef.appearance, baseColor: c } })}
            />
          ))}
        </div>
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span className="sheet-field-step" aria-hidden>2</span> 키캡 위에 그림을 그려요
        </h3>
        <DrawCanvas
          ref={canvasRef}
          initialUrl={existing}
          capColor={keyDef.appearance.baseColor}
          photoTraceEnabled={canTracePhoto}
          initialFromPhoto={artFromPhoto}
        />
        <p className="note">그린 그림은 저절로 키캡에 붙어요.</p>
      </section>
    </div>
  );
}

/* ── 소리 ─────────────────────────────────────────────── */

const PITCH_STEPS: { v: number; label: string }[] = [
  { v: 0.6, label: '아주 낮게' },
  { v: 0.8, label: '낮게' },
  { v: 1, label: '그대로' },
  { v: 1.35, label: '높게' },
  { v: 1.8, label: '아주 높게' },
];

const GAIN_STEPS: { v: number; label: string }[] = [
  { v: 0.45, label: '작게' },
  { v: 0.75, label: '보통' },
  { v: 1, label: '크게' },
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
          <span aria-hidden>🎙️</span> 내 목소리로 만들기
        </h3>
        <RecordPanel onAccept={acceptRecording} onPreview={previewBlob} />
        {keyDef.sound.assetId && <p className="note">지금은 내가 녹음한 소리를 쓰고 있어요 🎙️</p>}
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>⌨️</span> 실제 녹음 타건음
        </h3>
        <p className="note">진짜 기계식 키보드를 한 번씩 눌러 녹음한 소리예요.</p>
        {presetButtons(KEYCAP_PRESETS)}
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>✨</span> 재미있는 효과음
        </h3>
        {presetButtons(EFFECT_PRESETS)}
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🎵</span> 높낮이
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
          <span aria-hidden>🔉</span> 소리 크기
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
  keyDef,
  onPatch,
}: {
  keyDef: KeyDef;
  onPatch: (p: Partial<KeyDef>) => void;
}) {
  const [demo, setDemo] = useState(0);
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
            className={`keycap motion-${keyDef.motion.split('@')[0]} led-${keyDef.led.split('@')[0]} is-firing`}
          >
            <span className="keycap-top">
              <CuteFace />
            </span>
            <span className="keycap-gloss" aria-hidden />
            <span className="keycap-led" aria-hidden />
          </span>
        </span>
      </div>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>🤸</span> 어떻게 움직일까요
        </h3>
        <div className="chip-grid">
          {MOTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip ${keyDef.motion === m.id ? 'on' : ''}`}
              onClick={() => {
                onPatch({ motion: m.id as Motion });
                setDemo((d) => d + 1);
              }}
            >
              <span aria-hidden>{m.emoji}</span> {m.label}
            </button>
          ))}
        </div>
      </section>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>💡</span> 빛
        </h3>
        <div className="chip-grid">
          {LEDS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`chip ${keyDef.led === l.id ? 'on' : ''}`}
              onClick={() => {
                onPatch({ led: l.id as Led });
                setDemo((d) => d + 1);
              }}
            >
              <span aria-hidden>{l.emoji}</span> {l.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ── 느낌 ─────────────────────────────────────────────── */

function FeelTab({ keyDef, onPatch }: { keyDef: KeyDef; onPatch: (p: Partial<KeyDef>) => void }) {
  const feel = FEELS[keyDef.haptic];
  return (
    <div className="tab-feel">
      <p className="note">눌러보면 느낌이 달라요. 눌리는 깊이와 튕기는 정도가 바뀝니다.</p>
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
            <span className="keycap">
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
          <span aria-hidden>✋</span> 어떤 느낌으로 눌릴까요
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
  { v: 1, label: '아주 자주' },
  { v: 2, label: '자주' },
  { v: 4, label: '가끔' },
  { v: 8, label: '아주 가끔' },
];

const OFFSET: { v: OffsetBeats; label: string }[] = [
  { v: 0, label: '바로' },
  { v: 1, label: '조금 뒤에' },
  { v: 2, label: '더 뒤에' },
  { v: 3, label: '한참 뒤에' },
];

function LoopTab({ keyDef, onPatch }: { keyDef: KeyDef; onPatch: (p: Partial<KeyDef>) => void }) {
  const patchLoop = (p: Partial<KeyDef['loop']>) => onPatch({ loop: { ...keyDef.loop, ...p } });

  return (
    <div className="tab-loop">
      <p className="note">
        켜고 끄는 건 무대와 공연 중에 해요. 여기서는 얼마나 자주 울릴지만 정합니다.
      </p>

      <section className="sheet-field">
        <h3 className="sheet-field-head">
          <span aria-hidden>⏱️</span> 얼마나 자주
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
          <span aria-hidden>🚦</span> 언제 시작
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
