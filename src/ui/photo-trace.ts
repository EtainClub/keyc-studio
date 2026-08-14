/**
 * 사진 → 윤곽선.
 *
 * 사진을 정사각으로 잘라 512로 줄이고, 굵고 진한 검은 선화로 바꾼다.
 * 결과는 배경이 투명해서 DrawCanvas에 그대로 얹히고, 아이가 지우개로 다듬을 수 있다.
 *
 * ── 여기서 하지 않는 것 ──
 * 사진 원본은 어디에도 저장하지 않는다. 캔버스에서 선만 뽑고 그 자리에서 버린다.
 * 네트워크 요청도 없다 — 전부 이 기기 안에서 끝난다.
 *
 * ── 순서와 그 이유 ──
 *   1. 흐리게      센서 노이즈와 살결·머리카락의 잔결을 죽인다
 *   2. Sobel       밝기 변화량과 그 방향
 *   3. 얇게        기울기 방향의 최댓값만 남겨 1px 능선으로 (폭이 고르지 않으면 굵히기가 뭉갠다)
 *   4. 히스테리시스 진한 점에서 출발해 이어지는 약한 점만 따라간다
 *   5. 굵게        1px 선은 내보낼 때 절반이 되고 키캡 위에서 사라진다
 *
 * 3·4번이 이 파일의 값어치다. 없이 만들었더니 얼굴이 흐린 회색 실루엣으로 나왔고,
 * 임계값만 올리면 윤곽이 점선으로 끊겼다. 둘 다 실제로 겪은 실패다.
 *
 * 임계값을 고정 상수로 두지 않고 **밝기 변화량의 백분위수**로 잡는 것도 핵심이다.
 * 밝은 사진과 어두운 사진의 절대 기울기는 자릿수가 다르다. 고정값을 쓰면
 * 한쪽은 새까맣게 뭉치고 다른 쪽은 아무것도 안 나온다.
 */

import { t } from '../i18n';

const SIZE = 512;

export type TraceStrength = 'soft' | 'normal' | 'strong';

/**
 * 선의 **출발점**으로 삼을 픽셀 비율(히스테리시스의 high).
 * 여기서 이어지는 약한 점까지 따라가므로 최종 선은 이 값보다 훨씬 많아진다.
 */
const KEEP_RATIO: Record<TraceStrength, number> = {
  soft: 0.004,
  normal: 0.007,
  strong: 0.012,
};

/**
 * 따라갈 약한 점의 기준(high 대비).
 *
 * 낮게 잡아 선을 되도록 길게 잇는다. 잡티가 조금 늘지만 그건 아래 길이 필터가 잡는다.
 * 반대로 여기가 높으면 윤곽선이 토막나고, 그 토막을 길이 필터가 통째로 버려서
 * 얼굴이 사라진다 — 실제로 그렇게 만들어 봤다.
 */
const LOW_RATIO = 0.28;

/**
 * Sobel 전 블러 반지름 두 번(차례로 적용).
 *
 * 여기서 머리카락을 지우려 들면 안 된다. 512로 줄이면 눈이 15px 남짓이라,
 * 머리카락이 사라질 만큼 흐리면 **눈·코·입이 같이 사라진다**. 실제로 그렇게 만들어 봤고
 * 얼굴이 텅 빈 윤곽만 남았다.
 * 블러는 센서 노이즈만 걷어내는 선에서 멈추고, 머리카락은 아래 길이 필터로 거른다.
 */
const BLUR_RADII: Record<TraceStrength, [number, number]> = {
  soft: [3, 2],
  normal: [2, 1],
  strong: [1, 1],
};

/**
 * 이보다 짧은 선 조각은 버린다(픽셀 수).
 *
 * 머리카락과 잔주름은 짧게 토막나고, 얼굴 윤곽은 길게 이어진다. 세기로는 못 가른다 —
 * 머리카락도 진하기는 하다. 그래서 길이로 가른다.
 *
 * 다만 **작은 이목구비가 이 필터의 희생양이 되기 쉽다.** 512에서 눈 하나의
 * 윤곽 둘레가 60px 남짓이라, 기준을 45로 올렸더니 눈·코가 통째로 사라졌다.
 * 이 값은 "짧은 부스러기만 턴다"는 선을 넘으면 안 된다.
 */
