/**
 * 공유 링크의 origin.
 *
 * SPA 셸은 공개 도메인 밖에서도 서빙된다 — 토스 미니앱 웹뷰는 이 앱을
 * `https://key-studio.apps.tossmini.app` 같은 토스 쪽 origin에서 띄운다.
 * 그 주소는 토스 앱 안에서만 열리는 주소라, `window.location.origin`으로 링크를
 * 만들면 그 링크를 카톡·문자로 받은 사람에게는 "이 페이지가 작동하지 않습니다"만
 * 뜬다. 아이는 링크를 보냈는데 아무도 못 열었다는 사실을 나중에야 안다.
 * 그래서 공유 링크의 origin은 화면이 떠 있는 곳이 아니라 **늘 공개 도메인**이다.
 * (썸네일·아바타가 PUBLIC_ORIGIN을 가리키는 것과 같은 이유다.)
 *
 * 로컬 개발만 예외로 둔다 — 만든 링크를 그 자리에서 열어 보는 게 개발 중에는
 * 더 쓸모 있고, 그 링크가 밖으로 나갈 일은 없다.
 */

import { PUBLIC_ORIGIN } from './firebase';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/** 사설망 IP도 포함한다 — `granite dev`를 휴대폰에서 열면 192.168.x.x로 들어온다. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (LOCAL_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  return isPrivateIPv4(host);
}

/**
 * 네 자리 IPv4일 때만 본다. `192.168.evil.test`처럼 앞자리만 닮은 이름이
 * 사설망으로 통과하면, 그 도메인으로 공유 링크가 나가 버린다.
 */
function isPrivateIPv4(host: string): boolean {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!parts) return false;
  const a = Number(parts[1]);
  const b = Number(parts[2]);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  return a === 172 && b >= 16 && b <= 31;
}

export function shareOrigin(location: { origin: string; hostname: string }): string {
  return isLocalHostname(location.hostname) ? location.origin : PUBLIC_ORIGIN;
}
