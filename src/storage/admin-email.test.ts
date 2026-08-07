/**
 * 관리자 이메일 판정.
 *
 * 이 함수 하나가 두 가지를 가른다: 사진에서 선을 딸 수 있는가, 그 그림을 공유할 수 있는가.
 * 대소문자나 공백 때문에 관리자가 자기 기능을 못 쓰는 일이 없어야 하고,
 * 반대로 비슷한 주소가 통과해서도 안 된다.
 */

import { describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, isAdminEmail } from './firebase';

describe('isAdminEmail', () => {
  it('관리자 주소를 알아본다', () => {
    expect(isAdminEmail(ADMIN_EMAIL)).toBe(true);
  });

  it('대소문자와 앞뒤 공백은 무시한다 — 로그인 제공자가 그대로 주지 않을 수 있다', () => {
    expect(isAdminEmail('  EtainClub@Gmail.com ')).toBe(true);
  });

  it('이메일이 없는 계정(익명)은 관리자가 아니다', () => {
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail('')).toBe(false);
  });

  it('비슷하지만 다른 주소는 통과시키지 않는다', () => {
    expect(isAdminEmail('etainclub@gmail.com.attacker.test')).toBe(false);
    expect(isAdminEmail('etainclub@googlemail.com')).toBe(false);
    expect(isAdminEmail('xetainclub@gmail.com')).toBe(false);
    expect(isAdminEmail('etainclub+alias@gmail.com')).toBe(false);
  });
});
