/**
 * WAV 인코딩 파이프라인.
 *
 * MediaRecorder를 쓰지 않는 이유: iOS Safari는 보통 mp4/aac, Android Chrome은
 * webm/opus를 뱉는다. 한쪽에서 녹음한 파일이 다른 쪽 decodeAudioData에서 열리지
 * 않는 사고가 실제로 난다. 아이가 만든 소리가 친구 폰에서 안 나오면 제품은 끝이다.
 * 16-bit PCM WAV는 모든 브라우저의 decodeAudioData가 연다.
 */

export const TARGET_SAMPLE_RATE = 22050;
export const MAX_RECORD_SECONDS = 1.5;
export const MAX_SOUND_BYTES = 200 * 1024;

/** 이 값보다 조용하면 "소리가 너무 작아요"를 띄운다. */
export const QUIET_RMS = 0.02;

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > max) max = v;
  }
  return max;
}

export function concatChunks(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * 앞뒤 무음 트림.
 *
 * 창(window) 단위 RMS가 임계값을 넘는 첫/마지막 지점을 찾고 약간의 여유를 둔다.
 * 아이는 버튼을 누르고 한 박자 뒤에 소리를 내므로 이 트림이 체감 품질을 크게 바꾼다.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  opts: { threshold?: number; padMs?: number; windowMs?: number } = {},
): Float32Array {
  const windowSize = Math.max(1, Math.floor((sampleRate * (opts.windowMs ?? 10)) / 1000));
  const pad = Math.floor((sampleRate * (opts.padMs ?? 40)) / 1000);
  // 절대 임계값과 상대 임계값(최대치의 8%) 중 큰 쪽 — 조용한 녹음이 통째로 날아가지 않게.
  const threshold = Math.max(opts.threshold ?? 0.012, peak(samples) * 0.08);

  let start = -1;
  let end = -1;
  for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
    const w = samples.subarray(i, i + windowSize);
    if (rms(w) >= threshold) {
      if (start === -1) start = i;
      end = i + windowSize;
    }
  }
  if (start === -1) return samples; // 전부 조용함 — 자르지 않고 그대로 넘긴다(경고는 UI가 띄운다)

  const from = Math.max(0, start - pad);
  const to = Math.min(samples.length, end + pad);
  return samples.slice(from, to);
}

/**
 * 다운샘플. 데시메이션 전에 이동평균으로 살짝 뭉개 에일리어싱을 줄인다.
 * 목소리 효과음에는 이 정도로 충분하다.
 */
export function downsample(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (toRate >= fromRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    out[i] = to > from ? sum / (to - from) : 0;
  }
  return out;
}

/** 최대치를 target에 맞춘다. 아이 목소리는 대개 너무 작다. */
export function normalize(samples: Float32Array, target = 0.9): Float32Array {
  const p = peak(samples);
  if (p < 1e-5 || p >= target) return samples;
  const g = target / p;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 청크 길이
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export type EncodedSound = {
  blob: Blob;
  /** 트림/다운샘플 후 길이(초) */
  durationSec: number;
  rms: number;
  tooQuiet: boolean;
  bytes: number;
};

/** 수집된 Float32 → 트림 → 다운샘플 → 정규화 → WAV. */
export function finishRecording(
  chunks: Float32Array[],
  inputSampleRate: number,
): EncodedSound {
  const raw = concatChunks(chunks);
  const capped = raw.slice(0, Math.floor(inputSampleRate * MAX_RECORD_SECONDS));
  const level = rms(capped);
  const trimmed = trimSilence(capped, inputSampleRate);
  const down = downsample(trimmed, inputSampleRate, TARGET_SAMPLE_RATE);
  const normalized = normalize(down);

  // 200KB 상한(= 약 4.6초). 트림 후엔 거의 닿지 않지만 규칙과 동일한 방어선을 둔다.
  const maxSamples = Math.floor((MAX_SOUND_BYTES - 44) / 2);
  const clipped =
    normalized.length > maxSamples ? normalized.slice(0, maxSamples) : normalized;

  const blob = encodeWav(clipped, TARGET_SAMPLE_RATE);
  return {
    blob,
    durationSec: clipped.length / TARGET_SAMPLE_RATE,
    rms: level,
    tooQuiet: level < QUIET_RMS,
    bytes: blob.size,
  };
}
