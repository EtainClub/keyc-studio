/**
 * 손가락 그리기 캔버스.
 *
 * 256×256 투명 PNG로 나간다. 굵기 3단계, 지우개, 전체 지우기.
 * 실제 캔버스 픽셀은 512로 잡고 절반으로 줄여 내보내 계단현상을 줄인다.
 */

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';

const EXPORT_SIZE = 256;
const CANVAS_SIZE = 512;

const PALETTE = [
  '#111111', '#FFFFFF', '#FF4D6D', '#FF9F1C',
  '#FFD400', '#3DD6A0', '#4CC9F0', '#7B61FF',
  '#B5651D', '#FF8FCF',
];

const WIDTHS = [8, 18, 34];

export type DrawCanvasHandle = {
  /** 현재 그림을 256×256 PNG Blob으로. 아무것도 안 그렸으면 null. */
  export: () => Promise<Blob | null>;
  clear: () => void;
};

type Props = { initialUrl?: string | null };

export const DrawCanvas = forwardRef<DrawCanvasHandle, Props>(function DrawCanvas(
  { initialUrl },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState(PALETTE[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [erasing, setErasing] = useState(false);

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
      return new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    },
    clear() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.getContext('2d')!.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      dirty.current = false;
    },
  }));

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

  return (
    <div className="draw">
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

      <div className="draw-tools">
        <div className="palette">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${!erasing && color === c ? 'on' : ''}`}
              style={{ background: c }}
              aria-label={`색 ${c}`}
              onClick={() => {
                setColor(c);
                setErasing(false);
              }}
            />
          ))}
        </div>

        <div className="draw-row">
          {WIDTHS.map((w, i) => (
            <button
              key={w}
              type="button"
              className={`chip ${!erasing && width === w ? 'on' : ''}`}
              onClick={() => {
                setWidth(w);
                setErasing(false);
              }}
            >
              {['가늘게', '보통', '굵게'][i]}
            </button>
          ))}
          <button
            type="button"
            className={`chip ${erasing ? 'on' : ''}`}
            onClick={() => setErasing((v) => !v)}
          >
            🧽 지우개
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              canvas.getContext('2d')!.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
              dirty.current = false;
            }}
          >
            전체 지우기
          </button>
        </div>
      </div>
    </div>
  );
});
