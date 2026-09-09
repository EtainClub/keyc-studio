import { describe, expect, it } from 'vitest';
import { isTossApp, isTossHostname } from './toss';

describe('isTossHostname', () => {
  it('토스가 띄우는 호스트를 알아본다', () => {
    expect(isTossHostname('key-studio.apps.tossmini.app')).toBe(true);
    expect(isTossHostname('KEY-STUDIO.APPS.TOSSMINI.APP')).toBe(true);
  });

  it('우리 공개 도메인과 로컬은 토스가 아니다', () => {
    expect(isTossHostname('keyc.studio')).toBe(false);
    expect(isTossHostname('localhost')).toBe(false);
    expect(isTossHostname('keyc-studio.web.app')).toBe(false);
  });

  it('앞자리만 닮은 이름에 속지 않는다 — 뒤로가기가 통째로 사라진다', () => {
    expect(isTossHostname('apps.tossmini.app.evil.test')).toBe(false);
    expect(isTossHostname('notapps.tossmini.appx')).toBe(false);
  });
});

describe('isTossApp', () => {
  it('브리지도 window도 없으면 그냥 웹이다', () => {
    // vitest는 node 환경이라 window가 없다 — 브리지 호출이 던져도 죽지 않아야 한다.
    expect(isTossApp()).toBe(false);
  });
});
