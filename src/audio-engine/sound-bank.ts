/**
 * AudioBuffer 캐시.
 *
 * pointerdown 핸들러는 **동기적으로** 버퍼를 얻어야 한다(await 한 번이면
 * 다음 프레임으로 밀리고, 그 순간 30ms 예산이 날아간다).
 * 그래서 화면 진입 시 preload로 전부 디코드해 두고, 누를 때는 get()만 한다.
 *
 * 키 문자열은 세 종류다:
 *   'tok@1'            효과음 프리셋 — 코드로 합성
 *   'realTactile9@1'   실제 타건음 프리셋 — 앱에 포함된 녹음을 디코드
 *   'asset:AbC'        내가 만든 자산 — resolver가 바이트를 가져온다
 */

import { isPresetSynthAvailable, synthPreset } from './presets';
import { isRecordedPresetAvailable, loadRecordedPreset } from './recorded-presets';

export const ASSET_PREFIX = 'asset:';

export function assetSoundKey(assetId: string): string {
  return ASSET_PREFIX + assetId;
}

export function isAssetKey(key: string): boolean {
  return key.startsWith(ASSET_PREFIX);
}

export function assetIdOfKey(key: string): string {
  return key.slice(ASSET_PREFIX.length);
}

/** assetId를 실제 바이트로 바꾸는 방법은 storage 계층이 정한다. */
export type AssetResolver = (assetId: string) => Promise<ArrayBuffer>;

function decode(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  // Safari는 오래도록 콜백 형태만 지원했다. 두 형태 모두 받아준다.
  return new Promise((resolve, reject) => {
    const maybe = ctx.decodeAudioData(bytes, resolve, reject);
    if (maybe && typeof (maybe as Promise<AudioBuffer>).then === 'function') {
      (maybe as Promise<AudioBuffer>).then(resolve, reject);
    }
  });
}

export class SoundBank {
  private buffers = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer>>();

  constructor(
    private ctx: BaseAudioContext,
    private resolver: AssetResolver,
  ) {}

  setResolver(resolver: AssetResolver): void {
    this.resolver = resolver;
  }

  /** 동기 조회. 캐시에 없으면 undefined — 호출부는 조용히 넘어가야 한다. */
  get(key: string): AudioBuffer | undefined {
    const hit = this.buffers.get(key);
    if (hit) return hit;
    if (!isAssetKey(key) && isPresetSynthAvailable(key)) {
      const buf = synthPreset(this.ctx, key);
      this.buffers.set(key, buf);
      return buf;
    }
    return undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  async load(key: string): Promise<AudioBuffer> {
    const cached = this.get(key);
    if (cached) return cached;

    const running = this.inflight.get(key);
    if (running) return running;

    const p = (async () => {
      const bytes = isRecordedPresetAvailable(key)
        ? await loadRecordedPreset(key)
        : await this.resolver(assetIdOfKey(key));
      const buf = await decode(this.ctx, bytes);
      this.buffers.set(key, buf);
      return buf;
    })().finally(() => {
      // 실패한 Promise를 남기면 자산이 나중에 등록돼도 모든 재시도가 같은 실패를 받는다.
      this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  /** 하나가 실패해도 나머지는 살린다 — 소리 하나 없다고 공연을 막지 않는다. */
  async preload(keys: string[]): Promise<void> {
    await Promise.all(
      [...new Set(keys)].map((k) =>
        this.load(k).catch((e) => {
          console.warn('[audio] 소리를 불러오지 못했어요:', k, e);
        }),
      ),
    );
  }

  /** 같은 자산에 새로 녹음했을 때. 캐시를 비우지 않으면 예전 소리가 계속 난다. */
  forget(key: string): void {
    this.buffers.delete(key);
    this.inflight.delete(key);
  }

  put(key: string, buf: AudioBuffer): void {
    this.buffers.set(key, buf);
    this.inflight.delete(key);
  }

  clear(): void {
    this.buffers.clear();
    this.inflight.clear();
  }
}
