/**
 * 손가락 그리기 캔버스.
 *
 * 256×256 투명 PNG로 나간다. 굵기 3단계, 지우개, 되돌리기, 전체 지우기.
 * 실제 캔버스 픽셀은 512로 잡고 절반으로 줄여 내보내 계단현상을 줄인다.
 *
 * 캔버스는 "네모난 종이"가 아니라 키캡 윗면처럼 보인다 — 바탕이 실제 키캡 색이다.
 * 어두운 격자 위에 그리면 아이는 분홍 키캡에 얹힌 결과를 상상하지 못한다.
 *
 * 되돌리기는 이 화면에서 가장 중요한 안전장치다. 아이는 반드시 실수하고,
 * 실수 한 번에 그림 전체를 잃으면 다시 그릴 마음이 없어진다.
 * 그래서 "전체 지우기"조차 되돌릴 수 있다 — 확인 팝업 대신 되돌리기를 준다.
 *
 * 사진에서 선을 따는 기능은 관리자 계정에서만 열린다(photoTraceEnabled).
 * 사진이 섞인 그림은 export가 fromPhoto로 알려주고, 그 표식은 자산에 그대로 남는다 —
 * 공유는 관리자 계정에서만 허용된다(remote.ts publishWork).
 */

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { t } from '../../i18n';
import {
  DEFAULT_TRACE_STRENGTH,
  TRACE_STRENGTHS,
  tracePhotoToArt,
  type TraceStrength,
} from '../photo-trace';

const EXPORT_SIZE = 256;
const CANVAS_SIZE = 512;
/** 스냅샷 하나가 1MB다. 아이가 쓰는 되돌리기 깊이로는 이 정도면 충분하다. */
const HISTORY_LIMIT = 8;

const PALETTE: { c: string; label: string }[] = [
  { c: '#111111', label: t('draw.color.black') },
  { c: '#FFFFFF', label: t('draw.color.white') },
  { c: '#FF4D6D', label: t('draw.color.red') },
  { c: '#FF9F1C', label: t('draw.color.orange') },
  { c: '#FFD400', label: t('draw.color.yellow') },
  { c: '#3DD6A0', label: t('draw.color.green') },
  { c: '#4CC9F0', label: t('draw.color.sky') },
  { c: '#7B61FF', label: t('draw.color.purple') },
  { c: '#B5651D', label: t('draw.color.brown') },
  { c: '#FF8FCF', label: t('draw.color.pink') },
];

const WIDTHS: { v: number; label: string; dot: number }[] = [
  { v: 8, label: t('draw.width.thin'), dot: 10 },
  { v: 18, label: t('draw.width.normal'), dot: 18 },
  { v: 34, label: t('draw.width.thick'), dot: 28 },
];

/** 그림 한 장과 그 출처. 사진이 섞였는지는 저장하는 쪽이 반드시 알아야 한다. */
export type DrawResult = { blob: Blob; fromPhoto: boolean };

export type DrawCanvasHandle = {
  /** 현재 그림을 256×256 PNG로. 아무것도 안 그렸으면 null. */
  export: () => Promise<DrawResult | null>;
  clear: () => void;
};

type Props = {
  initialUrl?: string | null;
  /** 캔버스 바탕에 깔리는 키캡 색. 그림 자체는 투명 PNG라 이 색은 저장되지 않는다. */
  capColor: string;
  /** 사진에서 선 따기 노출 여부. 관리자 계정에서만 true. */
  photoTraceEnabled?: boolean;
  /** 불러온 그림이 사진에서 딴 것이면 true — 이어 그려도 사진 유래로 유지된다. */
  initialFromPhoto?: boolean;
};

/** 되돌리기 스냅샷. 그림뿐 아니라 "그린 게 있는가"와 "사진이 섞였는가"도 같이 되감는다. */
type Snapshot = { img: ImageData; dirty: boolean; tainted: boolean };

