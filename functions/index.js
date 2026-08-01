/**
 * Cloud Functions — 여섯 개.
 *
 *  shareMeta    /w/** rewrite, OG 태그 HTML 반환 (카카오톡은 JS를 실행하지 않는다)
 *  thumb        썸네일 바이트 직접 서빙 (og:image 대상 — 크롤러는 토큰 URL을 잘 못 따라간다)
 *  avatar       공개 동의된 크리에이터 아바타의 작은 JPEG 서빙
 *  listPublicFeed 공개 작품을 최신순으로 골라 최소 메타데이터만 반환
 *  recordPlay   재생/누름 집계, App Check + 중복 방지
 *  unshareWork  문서 삭제 + Storage 자산 실제 삭제
 *
 * Functions 배포에는 Blaze 요금제 등록(결제 계정 연결)이 필요하다.
 * 초기 사용량은 무료 할당량 안에서 운영될 가능성이 높지만, 등록 자체는 필수다.
 */

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
/*
 * `firebase-functions/v2`(인덱스)에서 가져오면 안 된다.
 *
 * 그 인덱스는 **우리가 쓰지도 않는** 모든 provider를 eager require 하는데, 그중
 * database provider가 firebase-admin의 RTDB 모듈 → @firebase/database-compat →
 * @firebase/app 으로 이어진다. @firebase/app은 optional peerDependency라 npm이
 * 자동 설치하지 않고, 그래서 배포된 컨테이너가 기동 중 죽는다:
 *
 *   Error: Cannot find module '@firebase/app'
 *     at .../@firebase/database-compat/dist/index.standalone.js
 *     ← firebase-functions/lib/v2/index.js
 *
 * 좁은 서브패스로 가져오면 그 체인 자체가 로드되지 않는다. 콜드 스타트도 빨라진다.
 */
import { setGlobalOptions } from 'firebase-functions/v2/options';

initializeApp();

// 사용자가 한국에 있다. 서울 리전이 왕복 지연을 가장 줄인다.
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 });

const db = getFirestore();
const WORK_ID = /^[A-Za-z0-9_-]{12}$/;

/**
 * App Check 강제 여부.
 *
 * 켜는 것이 옳지만, **App Check를 콘솔에 등록하고 클라이언트에서 초기화하기 전에
 * 켜면 모든 호출이 거부된다.** 그러면 재생 집계와 공유 중단이 조용히 죽는다.
 * 그래서 기본값은 꺼짐이고, App Check 설정을 마친 뒤 아래 환경변수로 켠다:
 *
 *   firebase functions:config 대신 .env 사용 →  functions/.env 에
 *   ENFORCE_APP_CHECK=true
 *
 * 일반 공개 전에 반드시 켤 것.
 */
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function isExpired(data) {
  return typeof data.expiresAt === 'number' && data.expiresAt > 0 && Date.now() > data.expiresAt;
}

/* ── shareMeta ─────────────────────────────────────── */

/**
 * SPA 껍데기를 가져와 head에 OG 태그를 끼워 넣는다.
 * /index.html 은 rewrite 대상이 아니므로 정적 파일이 그대로 나온다.
 * 사람이 들어와도 앱이 정상 동작하고, 크롤러는 메타태그를 얻는다.
 */
let shellCache = null;
let shellFetchedAt = 0;
const SHELL_TTL_MS = 5 * 60 * 1000;

async function loadShell(origin) {
  const now = Date.now();
  if (shellCache && now - shellFetchedAt < SHELL_TTL_MS) return shellCache;
  try {
    const res = await fetch(`${origin}/index.html`, { redirect: 'follow' });
    if (res.ok) {
      shellCache = await res.text();
      shellFetchedAt = now;
    }
  } catch (e) {
    console.warn('index.html을 가져오지 못했습니다', e);
  }
  return shellCache;
}

function metaTags({ title, description, image, imageAlt, url }) {
  return [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="ko_KR" />`,
    `<meta property="og:site_name" content="키크" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:secure_url" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<title>${escapeHtml(title)}</title>`,
  ].join('\n    ');
}

function fallbackHtml(meta) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${meta}
  </head>
  <body>
    <p>작품을 여는 중 문제가 생겼어요. <a href="/">홈으로 가기</a></p>
  </body>
