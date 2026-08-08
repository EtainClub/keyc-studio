/**
 * works 문서에 정렬용 replayCount를 채워 넣는 일회성 스크립트.
 *
 * ── 왜 필요한가 ──
 * 인기순 정렬은 works.replayCount로 orderBy 한다. Firestore는 **정렬 필드가 없는
 * 문서를 결과에서 통째로 빼버린다.** 그래서 이 필드가 생기기 전에 공개된 작품은
 * 이걸 돌리기 전까지 "많이 들은 순"에 아예 나타나지 않는다.
 *
 * 값은 집계 원본인 workStats/{id}.plays에서 가져오고, 없으면 0으로 둔다.
 *
 * ── 실행 ──
 *   cd functions
 *   GOOGLE_CLOUD_PROJECT=keyc-studio node scripts/backfill-replay-count.mjs
 *
 * 로그인은 `gcloud auth application-default login` 또는 서비스 계정 키
 * (GOOGLE_APPLICATION_CREDENTIALS)로 한다.
 *
 * 여러 번 돌려도 안전하다 — 이미 값이 있는 문서는 건드리지 않는다.
 * 확인만 하고 싶으면 --dry-run을 붙인다.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const dryRun = process.argv.includes('--dry-run');
const BATCH = 200;

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

async function main() {
  const snap = await db.collection('works').get();
  console.log(`작품 ${snap.size}개를 확인합니다${dryRun ? ' (미리보기)' : ''}`);

  const targets = snap.docs.filter((doc) => typeof doc.data().replayCount !== 'number');
  console.log(`그중 replayCount가 없는 문서: ${targets.length}개`);
  if (targets.length === 0) return;

  // 재생 수는 집계 원본에서 가져온다. 한 번에 500개까지만 getAll 할 수 있다.
  const plays = new Map();
  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    const stats = await db.getAll(
      ...slice.map((doc) => db.collection('workStats').doc(doc.id)),
    );
    for (const stat of stats) {
      const value = Number(stat.data()?.plays);
      plays.set(stat.id, Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
    }
  }

  if (dryRun) {
    for (const doc of targets) {
      console.log(`  ${doc.id} → ${plays.get(doc.id) ?? 0}`);
    }
    console.log('미리보기라 아무것도 쓰지 않았습니다.');
    return;
  }

  let written = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = db.batch();
    for (const doc of targets.slice(i, i + BATCH)) {
      batch.update(doc.ref, { replayCount: plays.get(doc.id) ?? 0 });
    }
    await batch.commit();
    written += Math.min(BATCH, targets.length - i);
    console.log(`  ${written}/${targets.length} 완료`);
  }
  console.log('끝났습니다. 이제 인기순 정렬에 모든 작품이 포함됩니다.');
}

main().catch((error) => {
  console.error('실패했습니다', error);
  process.exitCode = 1;
});
