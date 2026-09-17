/**
 * 배포 전 모듈 로드 스모크 테스트.
 *
 * Cloud Run 컨테이너가 기동할 때 하는 일과 같다: index.js를 import하고
 * 함수들이 실제로 export됐는지 본다. 여기서 통과하면 "Cannot find module"류의
 * 기동 실패는 배포 전에 잡힌다 — 5분짜리 배포를 돌려보고 로그를 뒤질 필요가 없다.
 */
const expected = [
  'shareMeta', 'thumb', 'avatar', 'listPublicFeed', 'recordPlay', 'unshareWork',
  // 그룹 스테이지
  'createGroup', 'getGroupCode', 'joinGroup', 'listGroupStage', 'submitToGroup',
  'fetchSharedWork', 'fetchGroupWorkFile', 'closeGroupRound', 'startNextGroupRound',
  'withdrawEntry', 'deleteGroup',
  // 익명 계정 복구
  'issueRecoveryCode', 'getRecoveryStatus', 'redeemRecoveryCode',
];

const mod = await import('./index.js');
const missing = expected.filter((n) => typeof mod[n] === 'undefined');

if (missing.length) {
  console.error('빠진 함수:', missing.join(', '));
  process.exit(1);
}
console.log(`OK — ${expected.length}개 함수 모두 로드됨:`, expected.join(', '));
process.exit(0);
