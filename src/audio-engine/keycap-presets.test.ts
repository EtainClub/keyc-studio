import { describe, expect, it, vi } from 'vitest';
import { KEYCAP_PRESETS, playbackPresetId } from '../work-model/presets';
import { isRecordedPresetAvailable, recordedPresetUrl } from './recorded-presets';
import { SoundBank } from './sound-bank';
import { synthPreset } from './presets';

function audioContext(sampleRate = 44_100): BaseAudioContext {
  return {
    sampleRate,
    createBuffer: (_channels: number, length: number, rate: number) => {
      const data = new Float32Array(length);
      return {
        duration: length / rate,
        length,
        numberOfChannels: 1,
        sampleRate: rate,
        getChannelData: () => data,
      } as unknown as AudioBuffer;
    },
  } as unknown as BaseAudioContext;
}

describe('기계식 키캡 프리셋', () => {
  it('선택 목록의 네 타건음이 서로 다른 앱 내부 녹음 파일을 가리킨다', () => {
    const urls = KEYCAP_PRESETS.map((preset) => {
      expect(isRecordedPresetAvailable(preset.id)).toBe(true);
      return recordedPresetUrl(preset.id);
    });

    expect(KEYCAP_PRESETS).toHaveLength(4);
    expect(new Set(urls).size).toBe(4);
    expect(urls.every((url) => url?.endsWith('.mp3'))).toBe(true);
  });

  it('기존 작품의 초기 합성 타건음도 실제 녹음으로 치환한다', () => {
    expect(playbackPresetId('keyLinear@1')).toBe('realTactile9@1');
    expect(playbackPresetId('keyTactile@1')).toBe('realTactile8@1');
    expect(playbackPresetId('keyClicky@1')).toBe('realMxBlue@1');
    expect(playbackPresetId('keyThock@1')).toBe('realTactile14@1');
    expect(playbackPresetId('ppyong@1')).toBe('ppyong@1');
  });

  it('실제 녹음은 사용자 자산 resolver를 거치지 않고 디코드·캐시한다', async () => {
    const decoded = {} as AudioBuffer;
    const ctx = {
      decodeAudioData: (_bytes: ArrayBuffer, resolve: DecodeSuccessCallback) => resolve(decoded),
    } as unknown as BaseAudioContext;
    const resolver = vi.fn<() => Promise<ArrayBuffer>>();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as Response);
    const bank = new SoundBank(ctx, resolver);

    try {
      await bank.preload(KEYCAP_PRESETS.map((preset) => preset.id));
      for (const preset of KEYCAP_PRESETS) expect(bank.get(preset.id)).toBe(decoded);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(resolver).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('같은 프리셋과 샘플레이트는 결정론적으로 캐시된다', () => {
    const ctx = audioContext(48_000);
    expect(synthPreset(ctx, 'keyLinear@1')).toBe(synthPreset(ctx, 'keyLinear@1'));
  });
});
