/**
 * 처음 만드는 사람에게 "키크 사용법"을 먼저 보여줄지.
 *
 * 지금까지는 홈의 [새로 만들기]가 곧장 꾸미기 화면으로 데려갔고, 사용법은
 * 프로필 메뉴 안 [앱 사용법]에만 있어 처음 온 사람은 존재조차 몰랐다. 그 결과
 * 무엇을 꾸며야 하는지도, 무대 다음의 "공연"이 실제로 녹화라는 것도 모른 채
 * 공연 화면까지 가서 아무것도 누르지 않거나 끝나갈 때야 몇 번 눌러 보는
 * 일이 반복됐다. 한 번이라도 사용법을 보고 나면 그다음부터는 곧장 만들기로
 * 보낸다 — 매번 가로막으면 그건 안내가 아니라 방해다.
 */

const KEY = 'keyc.first-guide-seen.v1';

export function hasSeenAppGuide(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // 사생활 보호 모드 등 저장소를 못 읽는 환경. 매번 사용법부터 보여줘도 해는 없다.
    return false;
  }
}

export function markAppGuideSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // 저장을 못 해도 이번 방문은 이미 사용법을 봤으니 그냥 진행한다.
  }
}
