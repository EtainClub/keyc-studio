import { describe, expect, it, vi } from 'vitest';
import { SoundBank, assetSoundKey } from './sound-bank';

describe('SoundBank', () => {
  it('자산 로드가 한 번 실패해도 다음 preload에서 다시 시도한다', async () => {
    const decoded = {} as AudioBuffer;
    const ctx = {
      decodeAudioData: (
        _bytes: ArrayBuffer,
        resolve: DecodeSuccessCallback,
      ) => {
        resolve(decoded);
      },
    } as unknown as BaseAudioContext;
    const resolver = vi
      .fn<() => Promise<ArrayBuffer>>()
      .mockRejectedValueOnce(new Error('아직 등록되지 않은 자산'))
      .mockResolvedValueOnce(new ArrayBuffer(8));
    const bank = new SoundBank(ctx, resolver);
    const key = assetSoundKey('recorded-sound');

    await expect(bank.load(key)).rejects.toThrow('아직 등록되지 않은 자산');
    await expect(bank.load(key)).resolves.toBe(decoded);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(bank.get(key)).toBe(decoded);
  });

  it('방금 디코딩한 녹음 버퍼를 넣으면 resolver 없이 즉시 조회한다', () => {
    const resolver = vi.fn<() => Promise<ArrayBuffer>>();
    const bank = new SoundBank({} as BaseAudioContext, resolver);
    const key = assetSoundKey('fresh-recording');
    const buffer = {} as AudioBuffer;

    bank.put(key, buffer);

    expect(bank.get(key)).toBe(buffer);
    expect(resolver).not.toHaveBeenCalled();
  });
});
