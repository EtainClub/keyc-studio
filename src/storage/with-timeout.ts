/**
 * callable 한 번에 걸어 두는 시간 제한.
 *
 * Firebase callable은 망이 반쯤 끊긴 상태에서 **영원히 매달릴 수 있다.** 그러면
 * 화면은 "…하는 중"에서 멈춘 채 아무 말도 하지 않고, 사용자는 앱이 죽은 줄 안다.
 * 실패로 끝나는 편이 낫다 — 최소한 다시 눌러볼 수 있다.
 *
 * remote.ts에도 같은 목적의 사설 헬퍼가 있지만 export하지 않는다. 그 파일은
 * work-model·storage 등 무거운 의존성을 잔뜩 끌고 다녀서, 그룹·복구처럼 가벼운
 * 모듈이 시간 제한 하나 때문에 그것을 통째로 import하게 만들 이유가 없다.
 */

import { t } from '../i18n';

/** 대부분의 callable. 서울 리전 왕복이 이보다 오래 걸리면 뭔가 잘못된 것이다. */
export const CALL_TIMEOUT_MS = 15000;

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(t('remote.timeout', { what }))), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
