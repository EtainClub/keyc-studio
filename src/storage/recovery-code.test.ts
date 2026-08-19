/**
 * 복구 코드 형식. 서버(functions/index.js)의 규칙과 같은 것을 지키는지 본다.
 *
 * Firebase를 하나도 세우지 않고 도는 테스트여야 한다 — 그래야 실제로 돌린다.
 * 그러려고 형식 규칙만 `recovery-code.ts`로 떼어 놓았다.
 */

import { describe, expect, it } from 'vitest';
import {
  formatRecoveryCode,
  isCompleteRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_LENGTH,
} from './recovery-code';

const VALID = 'ABCDEFGHJKMNPQR2';

describe('normalizeRecoveryCode', () => {
  it('대문자로 올리고 하이픈·공백을 지운다', () => {
    expect(normalizeRecoveryCode(' abcd-efgh jkmn-pqr2 ')).toBe(VALID);
  });

  it('16자를 넘기면 잘라낸다', () => {
    expect(normalizeRecoveryCode(`${VALID}ZZZZ`)).toHaveLength(RECOVERY_CODE_LENGTH);
  });

  it('헷갈리는 글자를 다른 글자로 바꾸지 않는다 — 틀린 코드는 틀린 채로 둔다', () => {
    // 0, O, 1, I, L은 알파벳 밖이다. 조용히 O→0 같은 교정을 하면, 정말로 틀린
    // 코드를 넣은 사람이 "왜 안 되지"만 반복하게 된다.
    expect(normalizeRecoveryCode('0O1IL')).toBe('0O1IL');
    expect(isCompleteRecoveryCode('0O1ILEFGHJKMNPQR')).toBe(false);
  });
});

describe('isCompleteRecoveryCode', () => {
  it('길이와 알파벳을 모두 만족해야 참이다', () => {
    expect(isCompleteRecoveryCode(VALID)).toBe(true);
    expect(isCompleteRecoveryCode(VALID.slice(0, 15))).toBe(false);
    expect(isCompleteRecoveryCode('abcd-efgh-jkmn-pqr2')).toBe(true);
  });
});

describe('formatRecoveryCode', () => {
  it('4-4-4-4로 끊는다', () => {
    expect(formatRecoveryCode(VALID)).toBe('ABCD-EFGH-JKMN-PQR2');
  });

  it('짧은 값도 깨지지 않는다', () => {
    expect(formatRecoveryCode('AB')).toBe('AB');
    expect(formatRecoveryCode('')).toBe('');
  });
});
