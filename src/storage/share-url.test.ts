/**
 * 공유 링크 origin.
 *
 * 토스 웹뷰에서 만든 링크가 토스 밖에서 열리지 않던 사고를 막는 시험이다.
 */

import { describe, expect, it } from 'vitest';
import { PUBLIC_ORIGIN } from './firebase';
import { isLocalHostname, shareOrigin } from './share-url';

describe('shareOrigin', () => {
  it('토스 미니앱 웹뷰의 origin은 쓰지 않는다 — 토스 밖에서 열리지 않는 주소다', () => {
    expect(
      shareOrigin({ origin: 'https://key-studio.apps.tossmini.app', hostname: 'key-studio.apps.tossmini.app' }),
    ).toBe(PUBLIC_ORIGIN);
  });

  it('미리보기 채널 같은 다른 배포 origin도 공개 도메인으로 바꾼다', () => {
    expect(shareOrigin({ origin: 'https://keyc-studio--pr1.web.app', hostname: 'keyc-studio--pr1.web.app' })).toBe(
      PUBLIC_ORIGIN,
    );
  });

  it('공개 도메인에서는 그대로 공개 도메인이다', () => {
    expect(shareOrigin({ origin: PUBLIC_ORIGIN, hostname: 'keyc.studio' })).toBe(PUBLIC_ORIGIN);
  });

  it('로컬 개발에서는 지금 보고 있는 주소를 그대로 쓴다', () => {
    expect(shareOrigin({ origin: 'http://localhost:5173', hostname: 'localhost' })).toBe('http://localhost:5173');
    expect(shareOrigin({ origin: 'http://192.168.0.7:5173', hostname: '192.168.0.7' })).toBe('http://192.168.0.7:5173');
  });
});

describe('isLocalHostname', () => {
  it('로컬과 사설망을 알아본다', () => {
    expect(isLocalHostname('localhost')).toBe(true);
    expect(isLocalHostname('127.0.0.1')).toBe(true);
    expect(isLocalHostname('[::1]')).toBe(true);
    expect(isLocalHostname('macbook.local')).toBe(true);
    expect(isLocalHostname('10.0.1.5')).toBe(true);
    expect(isLocalHostname('172.16.3.9')).toBe(true);
  });

  it('공인 주소는 로컬이 아니다 — 사설망과 헷갈리기 쉬운 것들까지', () => {
    expect(isLocalHostname('keyc.studio')).toBe(false);
    expect(isLocalHostname('key-studio.apps.tossmini.app')).toBe(false);
    expect(isLocalHostname('172.32.0.1')).toBe(false);
    expect(isLocalHostname('109.0.0.1')).toBe(false);
    expect(isLocalHostname('192.168.evil.test')).toBe(false);
  });
});
