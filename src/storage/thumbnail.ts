/**
 * 키캡 4개를 합성한 썸네일.
 *
 * 공연 저장 시점에 만들어 둔다. 카카오톡 미리보기(og:image)가 이걸 쓰고,
 * 홈의 "내 작품" 목록도 같은 그림의 정사각 버전을 쓴다.
 * 공유 전환율이 여기서 갈리므로 og 쪽은 1200×630 규격을 지킨다.
 */

import { t } from '../i18n';
import { findAsset, type Work } from '../work-model/types';
import { resolveImageUrl } from './assets';
import { getAssetBlob, localKeyOf } from './db';

/** Storage 규칙의 그림 상한과 같은 값. */
const MAX_THUMB_BYTES = 200 * 1024;

const OG_W = 1200;
const OG_H = 630;

function decode(url: string, revoke: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const done = (value: HTMLImageElement | null) => {
      if (revoke) URL.revokeObjectURL(url);
      resolve(value);
    };
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/**
 * 키캡 그림 한 장.
 *
 * **작품을 함께 받는다.** 예전에는 assetId만 받아 resolveImageUrl에 넘겼는데,
 * 그 함수는 "지금 화면이 열어 둔 작품"의 전역 레지스트리를 본다. 그래서 홈 목록처럼
 * 편집 중이 아닌 작품의 썸네일을 만들려 하면 자산을 못 찾아 **빈 카드**가 나왔다.
 * 썸네일은 특정 작품의 것이므로, 그 작품의 IndexedDB 키로 직접 찾는 길을 먼저 둔다.
 * 레지스트리 경로는 원격 자산(남의 작품)을 위해 남겨 둔다.
 */
async function loadArt(work: Work, assetId: string | null): Promise<HTMLImageElement | null> {
  if (!assetId) return null;
  try {
    const asset = findAsset(work, assetId);
    const local = await getAssetBlob(asset?.localKey ?? localKeyOf(work.id, assetId));
    if (local) return await decode(URL.createObjectURL(local), true);
    return await decode(await resolveImageUrl(assetId), false);
  } catch {
    return null;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** hex 색을 밝게(amt>0)/어둡게(amt<0). 스커트와 굴절광을 만드는 데 쓴다. */
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt),
  );
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

/**
 * 키캡 4개를 **한 줄로** 그린다.
 * 화면과 같은 배치·같은 질감이어야 한다 — 카톡 미리보기에서 본 것과
 * 눌러본 것이 다르면 그 순간 신뢰가 깨진다.
 */
function drawKeycaps(
  ctx: CanvasRenderingContext2D,
  work: Work,
  arts: (HTMLImageElement | null)[],
  box: { x: number; y: number; cap: number; gap: number },
) {
  const c = box.cap;
  const r = c * 0.16;

  work.keys.forEach((key, i) => {
    const cx = box.x + i * (c + box.gap);
    const cy = box.y;

    // ① 스커트(옆면) — 캡 아래로 살짝 내려 그린 어두운 몸통
    ctx.fillStyle = shade(key.appearance.baseColor, -0.42);
    roundRect(ctx, cx, cy + c * 0.09, c, c, r);
    ctx.fill();

    // 캡 본체
    ctx.save();
    roundRect(ctx, cx, cy, c, c, r);
    ctx.clip();
    ctx.fillStyle = key.appearance.baseColor;
    ctx.fillRect(cx, cy, c, c);

    // ④ 상단 아크릴 광택
    const gloss = ctx.createLinearGradient(cx, cy, cx, cy + c);
    gloss.addColorStop(0, 'rgba(255,255,255,0.55)');
    gloss.addColorStop(0.36, 'rgba(255,255,255,0.08)');
    gloss.addColorStop(0.55, 'rgba(255,255,255,0)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = gloss;
    ctx.fillRect(cx, cy, c, c);
    ctx.restore();

    // ③ 모서리 굴절광
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.lineWidth = Math.max(1, c * 0.014);
    roundRect(ctx, cx, cy, c, c, r);
    ctx.stroke();
    ctx.restore();

    // ② 안으로 파인 상단면 — 그림이 여기 박힌다
    const pad = c * 0.13;
    const fx = cx + pad;
    const fy = cy + pad;
    const fw = c - pad * 2;
    const fh = c - pad * 2 - c * 0.05;
    ctx.save();
    roundRect(ctx, fx, fy, fw, fh, fw * 0.12);
    ctx.fillStyle = 'rgba(255,255,255,0.17)';
    ctx.fill();
    ctx.clip();
    const art = arts[i];
    if (art) {
      /*
       * 상단면은 정사각이 아니다(fh가 fw보다 짧다). 그림을 이 상자에 그대로 그리면
       * 세로로 눌려 찌그러진다 — 아이가 그린 동그라미가 타원으로 나온다.
       * 비율을 지켜 안에 들어갈 만큼만 키우고 가운데에 놓는다. 자르지도, 늘리지도 않는다.
       */
      const scale = Math.min(fw / art.width, fh / art.height);
      const aw = art.width * scale;
      const ah = art.height * scale;
      ctx.drawImage(art, fx + (fw - aw) / 2, fy + (fh - ah) / 2, aw, ah);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, c * 0.008);
    roundRect(ctx, fx, fy, fw, fh, fw * 0.12);
    ctx.stroke();
    ctx.restore();
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(t('thumb.failed')))),
      type,
      quality,
    );
  });
}