const MIN_CONTOUR: Record<TraceStrength, number> = {
  soft: 40,
  normal: 25,
  strong: 14,
};

/**
 * 선 굵기(512 기준 반지름).
 *
 * Sobel이 뱉는 1px 선을 그대로 쓰면 안 된다. 내보낼 때 256으로 절반이 되고
 * 키캡 위에서 또 줄어들어 사실상 사라진다. 실제로 첫 판이 그래서 흐렸다.
 */
const LINE_RADIUS = 2;

/**
 * 이 조절기는 **진하기가 아니라 디테일 양**을 정한다. 선은 어느 단계에서나 똑같이 진하다.
 * '연하게/진하게'로 부르면 아이가 색연필 굵기로 오해한다.
 */
export const TRACE_STRENGTHS: { id: TraceStrength; label: string }[] = [
  { id: 'soft', label: t('trace.soft') },
  { id: 'normal', label: t('trace.normal') },
  { id: 'strong', label: t('trace.strong') },
];

/**
 * 기본은 가장 단순한 쪽이다.
 * 선이 모자라면 아이가 한 단계 올리면 되지만, 머리카락까지 딸려 나온 그림은
 * 지우개로 일일이 걷어내야 한다 — 되돌리기 비용이 한쪽으로 크게 기울어 있다.
 */
export const DEFAULT_TRACE_STRENGTH: TraceStrength = 'soft';

/** 파일을 정사각으로 가운데 잘라 SIZE×SIZE 캔버스에 그린다. */
async function drawSquare(file: Blob): Promise<ImageData> {
  const bitmap = await loadBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // 사진에는 어차피 투명한 곳이 없다. 흰 바탕을 깔아야 가장자리에서 헛선이 안 생긴다.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);
  if ('close' in bitmap) bitmap.close();

  return ctx.getImageData(0, 0, SIZE, SIZE);
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // HEIC 등 브라우저가 못 여는 형식. 아래 <img> 경로로 한 번 더 시도한다.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('trace.cannotOpen')));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 가로·세로로 한 번씩 훑는 박스 블러. 반복하면 가우시안에 가까워진다. */
function boxBlur(src: Float32Array, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;

  for (let y = 0; y < SIZE; y++) {
    const row = y * SIZE;
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += src[row + Math.min(SIZE - 1, Math.max(0, x + k))];
      }
      tmp[row + x] = sum / span;
    }
  }
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += tmp[Math.min(SIZE - 1, Math.max(0, y + k)) * SIZE + x];
      }
      out[y * SIZE + x] = sum / span;
    }
  }
  return out;
}

/**
 * 히스테리시스 — 임계값 두 개로 선을 고른다.
 *
 * 임계값 하나로는 "약한 진짜 선"과 "강한 노이즈"를 구분할 수 없다. 높이면 얼굴
 * 윤곽이 점선으로 끊기고, 낮추면 살결의 잡티가 통째로 딸려온다. 실제로 둘 다 겪었다.
 *
 * 그래서 확실한 점(high)에서만 출발해, **거기서 이어지는 약한 점(low)만** 따라간다.
 * 진짜 윤곽선은 어딘가 한 곳은 진하므로 통째로 살아나고,
 * 외톨이 잡티는 출발점이 없어 아무리 많아도 들어오지 못한다.
 */
