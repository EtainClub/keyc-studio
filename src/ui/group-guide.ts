/**
 * 그룹 안내 모달을 언제 띄울지.
 *
 * 그룹 기능은 **기능만 있고 설명이 없어서** 거의 쓰이지 않았다. [그룹] 탭을 눌러도
 * "아직 참여한 그룹이 없어요"와 버튼 두 개가 전부라, 이게 무엇에 쓰는 물건인지
 * 알아내려면 일단 방부터 만들어 봐야 했다. 그래서 탭에 처음 들어온 사람에게는
 * 한 번, 화면을 덮어서 설명한다.
 *
 * 규칙은 둘이다:
 *   · **한 세션에 한 번.** 탭을 오갈 때마다 뜨면 그건 안내가 아니라 방해다.
 *     이 판단은 모듈 변수에 둔다 — 새로고침하면 다시 뜨는 것이 맞다.
 *   · **"다음에 보지 않기"는 영구적이다.** localStorage에 남기고, 그 뒤로는
 *     자동으로 뜨지 않는다. 대신 화면에 남는 [그룹 활용법] 버튼으로 언제든 다시 연다 —
 *     한 번 닫으면 영영 못 보는 안내는 만들지 않는다.
 */

const KEY = 'keyc.group-guide-dismissed.v1';

let shownThisSession = false;

export function isGroupGuideDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // 사생활 보호 모드 등 저장소를 못 읽는 환경. 세션 안에서만 기억한다.
    return false;
  }
}

export function dismissGroupGuide(): void {
  shownThisSession = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // 저장을 못 해도 이번 세션에는 다시 뜨지 않는다(shownThisSession).
  }
}

/** 지금 자동으로 띄워야 하는가. 부르는 쪽이 실제로 띄웠으면 markGroupGuideShown을 함께 부른다. */
export function shouldAutoShowGroupGuide(): boolean {
  return !shownThisSession && !isGroupGuideDismissed();
}

export function markGroupGuideShown(): void {
  shownThisSession = true;
}

/** 테스트 전용 — 모듈 변수를 되돌린다. */
export function resetGroupGuideSession(): void {
  shownThisSession = false;
}
