/**
 * 사진 유래 태그가 살아남는지 확인한다.
 *
 * 이 태그가 한 번이라도 흘러내리면 공유 차단이 조용히 풀린다.
 * parseWork는 "모르는 필드는 버린다"가 기본이라 회귀가 나기 딱 좋은 자리다.
 */

import { describe, expect, it } from 'vitest';
import { createWork } from './defaults';
import { parseWork, serializeWork } from './serialize';
import { photoArtKeyNumbers, type AssetRef, type Work } from './types';
import { toPortableWork } from '../storage/portable-work';

function workWithPhotoArt(): Work {
  const work = createWork({ authorNick: '테스터' });
  const photo: AssetRef = {
    id: 'artphoto',
    kind: 'art',
    mimeType: 'image/png',
    size: 2048,
    hash: 'ph0t0',
    source: 'photo',
    localKey: `${work.id}/artphoto`,
  };
  const drawn: AssetRef = {
    id: 'artdrawn',
    kind: 'art',
    mimeType: 'image/png',
    size: 1024,
    hash: 'dr4wn',
    source: 'draw',
    localKey: `${work.id}/artdrawn`,
  };
  work.assets = [photo, drawn];
  work.keys[1].appearance.artAssetId = photo.id;
  work.keys[3].appearance.artAssetId = drawn.id;
  return work;
}

describe('사진 유래 자산', () => {
  it('저장하고 다시 읽어도 photo 표식이 남는다', () => {
    const parsed = parseWork(JSON.parse(serializeWork(workWithPhotoArt())));

    expect(parsed).not.toBeNull();
    expect(parsed!.assets.find((a) => a.id === 'artphoto')?.source).toBe('photo');
  });

  it('공개 문서로 옮겨도 photo 표식이 남는다', () => {
    const portable = toPortableWork(workWithPhotoArt());

    expect(portable.assets.find((a) => a.id === 'artphoto')?.source).toBe('photo');
  });

  it('사진이 붙은 키캡 번호만 1부터 세어 돌려준다', () => {
    expect(photoArtKeyNumbers(workWithPhotoArt())).toEqual([2]);
  });

  it('직접 그린 그림만 있으면 막지 않는다', () => {
    const work = workWithPhotoArt();
    work.keys[1].appearance.artAssetId = null;

    expect(photoArtKeyNumbers(work)).toEqual([]);
  });

  it('표식이 없는 옛 작품은 직접 그린 것으로 본다', () => {
    const work = workWithPhotoArt();
    // source 필드가 생기기 전에 저장된 문서를 흉내낸다.
    const raw = JSON.parse(serializeWork(work));
    for (const asset of raw.assets) delete asset.source;

    const parsed = parseWork(raw);

    expect(parsed).not.toBeNull();
    expect(photoArtKeyNumbers(parsed!)).toEqual([]);
  });
});
