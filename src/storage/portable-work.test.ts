import { describe, expect, it } from 'vitest';
import { createWork } from '../work-model/defaults';
import { toPortableWork } from './portable-work';

describe('공개 작품 자산', () => {
  it('기기 전용 키는 빼고 다른 기기에서 쓸 원격 경로는 보존한다', () => {
    const work = createWork({ authorNick: '테스터' });
    work.assets = [{
      id: 'sound01',
      kind: 'sound',
      mimeType: 'audio/wav',
      size: 1234,
      hash: 'abc123',
      durationMs: 800,
      localKey: `${work.id}/sound01`,
      remotePath: `works/${work.id}/sound/sound01.wav`,
    }];

    const portable = toPortableWork(work);

    expect(portable.assets[0]).not.toHaveProperty('localKey');
    expect(portable.assets[0].remotePath).toBe(`works/${work.id}/sound/sound01.wav`);
    expect(work.assets[0]).toHaveProperty('localKey');
  });

  it('중첩된 선택 필드의 undefined도 Firestore 문서에서 제거한다', () => {
    const work = createWork({ authorNick: '테스터' });
    work.secrets = [{
      id: 'secret01',
      trigger: { kind: 'pressCount', key: 0, count: 3 },
      reveal: { kind: 'sound', assetId: undefined },
    }];

    const portable = toPortableWork(work);

    expect(portable.secrets[0].reveal).not.toHaveProperty('assetId');
    expect(work.secrets[0].reveal).toHaveProperty('assetId');
  });
});