function hysteresis(thin: Float32Array, high: number, low: number): Float32Array {
  const out = new Float32Array(thin.length);
  const stack: number[] = [];

  for (let i = 0; i < thin.length; i++) {
    if (thin[i] >= high) {
      out[i] = 1;
      stack.push(i);
    }
  }

  while (stack.length) {
    const i = stack.pop()!;
    const x = i % SIZE;
    const y = (i / SIZE) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const j = ny * SIZE + nx;
        if (out[j] === 0 && thin[j] >= low) {
          out[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return out;
}

/**
 * 짧은 선 조각 버리기.
 *
 * 이어진 덩어리끼리 묶어 크기를 재고, 기준보다 짧으면 통째로 지운다.
 * 머리카락과 옷 주름은 아무리 진해도 토막으로 끊기지만, 얼굴·머리 윤곽은
 * 수백 픽셀로 이어진다. 세기가 아니라 **길이**로 갈라야 둘이 구분된다.
 */
function dropShortContours(mask: Float32Array, minPixels: number): Float32Array {
  const out = new Float32Array(mask.length);
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const group: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || seen[start]) continue;

    group.length = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;

    while (stack.length) {
      const i = stack.pop()!;
      group.push(i);
      const x = i % SIZE;
      const y = (i / SIZE) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
          const j = ny * SIZE + nx;
          if (!seen[j] && mask[j] > 0) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }

    if (group.length >= minPixels) {
      for (const i of group) out[i] = 1;
    }
  }
  return out;
}

/** 최대값 필터. 얇은 능선을 사방으로 불려 굵은 선으로 만든다. */
function dilate(src: Float32Array, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  for (let y = 0; y < SIZE; y++) {
    const row = y * SIZE;
    for (let x = 0; x < SIZE; x++) {
      let m = 0;
      for (let k = -radius; k <= radius; k++) {
        const v = src[row + Math.min(SIZE - 1, Math.max(0, x + k))];
        if (v > m) m = v;
      }
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      let m = 0;
      for (let k = -radius; k <= radius; k++) {
        const v = tmp[Math.min(SIZE - 1, Math.max(0, y + k)) * SIZE + x];
        if (v > m) m = v;
      }
      out[y * SIZE + x] = m;
    }
  }
  return out;
}

/**
 * 비최대 억제 — 기울기 방향으로 가장 가파른 점만 남겨 선을 1px로 얇게 만든다.
 *
 * 이 단계가 없으면 경계마다 폭이 제각각인 띠가 생기고, 그걸 굵히면 뭉텅이가 된다.
 * 얇게 만든 뒤 일정하게 불려야 굵기가 고른 만화 선이 나온다.
 */
function thinRidges(mag: Float32Array, gx: Float32Array, gy: Float32Array): Float32Array {
  const out = new Float32Array(mag.length);
  for (let y = 1; y < SIZE - 1; y++) {
    for (let x = 1; x < SIZE - 1; x++) {
      const i = y * SIZE + x;
      const m = mag[i];
      if (m <= 0) continue;

      // 각도를 네 방향으로 뭉뚱그린다. 8이웃뿐이라 그 이상은 의미가 없다.
      let deg = (Math.atan2(gy[i], gx[i]) * 180) / Math.PI;
      if (deg < 0) deg += 180;
      let a: number;
      let b: number;
      if (deg < 22.5 || deg >= 157.5) {
        a = mag[i - 1]; b = mag[i + 1];
      } else if (deg < 67.5) {
        a = mag[i - SIZE + 1]; b = mag[i + SIZE - 1];
      } else if (deg < 112.5) {
        a = mag[i - SIZE]; b = mag[i + SIZE];
      } else {
        a = mag[i - SIZE - 1]; b = mag[i + SIZE + 1];
      }
      if (m >= a && m >= b) out[i] = m;
    }
  }
  return out;
}

/**
 * 밝기 변화량 상위 keepRatio 만큼만 남기는 경계값을 히스토그램으로 찾는다.
 *
 * 칸을 선형으로 나누면 안 된다. 사진의 기울기 분포는 0 근처에 극단적으로 몰려 있어서,
 * 경계값이 떨어지는 구간이 통째로 한 칸에 들어가 버린다. 그러면 '보통'과 '진하게'가
 * 같은 칸을 골라 **결과가 완전히 똑같아진다**(실제로 그랬다).
 * 그래서 칸 수를 늘리고 제곱근으로 매핑해 낮은 쪽 해상도를 키운다.
 */
const BINS = 1024;

function thresholdFor(mag: Float32Array, keepRatio: number): number {
  let max = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] > max) max = mag[i];
  if (max <= 0) return Infinity;

  const bins = new Uint32Array(BINS);
  for (let i = 0; i < mag.length; i++) {
    const b = Math.round(Math.sqrt(mag[i] / max) * (BINS - 1));
    bins[b]++;
  }
  const want = Math.round(mag.length * keepRatio);
  let seen = 0;
  for (let b = BINS - 1; b >= 0; b--) {
    seen += bins[b];
    if (seen >= want) {
      const t = b / (BINS - 1);
      return t * t * max;
    }
  }
  return 0;
}

