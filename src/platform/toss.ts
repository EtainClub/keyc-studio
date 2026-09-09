/**
 * 지금 화면이 토스 미니앱 웹뷰 안에서 도는지.
 *
 * 토스는 웹뷰 위에 자기 내비게이션 바를 얹고, 거기에 뒤로가기가 이미 있다.
 * 그래서 화면 왼쪽 위에 우리 뒤로가기까지 그리면 같은 자리에 뒤로가기가
 * 둘이 된다 — 실제로 심사에서 "중복된 버튼을 제거해 주세요"로 반려됐다.
 * 이 판정으로 **우리 쪽 뒤로가기만** 감춘다(웹에서는 그대로 둔다. 브라우저
 * 뒤로가기는 탭 전체를 떠나는 버튼이라 화면 안 이동을 대신하지 못한다).
 *
 * 판정은 네 가지를 차례로 본다. 하나라도 맞으면 토스다 — 못 알아보는 쪽이
 * 알아보는 쪽보다 비싸다(못 알아보면 뒤로가기가 둘로 보이고 반려된다).
 *
 *   1. `__TOSS_BUILD__` — 토스 산출물로 빌드했으면 무조건 토스 안이다.
 *      이 번들은 앱 밖에서 열릴 일이 없다. 아래 셋은 전부 실행 중 감지라
 *      타이밍을 탄다. 이게 유일하게 틀릴 수 없는 신호다.
 *   2. `ReactNativeWebView` — 토스 앱이 웹뷰에 심는 다리. 문서 로드 전에 붙는다.
 *   3. `getOperationalEnvironment()` — 상수 브리지. 앱·샌드박스 밖에서는 던진다.
 *   4. 호스트명 — 위가 다 실패해도 origin은 토스 것이다.
 */
import { getOperationalEnvironment } from '@apps-in-toss/web-framework';

/** 토스가 미니앱을 띄우는 origin. 예: `key-studio.apps.tossmini.app` */
export function isTossHostname(hostname: string): boolean {
  return hostname.trim().toLowerCase().endsWith('.apps.tossmini.app');
}

let cached: boolean | undefined;

/** 호스트는 실행 중에 바뀌지 않는다 — 한 번만 판정하고 재사용한다. */
export function isTossApp(): boolean {
  cached ??= detect();
  return cached;
}

function detect(): boolean {
  if (__TOSS_BUILD__) return true;
  if (typeof window === 'undefined') return false;
  if ('ReactNativeWebView' in window) return true;
  try {
    getOperationalEnvironment();
    return true;
  } catch {
    return isTossHostname(window.location.hostname);
  }
}
