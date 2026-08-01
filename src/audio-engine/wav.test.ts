/**
 * 완료 정의: "iOS에서 녹음한 소리가 Android에서 재생된다(역방향도)".
 *
 * 그 보장의 근거는 출력이 항상 16-bit PCM mono WAV라는 것이다.
 * 여기서는 헤더가 규격대로인지, 샘플이 왕복해도 살아남는지를 본다.
 * (실기기 교차 검증은 이 테스트가 대신해 주지 않는다 — 4주차에 반드시 해야 한다.)
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_SOUND_BYTES,
  TARGET_SAMPLE_RATE,
  downsample,
  encodeWav,
  finishRecording,
  normalize,
  peak,
  trimSilence,
} from './wav';

function tone(seconds: number, rate: number, freq = 440, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.floor(seconds * rate));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / rate) * amp;
  }
  return out;
}

function readHeader(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  const str = (off: number, len: number) =>
    String.fromCharCode(...new Uint8Array(bytes, off, len));
  return {
    riff: str(0, 4),
    wave: str(8, 4),
    fmt: str(12, 4),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bits: view.getUint16(34, true),
    dataTag: str(36, 4),
    dataSize: view.getUint32(40, true),
  };
}

describe('encodeWav', () => {
  it('규격대로인 16-bit mono PCM 헤더를 쓴다', async () => {
    const samples = tone(0.1, TARGET_SAMPLE_RATE);
    const blob = encodeWav(samples, TARGET_SAMPLE_RATE);
    const header = readHeader(await blob.arrayBuffer());

    expect(header.riff).toBe('RIFF');
    expect(header.wave).toBe('WAVE');
    expect(header.fmt).toBe('fmt ');
    expect(header.audioFormat).toBe(1); // PCM — 코덱 협상이 끼어들 여지가 없다
    expect(header.channels).toBe(1);
    expect(header.sampleRate).toBe(TARGET_SAMPLE_RATE);
    expect(header.bits).toBe(16);
    expect(header.blockAlign).toBe(2);
    expect(header.byteRate).toBe(TARGET_SAMPLE_RATE * 2);
    expect(header.dataTag).toBe('data');
    expect(header.dataSize).toBe(samples.length * 2);
    expect(blob.type).toBe('audio/wav');
  });

  it('샘플이 왕복해도 16비트 오차 안에서 살아남는다', async () => {
    const samples = tone(0.02, TARGET_SAMPLE_RATE);
    const bytes = await encodeWav(samples, TARGET_SAMPLE_RATE).arrayBuffer();
    const view = new DataView(bytes);
    for (let i = 0; i < samples.length; i++) {
      const decoded = view.getInt16(44 + i * 2, true) / 0x7fff;
      expect(Math.abs(decoded - samples[i])).toBeLessThan(1 / 1000);
    }
  });

  it('클리핑 범위를 벗어난 값도 깨지지 않게 자른다', async () => {
    const samples = new Float32Array([2, -2, 0]);
    const bytes = await encodeWav(samples, TARGET_SAMPLE_RATE).arrayBuffer();
    const view = new DataView(bytes);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});

describe('트림 / 다운샘플 / 정규화', () => {
  it('앞뒤 무음을 잘라낸다', () => {
    const rate = 44100;
    const silence = new Float32Array(rate * 0.4);
    const sound = tone(0.3, rate);
    const joined = new Float32Array(silence.length * 2 + sound.length);
    joined.set(sound, silence.length);

    const trimmed = trimSilence(joined, rate);
    expect(trimmed.length).toBeLessThan(joined.length);
    // 소리 부분(0.3초)은 지켜져야 한다. 패딩 40ms×2를 감안한다.
    expect(trimmed.length).toBeGreaterThanOrEqual(sound.length);
    expect(trimmed.length).toBeLessThan(sound.length + rate * 0.12);
  });

  it('전부 무음이면 자르지 않는다(경고는 UI가 한다)', () => {
    const silence = new Float32Array(1000);
    expect(trimSilence(silence, 44100).length).toBe(1000);
  });

  it('다운샘플이 비율대로 길이를 줄인다', () => {
    const src = tone(1, 44100);
    const out = downsample(src, 44100, TARGET_SAMPLE_RATE);
    expect(out.length).toBe(Math.floor(src.length / (44100 / TARGET_SAMPLE_RATE)));
  });

  it('정규화가 최대치를 목표에 맞춘다', () => {
    const quiet = tone(0.05, TARGET_SAMPLE_RATE, 440, 0.05);
    expect(peak(normalize(quiet))).toBeCloseTo(0.9, 2);
  });
});

describe('finishRecording', () => {
  it('1.5초 상한과 200KB 상한을 모두 지킨다', () => {
    const rate = 48000;
    // 5초짜리를 넣어도 1.5초에서 잘려야 한다.
    const chunks = [tone(2.5, rate), tone(2.5, rate)];
    const result = finishRecording(chunks, rate);

    expect(result.durationSec).toBeLessThanOrEqual(1.51);
    expect(result.bytes).toBeLessThanOrEqual(MAX_SOUND_BYTES);
    expect(result.tooQuiet).toBe(false);
  });

  it('너무 작은 소리를 표시한다', () => {
    const rate = 48000;
    const result = finishRecording([tone(0.5, rate, 440, 0.004)], rate);
    expect(result.tooQuiet).toBe(true);
  });

  it('1.5초 녹음이 100KB 안에 들어온다(작품 250KB 예산의 근거)', () => {
    const result = finishRecording([tone(1.5, 48000)], 48000);
    expect(result.bytes).toBeLessThan(100 * 1024);
  });
});