</html>`;
}

export const shareMeta = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const workId = (req.path || '').split('/').filter(Boolean).pop() || '';
  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  const url = `${origin}/w/${workId}`;

  let title = '키크';
  let description = '나만의 키캡에 그림과 소리를 담아 만든 15초 공연. 눌러서 들어보세요.';
  let image = `${origin}/og-default.jpg`;
  let imageAlt = '빛나는 네 개의 키캡으로 만든 키크 공연';

  if (WORK_ID.test(workId)) {
    try {
      const snap = await db.collection('works').doc(workId).get();
      const data = snap.exists ? snap.data() : null;
      if (data && data.visibility === 'link' && !isExpired(data)) {
        title = data.title ? `${data.title} — 키크` : '키크';
        description = data.hint || `${data.authorNick || '친구'}가 만든 15초 공연이에요`;
        image = `${origin}/thumb/${workId}`;
        imageAlt = `${data.title || '이름 없는 작품'} 키캡 공연 미리보기`;
      }
    } catch (e) {
      console.warn('작품을 읽지 못했습니다', workId, e);
    }
  }

  // 공유 작품은 Storage 다운로드 URL 대신 썸네일 함수를, 나머지는 기본 이미지를 쓴다.
  const meta = metaTags({ title, description, image, imageAlt, url });
  const shell = await loadShell(origin);

  // 카카오톡 미리보기 봇은 캐시가 강하다. 짧게 잡아 수정이 반영되게 한다.
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.set('Content-Type', 'text/html; charset=utf-8');

  if (!shell) {
    res.status(200).send(fallbackHtml(meta));
    return;
  }
  const cleaned = shell
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/<meta\s+name="(?:description|twitter:[^"]*)"[^>]*>/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>/gi, '');
  res.status(200).send(cleaned.replace(/<\/head>/i, `    ${meta}\n  </head>`));
});

/* ── thumb ─────────────────────────────────────────── */

/**
 * 썸네일을 바이트로 직접 준다.
 * 카카오톡 크롤러가 Storage의 토큰 URL·리다이렉트를 잘 못 따라가는 사례가 많아서,
 * og:image는 이 경로를 가리킨다. 공유 중이 아닌 작품은 404.
 */
export const thumb = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const workId = (req.path || '').split('/').filter(Boolean).pop() || '';
  if (!WORK_ID.test(workId)) {
    res.status(404).send('not found');
    return;
  }
  try {
    const snap = await db.collection('works').doc(workId).get();
    const data = snap.exists ? snap.data() : null;
    if (!data || data.visibility !== 'link' || isExpired(data)) {
      res.status(404).send('not found');
      return;
    }
    const file = getStorage().bucket().file(`works/${workId}/thumb.jpg`);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).send('not found');
      return;
    }
    const [buf] = await file.download();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.status(200).end(buf);
  } catch (e) {
    console.warn('썸네일 서빙 실패', workId, e);
    res.status(404).send('not found');
  }
});

/* ── public avatar ───────────────────────────────── */

/**
 * 공개 작품 ID를 통해서만 128px 아바타를 준다. 응답 URL에 authorUid를 넣지 않고,
 * 작품 공개 상태와 프로필의 명시적 동의를 매번 확인한다.
 */
export const avatar = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const workId = (req.path || '').split('/').filter(Boolean).pop() || '';
  if (!WORK_ID.test(workId)) {
    res.status(404).send('not found');
    return;
  }
  try {
    const workSnap = await db.collection('works').doc(workId).get();
    const work = workSnap.exists ? workSnap.data() : null;
    if (
      !work ||
      work.visibility !== 'link' ||
      work.discoverable !== true ||
      isExpired(work) ||
      typeof work.authorUid !== 'string'
    ) {
      res.status(404).send('not found');
      return;
    }
    const profileSnap = await db.collection('publicProfiles').doc(work.authorUid).get();
    if (!profileSnap.exists || profileSnap.data()?.enabled !== true) {
      res.status(404).send('not found');
      return;
    }
    const file = getStorage().bucket().file(`publicProfiles/${work.authorUid}/avatar.jpg`);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).send('not found');
      return;
    }
    const [buf] = await file.download();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.status(200).end(buf);
  } catch (error) {
    console.warn('공개 아바타 서빙 실패', workId, error);
    res.status(404).send('not found');
  }
});

/* ── public feed ───────────────────────────────────── */

const PUBLIC_FEED_LIMIT = 24;
const PUBLIC_FEED_SCAN_LIMIT = 72;

/**
 * 공개 피드. 현재 공개 안내에 동의해 discoverable:true가 된 작품만 조회한다.
 * Admin SDK로 works를 조회하되 문서 전체를 클라이언트에 돌려주지 않는다.
 * uid, 자산 경로, 키 설정, 리플레이 이벤트는 카드 목록에 필요 없으므로 제거한다.
 */
export const listPublicFeed = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async () => {
    try {
      const snap = await db
        .collection('works')
        .where('visibility', '==', 'link')
        .where('discoverable', '==', true)
        .orderBy('createdAt', 'desc')
        // 만료된 작품을 거른 뒤에도 카드 24개를 채울 여유를 둔다.
        .limit(PUBLIC_FEED_SCAN_LIMIT)
        .get();

      const rows = snap.docs.flatMap((doc) => {
        const data = doc.data();
        if (isExpired(data)) return [];
        const durationMs = Number(data.replay?.durationMs);
        const createdAt = Number(data.createdAt);
        if (!Number.isFinite(durationMs) || !Number.isFinite(createdAt)) return [];
        return [{
          id: doc.id,
          title: String(data.title || '').slice(0, 20),
          hint: String(data.hint || '').slice(0, 40),
          authorNick: String(data.authorNick || '친구').slice(0, 30),
          authorUid: typeof data.authorUid === 'string' ? data.authorUid : null,
          durationMs,
          createdAt,
        }];
      });

      const authorUids = [...new Set(rows.map((item) => item.authorUid).filter(Boolean))];
      const profileSnaps = authorUids.length > 0
        ? await db.getAll(...authorUids.map((uid) => db.collection('publicProfiles').doc(uid)))
        : [];
      const avatarOwners = new Set(
        profileSnaps
          .filter((profile) => profile.exists && profile.data()?.enabled === true)
          .map((profile) => profile.id),
      );
      const items = rows.map(({ authorUid, ...item }) => ({
        ...item,
        avatarUrl: authorUid && avatarOwners.has(authorUid) ? `/avatar/${item.id}` : null,
      }));

      return { items: items.slice(0, PUBLIC_FEED_LIMIT) };
    } catch (error) {
      console.error('공개 피드를 읽지 못했습니다', error);
      throw new HttpsError('failed-precondition', '공개 피드를 준비하지 못했어요');
    }
  },
);

/* ── recordPlay ────────────────────────────────────── */

/**
 * 재생/누름 집계.
 * 호출 빈도 제한: 같은 uid가 같은 작품에 대해 1분에 한 번만 반영된다.
 * 인스턴스 메모리라 완벽하지 않지만, 무료 할당량을 태우는 연타는 이걸로 막힌다.
 */
const recent = new Map();
const WINDOW_MS = 60_000;

export const recordPlay = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

  const workId = String(request.data?.workId || '');
  if (!WORK_ID.test(workId)) {
    throw new HttpsError('invalid-argument', '작품 번호가 이상해요');
  }
  const presses = Math.max(0, Math.min(1000, Number(request.data?.presses) || 0));

  const now = Date.now();
  const key = `${uid}:${workId}`;
  if (now - (recent.get(key) || 0) < WINDOW_MS) return { ok: true, throttled: true };
  recent.set(key, now);
  if (recent.size > 5000) recent.clear();

  await db.doc(`workStats/${workId}`).set(
    {
      plays: FieldValue.increment(1),
      presses: FieldValue.increment(presses),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true };
});

/* ── unshareWork ───────────────────────────────────── */

/**
 * 공유 중단 — Storage 자산을 **실제로 지우고** 문서를 삭제한다.
 *
 * Storage 읽기를 열어 둔 대가가 이것이다. 이 삭제가 확실하지 않으면
 * "공유를 멈췄는데 파일은 남아 있는" 상태가 되고, 그건 약속 위반이다.
 */
export const unshareWork = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

  const workId = String(request.data?.workId || '');
  if (!WORK_ID.test(workId)) {
    throw new HttpsError('invalid-argument', '작품 번호가 이상해요');
  }

  const ref = db.collection('works').doc(workId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, alreadyGone: true };
  if (snap.data().authorUid !== uid) {
    throw new HttpsError('permission-denied', '내 작품이 아니에요');
  }

  // 파일을 먼저 지운다. 문서만 지우고 파일이 남는 상황을 만들지 않는다.
  await getStorage().bucket().deleteFiles({ prefix: `works/${workId}/` });
  await ref.delete();
  await db
    .doc(`workStats/${workId}`)
    .delete()
    .catch(() => {});

  return { ok: true };
});