/**
 * 사진에서 선을 따 256×256 투명 PNG로 만든다.
 * 선이 거의 안 나오면 null — 단색 배경 사진을 넣었을 때 빈 그림이 저장되는 걸 막는다.
 */
export async function tracePhotoToArt(
  file: Blob,
  strength: TraceStrength = DEFAULT_TRACE_STRENGTH,
): Promise<ImageData | null> {
  const image = await drawSquare(file);
  const px = image.data;

  const gray = new Float32Array(SIZE * SIZE);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
  }

  // 두 번 흘려야 가우시안에 가까워진다.
  const [r1, r2] = BLUR_RADII[strength];
  const smooth = boxBlur(boxBlur(gray, r1), r2);

  const mag = new Float32Array(SIZE * SIZE);
  const gxs = new Float32Array(SIZE * SIZE);
  const gys = new Float32Array(SIZE * SIZE);
  for (let y = 1; y < SIZE - 1; y++) {
    for (let x = 1; x < SIZE - 1; x++) {
      const i = y * SIZE + x;
      const tl = smooth[i - SIZE - 1], t = smooth[i - SIZE], tr = smooth[i - SIZE + 1];
      const l = smooth[i - 1], r = smooth[i + 1];
      const bl = smooth[i + SIZE - 1], b = smooth[i + SIZE], br = smooth[i + SIZE + 1];
      const gx = tl + 2 * l + bl - (tr + 2 * r + br);
      const gy = tl + 2 * t + tr - (bl + 2 * b + br);
      gxs[i] = gx;
      gys[i] = gy;
      mag[i] = Math.hypot(gx, gy);
    }
  }

  const thin = thinRidges(mag, gxs, gys);
  const lo = thresholdFor(thin, KEEP_RATIO[strength]);
  if (!Number.isFinite(lo) || lo <= 0) return null;

  /*
   * 알파를 밝기 변화량에 비례시키면 안 된다.
   *
   * 백분위 임계값이라 살아남은 픽셀 대부분이 경계값 바로 위에 몰려 있다. 비례시키면
   * 그 대부분이 옅은 회색으로 나오고, 얼굴처럼 경계가 완만한 사진은 통째로 흐려진다.
   * 선으로 뽑기로 한 픽셀은 **그냥 선이다** — 진하기는 여기서 정하지 않는다.
   */
  const linked = hysteresis(thin, lo, lo * LOW_RATIO);
  const kept = dropShortContours(linked, MIN_CONTOUR[strength]);
  const bold = dilate(kept, LINE_RADIUS);
  // 가장자리만 한 겹 부드럽게. 심은 1로 남아 진하고, 계단만 깎인다.
  const feather = boxBlur(bold, 1);

  const out = new ImageData(SIZE, SIZE);
  const o = out.data;
  let drawn = 0;
  for (let i = 0, p = 0; i < feather.length; i++, p += 4) {
    const a = Math.min(255, Math.round(feather[i] * 255 * 1.7));
    if (a < 20) continue;
    o[p] = 17;
    o[p + 1] = 17;
    o[p + 2] = 17;
    o[p + 3] = a;
    drawn++;
  }

  // 512×512의 0.15%. 이보다 적으면 사실상 빈 그림이다.
  return drawn < 400 ? null : out;
}
