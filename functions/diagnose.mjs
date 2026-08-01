// 진단 확인용: 예전 import 경로가 실제로 컨테이너를 죽인 그 오류를 내는가.
try {
  await import('firebase-functions/v2');
  console.log('예전 경로도 로드됨 — 진단이 틀렸을 수 있음');
} catch (e) {
  console.log('예전 경로 실패 (예상대로):', e.message.split('\n')[0]);
}
try {
  await import('firebase-functions/v2/options');
  console.log('새 경로 로드 OK');
} catch (e) {
  console.log('새 경로도 실패:', e.message.split('\n')[0]);
}