/** 업로드 상한(200KB) 안에 들어올 때까지 품질을 낮춰 가며 뽑는다. */
async function toJpegUnder(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  let blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
  for (const q of [0.7, 0.55, 0.4]) {
    if (blob.size <= maxBytes) break;
    blob = await canvasToBlob(canvas, 'image/jpeg', q);
  }
  return blob;
}

/** 공유용 1200×630 JPEG. og:image 규격이자 업로드 상한 안. */
export async function renderShareThumb(work: Work): Promise<Blob> {
  const arts = await Promise.all(work.keys.map((k) => loadArt(work, k.appearance.artAssetId)));
  const canvas = document.createElement('canvas');
  canvas.width = OG_W;
  canvas.height = OG_H;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, OG_W, OG_H);
  bg.addColorStop(0, '#1b1436');
  bg.addColorStop(1, '#3a1f5c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, OG_W, OG_H);

  // 제목 위, 키캡 한 줄 아래 — 키보드 한 줄처럼 보이는 배치가 곧 이 제품의 얼굴이다.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 66px system-ui, -apple-system, sans-serif';
  ctx.fillText(work.title || t('common.untitled'), OG_W / 2, 128, 1000);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '36px system-ui, -apple-system, sans-serif';
  ctx.fillText(work.hint || t('thumb.defaultHint'), OG_W / 2, 188, 1000);

  const cap = 190;
  const gap = 28;
  const rowW = cap * 4 + gap * 3;
  drawKeycaps(ctx, work, arts, { x: (OG_W - rowW) / 2, y: 250, cap, gap });

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '30px system-ui, -apple-system, sans-serif';
  ctx.fillText(t('view.by', { nick: work.authorNick }), OG_W / 2, 552, 800);

  return toJpegUnder(canvas, MAX_THUMB_BYTES);
}

/**
 * 홈 목록용 썸네일. 로컬에만 둔다.
 * 키캡 한 줄이 들어가야 하므로 정사각이 아니라 가로로 긴 카드다.
 */
export async function renderListThumb(work: Work, width = 320): Promise<Blob> {
  const arts = await Promise.all(work.keys.map((k) => loadArt(work, k.appearance.artAssetId)));
  const height = Math.round(width * 0.625);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#241a44';
  ctx.fillRect(0, 0, width, height);

  const gap = width * 0.03;
  const cap = (width * 0.88 - gap * 3) / 4;
  drawKeycaps(ctx, work, arts, {
    x: (width - (cap * 4 + gap * 3)) / 2,
    y: (height - cap) / 2 - height * 0.03,
    cap,
    gap,
  });
  return canvasToBlob(canvas);
}
