/**
 * 흔적의 데이터 경로 (v2.5).
 *
 * v1.5의 비밀이 겪은 실패를 그대로 물려받을 자리가 여기다. 직접 그린 스탬프는
 * **키의 그림도 소리도 아닌 세 번째 자산 참조**라서, 자산을 훑는 코드가 하나라도
 * 이 자리를 모르면 조용히 끊긴다:
 *   - parseWork가 `trace.assetId`를 안 읽으면 남의 기기에서 스탬프가 사라진다
 *   - isAssetReferenced가 이 자리를 모르면 normalizeWork가 업로드 직전에 그림을 지운다
 *   - 둘 다 화면에는 아무 오류도 안 낸다
 *
 * 그리고 `behavior`는 v2.5 이전 문서에 아예 없는 필드다. 없을 때 무엇이 되는지를
 * 못 박아 두지 않으면, 옛 작품이 어느 날 갑자기 다르게 재생된다.
 */

import { describe, expect, it } from 'vitest';
import { createWork } from './defaults';
import { parseWork, serializeWork } from './serialize';
import { isAssetReferenced, normalizeWork, validateWork } from './validate';
import type { AssetRef, KeyDef, Work } from './types';

function art(id: string): AssetRef {
  return { id, kind: 'art', mimeType: 'image/png', size: 100, hash: 'h' };
}

function workWithTrace(trace: Partial<KeyDef['trace']>, assets: AssetRef[] = []): Work {
  const work = createWork({ authorNick: '테스터' });
  work.keys[0] = { ...work.keys[0], trace: { ...work.keys[0].trace, ...trace } };
  work.assets = assets;
  return work;
}

describe('parseWork — 흔적 되살리기', () => {
  it('저장했다 읽으면 종류·색·행동·그림이 그대로 돌아온다', () => {
    const work = workWithTrace(
      { type: 'flower@1', color: '#B98CFF', behavior: 'grow', assetId: null },
    );

    const parsed = parseWork(JSON.parse(serializeWork(work)));

    expect(parsed?.keys[0].trace).toEqual({
      type: 'flower@1',
      color: '#B98CFF',
      behavior: 'grow',
      assetId: null,
    });
  });

  it('직접 그린 스탬프의 그림 참조가 살아남는다', () => {
    const work = workWithTrace({ type: 'myStamp@1', assetId: 'stamp001' }, [art('stamp001')]);

    const parsed = parseWork(JSON.parse(serializeWork(work)));

    expect(parsed?.keys[0].trace.type).toBe('myStamp@1');
    expect(parsed?.keys[0].trace.assetId).toBe('stamp001');
  });

  it('v2.5 이전 문서(behavior 없음)는 v1.6이 하던 그대로 사라지는 흔적이 된다', () => {
    const work = workWithTrace({ type: 'catPaw@1' });
    const raw = JSON.parse(serializeWork(work));
    delete raw.keys[0].trace.behavior;
    delete raw.keys[0].trace.assetId;

    const parsed = parseWork(raw);

    expect(parsed?.keys[0].trace.behavior).toBe('fade');
    expect(parsed?.keys[0].trace.assetId).toBeNull();
  });

  it('모르는 행동은 fade로 떨어진다 — animation-duration이 undefined가 되면 안 된다', () => {
    const raw = JSON.parse(serializeWork(workWithTrace({ type: 'star@1' })));
    raw.keys[0].trace.behavior = 'teleport';

    expect(parseWork(raw)?.keys[0].trace.behavior).toBe('fade');
  });

  it('모르는 흔적 종류는 none으로 떨어진다', () => {
    const raw = JSON.parse(serializeWork(workWithTrace({ type: 'catPaw@1' })));
    raw.keys[0].trace.type = 'dragon@9';

    expect(parseWork(raw)?.keys[0].trace.type).toBe('none');
  });
});

describe('스탬프 그림은 참조된 자산이다', () => {
  it('isAssetReferenced가 trace.assetId를 센다', () => {
    const work = workWithTrace({ type: 'myStamp@1', assetId: 'stamp001' }, [art('stamp001')]);
    expect(isAssetReferenced(work, 'stamp001')).toBe(true);
  });

  it('normalizeWork가 스탬프 그림을 지우지 않는다', () => {
    // 이 시험이 깨지면 업로드 직전에 그림이 사라져, 남의 기기에서 흔적이 안 보인다.
    const work = workWithTrace({ type: 'myStamp@1', assetId: 'stamp001' }, [art('stamp001')]);

    expect(normalizeWork(work).assets.map((a) => a.id)).toEqual(['stamp001']);
  });

  it('흔적 종류를 바꿔도 그려 둔 그림은 남는다', () => {
    /*
     * 아이가 발자국을 잠깐 써 보고 돌아왔을 때 그린 것이 그대로 있어야 한다.
     * assetId를 지우지 않는 대신, 그 자산은 계속 참조된 것으로 친다.
     */
    const work = workWithTrace({ type: 'catPaw@1', assetId: 'stamp001' }, [art('stamp001')]);

    expect(normalizeWork(work).assets).toHaveLength(1);
  });

  it('아무도 안 쓰는 그림은 여전히 버려진다', () => {
    const work = workWithTrace({ type: 'none', assetId: null }, [art('orphan1')]);
    expect(normalizeWork(work).assets).toHaveLength(0);
  });
});

describe('validateWork — 흔적', () => {
  it('없는 그림을 가리키면 막는다', () => {
    const work = workWithTrace({ type: 'myStamp@1', assetId: 'gone' });

    expect(validateWork(work).map((e) => e.field)).toContain('keys[0].trace.assetId');
  });

  it('아직 안 그린 스탬프는 막지 않는다 — 그냥 아무것도 안 찍힐 뿐이다', () => {
    const work = workWithTrace({ type: 'myStamp@1', assetId: null });

    expect(validateWork(work)).toEqual([]);
  });
});