export const DrawCanvas = forwardRef<DrawCanvasHandle, Props>(function DrawCanvas(
  { initialUrl, capColor, photoTraceEnabled = false, initialFromPhoto = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 굵기를 바꿔 다시 딸 수 있게 원본을 들고 있는다. 저장은 하지 않는다 — 시트를 닫으면 사라진다. */
  const photoRef = useRef<Blob | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const history = useRef<Snapshot[]>([]);

  const [canUndo, setCanUndo] = useState(false);
  const [color, setColor] = useState(PALETTE[0].c);
  const [width, setWidth] = useState(WIDTHS[1].v);
  const [erasing, setErasing] = useState(false);
  const [tainted, setTainted] = useState(initialFromPhoto);
  const [strength, setStrength] = useState<TraceStrength>(DEFAULT_TRACE_STRENGTH);
  const [tracing, setTracing] = useState(false);
  const [traceError, setTraceError] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !initialUrl) return;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      dirty.current = true;
      // 불러온 그림은 되돌리기의 바닥이다 — 그 이전으로는 갈 곳이 없다.
      history.current = [];
      setCanUndo(false);
    };
    img.src = initialUrl;
  }, [initialUrl]);

  useImperativeHandle(ref, () => ({
    async export() {
      const canvas = canvasRef.current;
      if (!canvas || !dirty.current) return null;
      const out = document.createElement('canvas');
      out.width = EXPORT_SIZE;
      out.height = EXPORT_SIZE;
      const octx = out.getContext('2d')!;
      octx.drawImage(canvas, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
      return blob ? { blob, fromPhoto: tainted } : null;
    },
    clear() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.getContext('2d')!.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      dirty.current = false;
      history.current = [];
      photoRef.current = null;
      setCanUndo(false);
      setTainted(false);
    },
  }));

  const snapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    history.current.push({
      img: ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE),
      dirty: dirty.current,
      tainted,
    });
    if (history.current.length > HISTORY_LIMIT) history.current.shift();
    setCanUndo(true);
  };

  const undo = () => {
    const canvas = canvasRef.current;
    const prev = history.current.pop();
    if (!canvas || !prev) return;
    canvas.getContext('2d')!.putImageData(prev.img, 0, 0);
    dirty.current = prev.dirty;
    setTainted(prev.tainted);
    setCanUndo(history.current.length > 0);
  };

  const clearAll = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    snapshot(); // 전부 지우기도 되돌릴 수 있어야 한다.
    canvas.getContext('2d')!.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    dirty.current = false;
    // 사진에서 온 픽셀이 한 톨도 남지 않았으므로 표식도 함께 뗀다.
    setTainted(false);
    setTraceError('');
  };

  /** 사진에서 선을 따 캔버스를 덮어쓴다. 덮기 전에 스냅샷을 남겨 되돌릴 수 있게 한다. */
  const traceFrom = async (file: Blob, next: TraceStrength) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setTracing(true);
    setTraceError('');
    try {
      const edges = await tracePhotoToArt(file, next);
      if (!edges) {
        setTraceError(t('draw.noLines'));
        return;
      }
      snapshot();
      canvas.getContext('2d')!.putImageData(edges, 0, 0);
      dirty.current = true;
      photoRef.current = file;
      setTainted(true);
    } catch (e) {
      console.warn('[photo-trace] 실패', e);
      setTraceError(e instanceof Error ? e.message : t('draw.photoFailed'));
    } finally {
      setTracing(false);
    }
  };

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    // 지우개는 색이 아니라 합성 모드로 구현한다 — 배경이 투명이라 흰색으로 덮으면 안 된다.
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    ctx.strokeStyle = erasing ? 'rgba(0,0,0,1)' : color;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    dirty.current = true;
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    snapshot(); // 한 획 = 한 번의 되돌리기
    drawing.current = true;
    const p = pointOf(e);
    last.current = p;
    stroke(p, { x: p.x + 0.01, y: p.y }); // 점 하나만 찍어도 보이게
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const p = pointOf(e);
    stroke(last.current, p);
    last.current = p;
  };

  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  const pickColor = (c: string) => {
    setColor(c);
    setErasing(false);
  };

  return (
    <div className="draw">
      {/* 캔버스를 키캡 윗면처럼 감싼다 — 지금 무엇 위에 그리는지 한눈에 보이도록. */}
      <div className="draw-pad" style={{ ['--cap-color' as string]: capColor }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="draw-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        <span className="draw-pad-gloss" aria-hidden />
        {tracing && <span className="draw-pad-busy">{t('draw.tracing')}</span>}
      </div>

      <div className="draw-tools">
        <div className={`palette ${erasing ? 'muted' : ''}`} role="group" aria-label={t('draw.paletteAria')}>
          {PALETTE.map(({ c, label }) => (
            <button
              key={c}
              type="button"
              className={`swatch ${!erasing && color === c ? 'on' : ''}`}
              style={{ background: c }}
              aria-label={label}
              aria-pressed={!erasing && color === c}
              onClick={() => pickColor(c)}
            />
          ))}
        </div>

        <div className="draw-row">
          <div className="seg" role="group" aria-label={t('draw.brushEraserAria')}>
            <button
              type="button"
              className={`seg-btn ${!erasing ? 'on' : ''}`}
              aria-pressed={!erasing}
              onClick={() => setErasing(false)}
            >
              <span aria-hidden>✏️</span> {t('draw.brush')}
            </button>
            <button
              type="button"
              className={`seg-btn ${erasing ? 'on' : ''}`}
              aria-pressed={erasing}
              onClick={() => setErasing(true)}
            >
              <span aria-hidden>🧽</span> {t('draw.eraser')}
            </button>
          </div>

          <div className="size-group" role="group" aria-label={t('draw.widthAria')}>
            {WIDTHS.map((w) => (
              <button
                key={w.v}
                type="button"
                className={`size-btn ${width === w.v ? 'on' : ''}`}
                aria-label={w.label}
                aria-pressed={width === w.v}
                onClick={() => setWidth(w.v)}
              >
                <span className="size-dot" style={{ width: w.dot, height: w.dot }} aria-hidden />
              </button>
            ))}
          </div>
        </div>

        <div className="draw-row undo-row">
          <button type="button" className="chip ghost" onClick={undo} disabled={!canUndo}>
            <span aria-hidden>↩️</span> {t('draw.undo')}
          </button>
          <button type="button" className="chip ghost danger" onClick={clearAll}>
            <span aria-hidden>🗑️</span> {t('draw.clearAll')}
          </button>
        </div>

        {photoTraceEnabled && (
          <div className="photo-trace">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // 같은 파일을 다시 골라도 change가 뜨도록 값을 비운다.
                e.target.value = '';
                if (file) void traceFrom(file, strength);
              }}
            />
            <div className="draw-row">
              <button
                type="button"
                className="chip ghost"
                disabled={tracing}
                onClick={() => fileRef.current?.click()}
              >
                <span aria-hidden>🖼️</span> {t('draw.fromPhoto')}
              </button>
              {photoRef.current && (
                <div className="seg" role="group" aria-label={t('draw.detailAria')}>
                  {TRACE_STRENGTHS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`seg-btn ${strength === s.id ? 'on' : ''}`}
                      aria-pressed={strength === s.id}
                      disabled={tracing}
                      onClick={() => {
                        setStrength(s.id);
                        if (photoRef.current) void traceFrom(photoRef.current, s.id);
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {traceError && <p className="warn">{traceError}</p>}
            {tainted && (
              <p className="note">
                {t('draw.photoNote')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
