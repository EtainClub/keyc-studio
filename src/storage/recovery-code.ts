/**
 * 복구 코드의 **형식**만 다루는 곳. 네트워크도 Firebase도 모른다.
 *
 * `recovery.ts`에서 떼어낸 이유는 하나다: 이 규칙들(길이, 알파벳, 끊어 보이기)은
 * 서버와 정확히 같아야 하는데, 확인하려고 Firebase SDK와 callable을 통째로
 * 가짜로 세워야 한다면 아무도 확인하지 않게 된다.
 */

/** 서버(functions/index.js: RECOVERY_CODE_LENGTH)와 같은 값이어야 한다. */
export const RECOVERY_CODE_LENGTH = 16;

/**
 * 입장 코드와 같은 알파벳 — Crockford Base32에서 0/O, 1/I/L을 뺐다.
 * 눈으로 옮겨 적고 입으로 불러 주는 물건이라 헷갈리는 글자가 있으면 안 된다.
 */
export const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 입력 정규화 — 대문자로 올리고 영숫자가 아닌 것(하이픈·공백)을 지운다.
 *
 * 알파벳 밖의 글자(0, O, 1, I, L)를 **다른 글자로 바꾸지 않는다.** 조용히 고치면
 * 정작 틀린 코드를 넣고도 왜 안 되는지 알 수 없게 된다. 판정은 언제나 서버가 한다.
 * (`groups.ts`의 normalizeJoinCode와 같은 판단이다.)
 */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, RECOVERY_CODE_LENGTH);
}

/** 16자를 4-4-4-4로 끊는다. 한 덩어리로 두면 옮겨 적다가 반드시 한 글자를 흘린다. */
export function formatRecoveryCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

/** 서버가 받아들일 모양인가. 버튼을 언제 열지 정하는 데만 쓴다. */
export function isCompleteRecoveryCode(code: string): boolean {
  const normalized = normalizeRecoveryCode(code);
  return (
    normalized.length === RECOVERY_CODE_LENGTH &&
    [...normalized].every((ch) => RECOVERY_ALPHABET.includes(ch))
  );
}
