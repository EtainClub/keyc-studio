/**
 * 비밀 반응의 데이터 경로.
 *
 * 화면보다 이쪽이 먼저다. 비밀은 **만든 기기를 떠났다가 남의 기기에서 되살아나야**
 * 의미가 있는데, v1.5 이전에는 그 경로가 세 군데에서 끊겨 있었다:
 *   - parseWork가 secrets를 통째로 버렸다(`secrets: []` 하드코딩)
 *   - isAssetReferenced가 keys만 봐서, 비밀에만 붙은 자산을 normalizeWork가 지웠다
 *   - 자산이 빠져도 비밀은 남아 "열리지 않는 비밀"이 됐다
 *
 * 여기 있는 시험은 전부 그 세 가지가 다시 끊기는 것을 막기 위한 것이다.
 */

import { describe, expect, it } from 'vitest';
import { createWork, newSecretId } from './defaults';
import { parseWork, serializeWork } from './serialize';
import { isAssetReferenced, normalizeWork, validateWork } from './validate';
import {
  SECRETS_MAX,
  SECRET_COUNT_MAX,
  SECRET_COUNT_MIN,
  type AssetRef,
  type Secret,
  type Work,
} from './types';

function art(id: string): AssetRef {
  return { id, kind: 'art', mimeType: 'image/png', size: 100, hash: 'h' };
}

function secret(over: Partial<Secret> = {}): Secret {
  return {
    id: 'sec001',
    trigger: { kind: 'pressCount', key: 0, count: 5 },
    reveal: { kind: 'led' },
    ...over,
  };
}

function workWith(secrets: Secret[], assets: AssetRef[] = []): Work {
  const work = createWork({ authorNick: '테스터' });
  work.secrets = secrets;
  work.assets = assets;
  return work;
}

describe('parseWork — 비밀 되살리기', () => {
  it('저장했다 읽으면 비밀이 그대로 돌아온다', () => {
    const work = workWith([secret({ trigger: { kind: 'pressCount', key: 2, count: 7 } })]);

    const parsed = parseWork(JSON.parse(serializeWork(work)));

    expect(parsed?.secrets).toHaveLength(1);
    expect(parsed?.secrets[0].trigger).toEqual({ kind: 'pressCount', key: 2, count: 7 });
  });

  it('모르는 조건은 통째로 버린다', () => {
    // 열 방법이 없는 비밀이 남으면 "비밀 1개 있어요"에는 잡히면서 영영 안 열린다.
    const parsed = parseWork({
      ...workWith([]),
      secrets: [{ id: 'x', trigger: { kind: 'shake', key: 0 }, reveal: { kind: 'led' } }],
    });

    expect(parsed?.secrets).toEqual([]);
  });

  it('키 번호가 범위 밖이면 버린다', () => {
    const parsed = parseWork({
      ...workWith([]),
      secrets: [{ id: 'x', trigger: { kind: 'pressCount', key: 9, count: 5 }, reveal: {} }],
    });

    expect(parsed?.secrets).toEqual([]);
  });

  it('누름 횟수는 범위 안으로 당긴다', () => {
    const parsed = parseWork({
      ...workWith([]),
      secrets: [
        { id: 'a', trigger: { kind: 'pressCount', key: 0, count: 1 }, reveal: { kind: 'led' } },
        { id: 'b', trigger: { kind: 'pressCount', key: 1, count: 999 }, reveal: { kind: 'led' } },
      ],
    });

    expect(parsed?.secrets[0].trigger.count).toBe(SECRET_COUNT_MIN);
    expect(parsed?.secrets[1].trigger.count).toBe(SECRET_COUNT_MAX);
  });

  it('개수 상한을 넘으면 앞에서부터만 남긴다', () => {
    const many = Array.from({ length: SECRETS_MAX + 3 }, (_, i) =>
      secret({ id: `s${i}` }),
    );

    const parsed = parseWork({ ...workWith([]), secrets: many });

    expect(parsed?.secrets).toHaveLength(SECRETS_MAX);
  });

  it('id가 겹치면 뒤엣것을 버린다', () => {
    // 같은 id가 둘이면 "이 비밀을 찾았는가"를 추적할 수 없다.
    const parsed = parseWork({
      ...workWith([]),
      secrets: [secret({ id: 'same' }), secret({ id: 'same' })],
    });

    expect(parsed?.secrets).toHaveLength(1);
  });

  it('모르는 결과 종류는 led로 떨어뜨린다', () => {
    const parsed = parseWork({
      ...workWith([]),
      secrets: [
        { id: 'x', trigger: { kind: 'pressCount', key: 0, count: 5 }, reveal: { kind: '폭죽' } },
      ],
    });

    expect(parsed?.secrets[0].reveal.kind).toBe('led');
  });
});

describe('normalizeWork — 비밀이 쓰는 자산', () => {
  it('비밀에만 붙어 있는 자산도 살려 둔다', () => {
    /*
     * 이게 깨지면 비밀의 그림이 업로드 직전에 사라진다.
     * 아이 화면에서는 아무 오류도 안 나고, 남의 기기에서만 안 열린다.
     */
    const work = workWith(
      [secret({ reveal: { kind: 'art', assetId: 'onlySecret' } })],
      [art('onlySecret')],
    );

    expect(isAssetReferenced(work, 'onlySecret')).toBe(true);
    expect(normalizeWork(work).assets.map((a) => a.id)).toContain('onlySecret');
  });

  it('아무 데서도 안 쓰는 자산은 여전히 버린다', () => {
    const work = workWith([secret()], [art('orphan')]);

    expect(normalizeWork(work).assets).toEqual([]);
  });

  it('상한을 넘겨 떨어져 나간 비밀의 자산까지 따라 나간다', () => {
    const kept = Array.from({ length: SECRETS_MAX }, (_, i) => secret({ id: `s${i}` }));
    const extra = secret({ id: 'over', reveal: { kind: 'art', assetId: 'overArt' } });
    const work = workWith([...kept, extra], [art('overArt')]);

    const normalized = normalizeWork(work);

    expect(normalized.secrets).toHaveLength(SECRETS_MAX);
    expect(normalized.assets).toEqual([]);
  });
});

describe('validateWork — 열리지 않는 비밀 막기', () => {
  it('자산이 없는 비밀을 오류로 잡는다', () => {
    const work = workWith([secret({ reveal: { kind: 'sound', assetId: 'gone' } })]);

    const fields = validateWork(work).map((e) => e.field);

    expect(fields).toContain('secrets[0].reveal.assetId');
  });

  it('led 결과는 자산이 없어도 정상이다', () => {
    const work = workWith([secret({ reveal: { kind: 'led' } })]);

    expect(validateWork(work)).toEqual([]);
  });

  it('개수가 상한을 넘으면 오류로 잡는다', () => {
    const work = workWith(
      Array.from({ length: SECRETS_MAX + 1 }, (_, i) => secret({ id: `s${i}` })),
    );

    expect(validateWork(work).map((e) => e.field)).toContain('secrets');
  });
});

describe('newSecretId', () => {
  it('부를 때마다 다른 값을 준다', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSecretId()));
    expect(ids.size).toBe(50);
  });
});
