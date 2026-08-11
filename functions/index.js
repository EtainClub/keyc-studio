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
import { randomBytes } from 'node:crypto';

initializeApp();

// 사용자가 한국에 있다. 서울 리전이 왕복 지연을 가장 줄인다.
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 });

const db = getFirestore();
const WORK_ID = /^[A-Za-z0-9_-]{12}$/;
const GROUP_ID = /^[A-Za-z0-9_-]{12}$/;

/* ── 그룹 공용 ─────────────────────────────────────── */

/**
 * 입장 코드 알파벳 — Crockford Base32에서 0/O, 1/I/L을 뺐다.
 * 코드는 슬랙 공지에 붙고 회의실에서 구두로 불린다. 눈과 귀로 구분되지 않는
 * 글자가 하나라도 있으면 "코드가 안 먹어요" 문의가 그 글자 수만큼 생긴다.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const JOIN_CODE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** 무료 규모 상한. 클라이언트에도 같은 값이 있지만 판정은 여기서만 한다. */
const GROUP_MEMBER_MAX = 100;
const GROUP_ENTRY_MAX = 200;
/** 한 작품이 동시에 올라갈 수 있는 그룹 수. */
const MAX_GROUPS_PER_WORK = 3;
/** 한 계정이 만들 수 있는 그룹 수. */
const GROUPS_PER_OWNER_MAX = 3;

const groupRef = (groupId) => db.doc(`groups/${groupId}`);
const memberRef = (groupId, uid) => db.doc(`groups/${groupId}/members/${uid}`);
const entryRef = (groupId, workId) => db.doc(`groups/${groupId}/entries/${workId}`);
/**
 * 청취 기록의 문서 ID.
 *
 * **이 ID가 고정이라는 사실이 곧 1인 1표다.** 같은 사람이 같은 작품을 또 들어도
 * 같은 경로를 가리키므로 문서가 늘어나지 않는다. 판정 로직도 임계값도 없고,
 * "문서가 있느냐 없느냐"만 남는다.
 *
 * uid와 workId 모두 [A-Za-z0-9_-] 12자라 구분자 __가 두 값 안에 나타날 수 없다.
 * (Firebase uid는 28자 영숫자다 — 역시 언더스코어가 없다.)
 */
const listenRef = (groupId, workId, uid) =>
  db.doc(`groups/${groupId}/listens/${workId}__${uid}`);
/** users/{uid}/groups 미러. "내 그룹 목록"을 collectionGroup 색인 없이 읽기 위한 사본. */
const myGroupRef = (uid, groupId) => db.doc(`users/${uid}/groups/${groupId}`);
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://keyc.studio').replace(/\/+$/, '');
const UPSTREAM_TIMEOUT_MS = 3_000;

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
 *
 * ── 그룹 컨테스트를 켜기 전에는 선택이 아니다 ──
 * 순위와 상품이 걸리면 callable을 스크립트로 직접 두드릴 이유가 생긴다. App Check가
 * 꺼져 있으면 recordPlay의 표 등록을 브라우저 없이 반복 호출할 수 있다.
 * 지금(v1)은 순위가 없어 동기가 없지만, P2에서 컨테스트를 켜는 작업의 선행 조건이다.
 */
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';

/**
 * Callable은 브라우저가 OPTIONS 프리플라이트를 보낼 수 있도록 Cloud Run IAM 호출을 연다.
 * 실제 권한은 각 핸들러의 Firebase Auth 검사와 선택적인 App Check가 계속 담당한다.
 */
const CALLABLE_OPTIONS = {
  cors: true,
  invoker: 'public',
  enforceAppCheck: ENFORCE_APP_CHECK,
};

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
let shellRequest = null;
const SHELL_TTL_MS = 5 * 60 * 1000;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchShell() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${PUBLIC_ORIGIN}/index.html`, {
      redirect: 'follow',
      signal: controller.signal,
    });
    if (res.ok) {
      shellCache = await res.text();
      shellFetchedAt = Date.now();
    }
  } catch (e) {
    console.warn('index.html을 가져오지 못했습니다', e);
  } finally {
    clearTimeout(timer);
  }
  return shellCache;
}

async function loadShell() {
  const now = Date.now();
  if (shellCache && now - shellFetchedAt < SHELL_TTL_MS) return shellCache;
  if (!shellRequest) shellRequest = fetchShell().finally(() => { shellRequest = null; });
  return shellRequest;
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
  const origin = PUBLIC_ORIGIN;
  const url = `${origin}/w/${workId}`;
  const shellPromise = loadShell();

  let title = '키크';
  let description = '나만의 키캡에 그림과 소리를 담아 만든 15초 공연. 눌러서 들어보세요.';
  let image = `${origin}/og-default.jpg`;
  let imageAlt = '빛나는 네 개의 키캡으로 만든 키크 공연';

  if (WORK_ID.test(workId)) {
    try {
      const snap = await withTimeout(
        db.collection('works').doc(workId).get(),
        UPSTREAM_TIMEOUT_MS,
        `works/${workId}`,
      );
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
  const shell = await shellPromise;

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
    /*
     * 노출 자격은 "공개 피드에 떴는가"가 아니라 **"어느 스테이지든 올라가 있는가"**다.
     *
     * 그룹 전용 작품은 discoverable가 false다. 예전 조건(discoverable === true)을
     * 그대로 두면 그룹 스테이지 카드의 아바타가 **전부 404가 된다.**
     *
     * 그룹 작품까지 여는 것이 안전한 이유: 아바타는 이미 publicProfiles.enabled라는
     * 본인의 명시적 동의로 한 겹 막혀 있고, 그룹 스테이지는 '미등재' 수준이라
     * workId를 아는 사람은 어차피 작품 자체를 열 수 있다. 새로 새는 것이 없다.
     */
    const onSomeStage =
      work &&
      (work.discoverable === true ||
        (Array.isArray(work.groupIds) && work.groupIds.length > 0));
    if (
      !work ||
      work.visibility !== 'link' ||
      !onSomeStage ||
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

/** 한 번의 호출이 돌려주는 카드 수. 클라이언트가 더 줄일 수는 있어도 늘릴 수는 없다. */
const PUBLIC_FEED_PAGE = 12;
/** Firestore에서 한 번에 읽어오는 문서 수. */
const PUBLIC_FEED_BATCH = 60;
/**
 * 한 호출이 훑을 수 있는 배치 수의 상한(= 최대 300문서).
 *
 * 검색어는 Firestore 색인으로 못 거르고 읽은 뒤 걸러야 한다. 상한이 없으면
 * "아무것도 안 맞는 검색어" 하나가 컬렉션 전체를 읽어버린다.
 * 상한에 걸리면 커서를 돌려주므로, 더 보기를 누르면 이어서 훑는다 — 결과가 누락되지는 않는다.
 */
const PUBLIC_FEED_MAX_BATCHES = 5;

/**
 * 정렬 기준. 값은 works 문서의 필드 이름이다.
 *
 * 인기순이 replayCount를 쓰는 이유는 recordPlay 주석 참고 — 원본 집계는 workStats에
 * 있지만 Firestore는 다른 컬렉션 필드로 정렬하지 못한다.
 */
const FEED_SORTS = { latest: 'createdAt', popular: 'replayCount' };

/**
 * 커서는 마지막으로 **훑은** 문서를 가리킨다. 마지막으로 맞은 문서가 아니다.
 *
 * value가 무엇인지는 정렬 기준에 달렸다(만든 시각이거나 재생 수). 클라이언트는
 * 서버가 준 값을 그대로 되돌려줄 뿐이라, 여기서는 모양만 본다.
 */
function parseFeedCursor(value) {
  if (!value || typeof value !== 'object') return null;
  const at = Number(value.value);
  const id = String(value.id || '');
  if (!Number.isFinite(at) || at < 0 || !WORK_ID.test(id)) return null;
  return { value: at, id };
}

/**
 * 공개 피드. 현재 공개 안내에 동의해 discoverable:true가 된 작품만 조회한다.
 * Admin SDK로 works를 조회하되 문서 전체를 클라이언트에 돌려주지 않는다.
 * uid, 자산 경로, 키 설정, 리플레이 이벤트는 카드 목록에 필요 없으므로 제거한다.
 */
export const listPublicFeed = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const input = request.data || {};
    const limit = Math.max(1, Math.min(PUBLIC_FEED_PAGE, Number(input.limit) || PUBLIC_FEED_PAGE));
    const search = String(input.search || '').trim().toLowerCase().slice(0, 40);
    const authorNick = String(input.authorNick || '').trim().slice(0, 30);
    const sortKey = FEED_SORTS[String(input.sort || '')] || FEED_SORTS.latest;
    let cursor = parseFeedCursor(input.cursor);

    try {
      /*
       * 작성자는 Firestore가 거르고, 검색어는 읽은 뒤 거른다.
       *
       * 작성자는 등호 조건이라 색인으로 정확히 좁혀진다. 반면 제목·힌트의 부분 일치는
       * Firestore가 못 한다(전문 검색 엔진의 일이다). 그래서 훑으면서 거르되,
       * 위 MAX_BATCHES로 한 호출의 읽기량을 묶어 둔다.
       */
      let base = db
        .collection('works')
        .where('visibility', '==', 'link')
        .where('discoverable', '==', true);
      if (authorNick) base = base.where('authorNick', '==', authorNick);
      base = base.orderBy(sortKey, 'desc').orderBy('__name__', 'desc');

      const rows = [];
      let scanned = 0;
      let exhausted = false;
      /** 이번 쪽을 다 채워서 배치 중간에 멈췄는가. */
      let stoppedMidBatch = false;

      for (let batch = 0; batch < PUBLIC_FEED_MAX_BATCHES && rows.length < limit; batch++) {
        let q = base.limit(PUBLIC_FEED_BATCH);
        if (cursor) {
          q = q.startAfter(cursor.value, db.collection('works').doc(cursor.id));
        }
        const snap = await q.get();
        if (snap.empty) {
          exhausted = true;
          break;
        }

        for (const doc of snap.docs) {
          const data = doc.data();
          // 커서는 맞았는지와 무관하게 훑은 마지막 문서를 따라간다.
          // 그래야 다음 호출이 걸러진 구간을 다시 읽지 않는다.
          const createdAt = Number(data.createdAt);
          const sortValue = Number(data[sortKey]);
          if (Number.isFinite(sortValue)) cursor = { value: sortValue, id: doc.id };
          scanned++;

          if (isExpired(data)) continue;
          const durationMs = Number(data.replay?.durationMs);
          if (!Number.isFinite(durationMs) || !Number.isFinite(createdAt)) continue;

          const title = String(data.title || '').slice(0, 20);
          const hint = String(data.hint || '').slice(0, 40);
          const nick = String(data.authorNick || '친구').slice(0, 30);
          if (
            search &&
            !`${title} ${hint} ${nick}`.toLowerCase().includes(search)
          ) {
            continue;
          }

          rows.push({
            id: doc.id,
            title,
            hint,
            authorNick: nick,
            authorUid: typeof data.authorUid === 'string' ? data.authorUid : null,
            durationMs,
            createdAt,
          });
          if (rows.length >= limit) {
            stoppedMidBatch = true;
            break;
          }
        }

        /*
         * 배치를 끝까지 훑었을 때만 "다 봤다"고 말할 수 있다.
         *
         * 쪽이 다 차서 중간에 멈췄다면 이 배치의 나머지는 아직 안 본 것이다.
         * 그때 exhausted로 판정하면 커서가 null이 되어 남은 작품이 통째로 사라진다.
         * (마지막 배치가 60개 미만일 때 정확히 그 일이 난다.)
         */
        if (stoppedMidBatch) break;
        if (snap.size < PUBLIC_FEED_BATCH) {
          exhausted = true;
          break;
        }
      }

      const authorUids = [...new Set(rows.map((item) => item.authorUid).filter(Boolean))];
      const [profileSnaps, statsSnaps] = await Promise.all([
        authorUids.length > 0
          ? db.getAll(...authorUids.map((uid) => db.collection('publicProfiles').doc(uid)))
          : Promise.resolve([]),
        rows.length > 0
          ? db.getAll(...rows.map((item) => db.collection('workStats').doc(item.id)))
          : Promise.resolve([]),
      ]);
      const avatarOwners = new Set(
        profileSnaps
          .filter((profile) => profile.exists && profile.data()?.enabled === true)
          .map((profile) => profile.id),
      );
      const replayCounts = new Map(
        statsSnaps.map((stats) => {
          const plays = Number(stats.data()?.plays);
          return [
            stats.id,
            Number.isFinite(plays) && plays > 0
              ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(plays))
              : 0,
          ];
        }),
      );
      const items = rows.map(({ authorUid, ...item }) => ({
        ...item,
        avatarUrl: authorUid && avatarOwners.has(authorUid) ? `${PUBLIC_ORIGIN}/avatar/${item.id}` : null,
        replayCount: replayCounts.get(item.id) ?? 0,
      }));

      return {
        items,
        // 다 훑었으면 커서를 지운다. 그래야 클라이언트가 "더 보기"를 감춘다.
        nextCursor: exhausted ? null : cursor,
        scanned,
      };
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

/**
 * 그룹 집계 — 여기가 순위의 근거다.
 *
 * ── 왜 별도의 문서로 세는가 ──
 * FieldValue.increment는 **기억이 없는 연산**이다. 숫자에 1을 더할 뿐이라, 100번
 * 눌린 작품이 한 사람이 100번 누른 것인지 100명이 한 번씩인지 구분할 방법이
 * 원리적으로 없다. 그래서 "누가 들었는가"를 문서로 남기고, 그 문서 수를 센다.
 *
 * ── 왜 위의 메모리 throttle에 기대지 않는가 ──
 * `recent`는 함수 **인스턴스의** 메모리다. maxInstances가 10이라 인스턴스마다 따로
 * 세고 콜드 스타트마다 리셋된다. 공개 피드의 인기순에는 충분했지만 순위의 근거로는
 * 못 쓴다. 그래서 표 등록은 throttle과 무관하게 트랜잭션이 판정한다.
 *
 * @param countReplay throttle에 걸리지 않았는가. 표 등록과 달리 재생 수는 이걸 따른다.
 * @param completed   끝까지 들었는가. 0.5초 눌렀다 나간 것을 표로 세지 않기 위한 것.
 */
async function recordGroupPlay(groupId, workId, uid, { countReplay, completed }) {
  const entry = entryRef(groupId, workId);
  const member = memberRef(groupId, uid);
  const [entrySnap, memberSnap] = await db.getAll(entry, member);

  // 그룹에 올라오지 않은 작품이거나 내린 작품이면 셀 것이 없다.
  if (!entrySnap.exists || entrySnap.data().status !== 'active') {
    return { counted: false, reason: 'not-entered' };
  }
  /*
   * 멤버가 아니면 아무것도 세지 않는다.
   *
   * 그룹 스테이지는 '미등재'라 링크를 아는 외부인도 작품을 열 수 있다. 그 재생이
   * 집계에 닿으면 **링크를 뿌리는 것이 곧 표 조작**이 된다. 관람은 막지 않되
   * 순위에는 넣지 않는다.
   */
  if (!memberSnap.exists) return { counted: false, reason: 'not-member' };

  /*
   * 자기 작품은 재생 수도 표도 세지 않는다.
   *
   * 표만 빼고 재생 수를 세면, 순위 기준이 replayCount인 그룹에서 자가 재생이
   * 그대로 점수가 된다. 자기 것을 눌러 이기는 경로를 아예 남기지 않는다.
   */
  if (entrySnap.data().authorUid === uid) return { counted: false, reason: 'own-work' };

  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const listen = listenRef(groupId, workId, uid);
    const listenSnap = await tx.get(listen);

    if (countReplay) {
      tx.set(entry, { replayCount: FieldValue.increment(1), lastPlayedAt: now }, { merge: true });
    }

    // 이미 센 사람이다. 순위는 움직이지 않는다.
    if (listenSnap.exists) {
      if (countReplay) tx.update(listen, { plays: FieldValue.increment(1), lastAt: now });
      return { counted: false, reason: 'already-counted' };
    }

    /*
     * 완주하지 않았으면 **문서를 만들지 않고 그냥 나간다.**
     *
     * counted:false 문서를 만들어 두면 안 된다 — 다음에 끝까지 들어도 문서가 이미
     * 있어서 영영 표로 승격되지 않는다. "아직 표가 아니다"는 상태는 문서의 부재로
     * 표현해야 다시 시도할 수 있다.
     */
    if (!completed) return { counted: false, reason: 'incomplete' };

    tx.set(listen, { workId, uid, firstAt: now, lastAt: now, plays: 1 });
    tx.set(entry, { uniqueListeners: FieldValue.increment(1) }, { merge: true });
    // 청취왕 상을 위한 개인 집계. 여기서 같이 올려야 따로 훑지 않아도 된다.
    tx.set(member, { listenedCount: FieldValue.increment(1) }, { merge: true });
    return { counted: true };
  });
}

export const recordPlay = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

  const workId = String(request.data?.workId || '');
  if (!WORK_ID.test(workId)) {
    throw new HttpsError('invalid-argument', '작품 번호가 이상해요');
  }
  const presses = Math.max(0, Math.min(1000, Number(request.data?.presses) || 0));
  const groupId = String(request.data?.groupId || '');
  const completed = request.data?.completed === true;

  const now = Date.now();
  const key = `${uid}:${workId}`;
  const throttled = now - (recent.get(key) || 0) < WINDOW_MS;
  if (!throttled) {
    recent.set(key, now);
    if (recent.size > 5000) recent.clear();
  }

  /*
   * throttle에 걸려도 **그냥 돌아가지 않는다.**
   *
   * 예전에는 여기서 early return이었다. 그러면 공개 스테이지에서 같은 작품을 1분 안에
   * 들었던 사람이 그룹 스테이지에서 완주해도 표가 등록되지 않는다 — 순위가 조용히
   * 틀어지는 경로다. 재생 수만 건너뛰고 표 등록은 아래에서 계속한다.
   */
  let group = null;
  if (GROUP_ID.test(groupId)) {
    try {
      group = await recordGroupPlay(groupId, workId, uid, { countReplay: !throttled, completed });
    } catch (error) {
      // 그룹 집계 실패가 전역 집계까지 막지는 않는다.
      console.warn('그룹 재생 집계 실패', groupId, workId, error?.code || error);
    }
  }

  if (throttled) return { ok: true, throttled: true, group };

  await db.doc(`workStats/${workId}`).set(
    {
      plays: FieldValue.increment(1),
      presses: FieldValue.increment(presses),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  /*
   * 작품 문서에도 같은 수를 올린다 — 인기순 정렬 때문이다.
   *
   * Firestore는 다른 컬렉션(workStats)의 필드로 orderBy를 할 수 없다. 정렬하려면
   * 정렬 키가 정렬 대상 문서에 있어야 한다. 그래서 집계의 원본은 workStats에 두되
   * 정렬용 사본을 works에 함께 둔다.
   *
   * update를 쓴다. set(merge)를 쓰면 이미 지워진 작품에 replayCount만 있는
   * 유령 문서가 되살아난다. 문서가 없으면 실패하는 게 맞다.
   * 원본 집계는 위에서 이미 성공했으므로 여기 실패가 호출을 실패시키지는 않는다.
   */
  try {
    await db.doc(`works/${workId}`).update({ replayCount: FieldValue.increment(1) });
  } catch (error) {
    console.warn('정렬용 재생 수를 올리지 못했습니다', workId, error?.code || error);
  }

  return { ok: true, group };
});

/* ── unshareWork ───────────────────────────────────── */

/**
 * 공유 중단 — Storage 자산을 **실제로 지우고** 문서를 삭제한다.
 *
 * Storage 읽기를 열어 둔 대가가 이것이다. 이 삭제가 확실하지 않으면
 * "공유를 멈췄는데 파일은 남아 있는" 상태가 되고, 그건 약속 위반이다.
 */
export const unshareWork = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

  const workId = String(request.data?.workId || '');
  if (!WORK_ID.test(workId)) {
    throw new HttpsError('invalid-argument', '작품 번호가 이상해요');
  }

  const ref = db.collection('works').doc(workId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, alreadyGone: true };
  const work = snap.data();
  if (work.authorUid !== uid) {
    throw new HttpsError('permission-denied', '내 작품이 아니에요');
  }

  // 파일을 먼저 지운다. 문서만 지우고 파일이 남는 상황을 만들지 않는다.
  await getStorage().bucket().deleteFiles({ prefix: `works/${workId}/` });

  /*
   * 그룹에 올라가 있던 제출은 **지우지 않고 내린다.**
   *
   * entries 문서를 지워 버리면 그 그룹의 순위 이력에서 이 작품이 통째로 사라진다.
   * 발표가 끝난 뒤 작성자가 공유를 멈췄을 때 지난 등수까지 없어지는 건 곤란하다.
   * status만 'removed'로 바꾸면 목록에서는 빠지고 기록은 남는다.
   *
   * 작품 문서를 지우기 **전에** 한다. 지운 뒤에 하면 groupIds를 읽을 곳이 없어져
   * 어느 그룹을 정리해야 하는지 영영 알 수 없다.
   */
  const groupIds = Array.isArray(work.groupIds) ? work.groupIds.filter((id) => GROUP_ID.test(id)) : [];
  await Promise.allSettled(
    groupIds.map((groupId) =>
      entryRef(groupId, workId)
        .set({ status: 'removed', removedAt: Date.now() }, { merge: true })
        .then(() => groupRef(groupId).set(
          { counts: { entries: FieldValue.increment(-1) } },
          { merge: true },
        )),
    ),
  );

  await ref.delete();
  await db
    .doc(`workStats/${workId}`)
    .delete()
    .catch(() => {});

  return { ok: true, withdrawnFrom: groupIds.length };
});

/* ── 그룹 ──────────────────────────────────────────── */

/**
 * 그룹 ID 알파벳. [A-Za-z0-9_-] 64자 — GROUP_ID 정규식과 짝을 이룬다.
 *
 * 64 = 2^6이라 무작위 바이트의 하위 6비트(0~63)를 그대로 인덱스로 쓰면
 * 모듈로 연산 없이도 정확히 균등하다. 256이 64로 나누어떨어지기 때문에
 * 거부 샘플링도 필요 없다.
 */
const GROUP_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function randomGroupId() {
  const bytes = randomBytes(12);
  let id = '';
  for (let i = 0; i < 12; i++) id += GROUP_ID_ALPHABET[bytes[i] & 63];
  return id;
}

/**
 * 입장 코드 생성 — 거부 샘플링.
 *
 * CODE_ALPHABET은 30자라 256을 30으로 나누면 나머지가 남는다(256 = 30×8 + 16).
 * 그냥 `byte % 30`을 쓰면 나머지 16칸에 해당하는 앞쪽 문자들이 더 자주 나와
 * 코드가 눈에 덜 띄게 편향된다. 240(= 30×8, 256 미만에서 30의 배수인 가장 큰 값)
 * 이상의 바이트를 버리고 나머지만 쓰면 남은 값의 분포가 정확히 균등해진다.
 */
function randomJoinCode() {
  const REJECT_AT = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length; // 240
  let code = '';
  while (code.length < CODE_LENGTH) {
    const chunk = randomBytes(CODE_LENGTH);
    for (const b of chunk) {
      if (code.length >= CODE_LENGTH) break;
      if (b >= REJECT_AT) continue;
      code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

/**
 * joinGroup 시도 횟수 제한 — uid당 1분에 10회.
 *
 * recordPlay의 `recent`와 같은 인스턴스 메모리 Map이라 완전하지 않다
 * (콜드 스타트마다 리셋되고 maxInstances가 10이라 인스턴스마다 따로 센다).
 * 그래도 코드 공간이 30^8(약 6,561억 가지)이라 이 방어를 우회해도 대입 자체가
 * 현실적이지 않다 — 서두르는 실수를 막는 것이지 무차별 대입의 마지막 방어선은 아니다.
 */
const joinAttempts = new Map();
const JOIN_ATTEMPT_WINDOW_MS = 60_000;
const JOIN_ATTEMPT_MAX = 10;

function underJoinAttemptLimit(uid) {
  const now = Date.now();
  const rec = joinAttempts.get(uid);
  if (!rec || now - rec.windowStart >= JOIN_ATTEMPT_WINDOW_MS) {
    joinAttempts.set(uid, { count: 1, windowStart: now });
    if (joinAttempts.size > 5000) joinAttempts.clear();
    return true;
  }
  if (rec.count >= JOIN_ATTEMPT_MAX) return false;
  rec.count++;
  return true;
}

/**
 * 그룹 만들기.
 * 비익명 계정만 만들 수 있다 — 초대 코드와 정원을 관리하는 주최자 자리가
 * 기기를 바꾸면 사라지는 익명 계정이면 그룹이 통째로 고아가 된다.
 */
export const createGroup = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');
  if (request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('failed-precondition', '그룹을 만들려면 Google 계정으로 로그인해 주세요');
  }

  const name = String(request.data?.name || '').trim();
  if (name.length < 1 || name.length > 30) {
    throw new HttpsError('invalid-argument', '그룹 이름은 1~30자로 적어주세요');
  }

  const ownedSnap = await db.collection('groups').where('ownerUid', '==', uid).count().get();
  if (ownedSnap.data().count >= GROUPS_PER_OWNER_MAX) {
    throw new HttpsError('resource-exhausted', '그룹은 계정당 3개까지 만들 수 있어요');
  }

  const groupId = randomGroupId();

  /*
   * 입장 코드는 조회 후 쓰지 않고 곧바로 create()로 찜한다.
   * "먼저 조회하고 비어 있으면 쓴다"는 그 사이에 다른 요청이 같은 코드를
   * 먼저 차지할 수 있는 경합(TOCTOU)이 있다. create()는 문서가 이미 있으면
   * 원자적으로 ALREADY_EXISTS 실패를 돌려주므로, 그 실패 자체를 "다시 뽑아라"라는
   * 신호로 쓰면 경합이 원리적으로 생기지 않는다.
   */
  let code = null;
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const candidate = randomJoinCode();
    try {
      await db.collection('joinCodes').doc(candidate).create({
        groupId,
        disabled: false,
        createdAt: Date.now(),
      });
      code = candidate;
    } catch (error) {
      if (error?.code !== 6 /* ALREADY_EXISTS */) throw error;
    }
  }
  if (!code) {
    throw new HttpsError('resource-exhausted', '입장 코드를 만들지 못했어요. 다시 시도해 주세요');
  }

  const now = Date.now();
  const nick = String(request.auth.token.name || '친구').slice(0, 30);
  const batch = db.batch();
  batch.set(groupRef(groupId), {
    name,
    ownerUid: uid,
    createdAt: now,
    privacy: 'unlisted',
    join: {
      codeHash: null,
      codeHint: code,
      rotatedAt: now,
      requiresGoogle: false,
      emailDomain: null,
    },
    limits: { members: GROUP_MEMBER_MAX, entries: GROUP_ENTRY_MAX },
    submitPolicy: 'members',
    contest: {
      phase: 'open',
      submitClosesAt: null,
      stageClosesAt: null,
      rankingMetric: 'uniqueListeners',
      revealRanking: 'onClose',
    },
    counts: { members: 1, entries: 0 },
  });
  batch.set(memberRef(groupId, uid), {
    uid,
    role: 'owner',
    nick,
    joinedAt: now,
    listenedCount: 0,
  });
  batch.set(myGroupRef(uid, groupId), {
    groupId,
    name,
    role: 'owner',
    joinedAt: now,
  });

  /*
   * 코드를 먼저 찜했으므로, 그룹 쓰기가 실패하면 **찜한 코드를 돌려놓아야 한다.**
   *
   * 안 그러면 joinCodes에 있지도 않은 그룹을 가리키는 문서가 남는다. joinGroup이
   * not-found로 막아주긴 하지만, 그 코드는 영영 다시 못 쓰는 채로 남고 주최자는
   * "코드를 받았는데 안 들어가진다"는 상태에 갇힌다. 실패한 시도는 흔적을 남기지 않는다.
   */
  try {
    await batch.commit();
  } catch (error) {
    await db.collection('joinCodes').doc(code).delete().catch(() => {});
    throw error;
  }

  return { groupId, code, name };
});

/**
 * 초대 코드 다시 보기.
 * 주최자만 볼 수 있다 — 코드는 곧 입장 열쇠라, 만든 사람 말고는 다시 꺼내 줄 이유가
 * 없다. group 문서의 join.codeHint에 평문으로 있으니 새로 뽑을 필요는 없다.
 */
export const getGroupCode = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

  const groupId = String(request.data?.groupId || '');
  if (!GROUP_ID.test(groupId)) {
    throw new HttpsError('invalid-argument', '그룹 번호가 이상해요');
  }

  const groupSnap = await groupRef(groupId).get();
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', '그런 그룹이 없어요');
  }
  const group = groupSnap.data();
  if (group.ownerUid !== uid) {
    throw new HttpsError('permission-denied', '그룹을 만든 사람만 초대 코드를 볼 수 있어요');
  }

  const code = group.join?.codeHint;
  if (typeof code !== 'string' || !code) {
    throw new HttpsError('internal', '초대 코드를 찾지 못했어요');
  }
  return { code };
});

/**
 * 그룹 참가.
 * 링크를 두 번 눌러도 에러가 아니다 — 이미 멤버면 조용히 성공으로 처리한다.
 */
export const joinGroup = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

  if (!underJoinAttemptLimit(uid)) {
    throw new HttpsError('resource-exhausted', '너무 여러 번 시도했어요. 잠시 후 다시 해주세요');
  }

  const code = String(request.data?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!JOIN_CODE.test(code)) {
    throw new HttpsError('invalid-argument', '코드가 8자리가 아니에요');
  }

  const codeSnap = await db.collection('joinCodes').doc(code).get();
  const codeData = codeSnap.exists ? codeSnap.data() : null;
  if (!codeData || codeData.disabled === true) {
    throw new HttpsError('not-found', '그런 코드가 없어요');
  }

  const groupId = String(codeData.groupId || '');
  const groupSnap = await groupRef(groupId).get();
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', '그런 코드가 없어요');
  }
  const group = groupSnap.data();

  const memberSnap = await memberRef(groupId, uid).get();
  if (memberSnap.exists) {
    // 이미 멤버다. 링크를 다시 눌렀을 뿐이니 에러가 아니라 성공으로 답한다.
    return { groupId, name: group.name, alreadyMember: true };
  }

  const memberLimit = Number(group.limits?.members) || GROUP_MEMBER_MAX;
  const memberCount = Number(group.counts?.members) || 0;
  if (memberCount >= memberLimit) {
    throw new HttpsError('resource-exhausted', `이 그룹은 자리가 다 찼어요(${memberLimit}명)`);
  }

  const now = Date.now();
  const nick = String(request.auth.token.name || '친구').slice(0, 30);
  const batch = db.batch();
  batch.set(memberRef(groupId, uid), {
    uid,
    role: 'member',
    nick,
    joinedAt: now,
    listenedCount: 0,
  });
  batch.set(myGroupRef(uid, groupId), {
    groupId,
    name: group.name,
    role: 'member',
    joinedAt: now,
  });
  batch.set(groupRef(groupId), { counts: { members: FieldValue.increment(1) } }, { merge: true });
  await batch.commit();

  return { groupId, name: group.name, alreadyMember: false };
});

/** listPublicFeed와 같은 이유로 같은 모양의 상한을 둔다 — 그 함수의 주석 참고. */
const STAGE_PAGE = 12;
const STAGE_BATCH = 60;
const STAGE_MAX_BATCHES = 5;

function parseStageCursor(value) {
  if (!value || typeof value !== 'object') return null;
  const at = Number(value.value);
  const id = String(value.id || '');
  if (!Number.isFinite(at) || !WORK_ID.test(id)) return null;
  return { value: at, id };
}

/**
 * 그룹 스테이지 목록.
 * 배치 스캔·배치 상한·"훑은 마지막 문서를 가리키는 커서"는 listPublicFeed와
 * 완전히 같은 이유로 같은 모양이다 — 검색어는 Firestore가 부분 일치를 못 해서
 * 읽은 뒤 걸러야 하고, 그래서 한 호출이 읽을 수 있는 양에 상한이 필요하다.
 */
export const listGroupStage = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

  const groupId = String(request.data?.groupId || '');
  if (!GROUP_ID.test(groupId)) {
    throw new HttpsError('invalid-argument', '그룹 번호가 이상해요');
  }

  const [memberSnap, groupSnap] = await db.getAll(memberRef(groupId, uid), groupRef(groupId));
  if (!memberSnap.exists) {
    throw new HttpsError('permission-denied', '이 그룹의 참가자가 아니에요');
  }
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', '그런 그룹이 없어요');
  }
  const group = groupSnap.data();
  const member = memberSnap.data();

  const rankingMetric = group.contest?.rankingMetric === 'replayCount' ? 'replayCount' : 'uniqueListeners';
  /*
   * 'unheard'는 **"내가 안 들은 것"이 아니라 "남들이 덜 들은 것"**이다.
   *
   * 진짜 개인화된 미청취 정렬을 하려면 이 사람의 listens 문서를 전부(최대 200개)
   * 읽어 와서 메모리에서 갈라야 한다. 한 쪽을 그릴 때마다 200 read는 12 read짜리
   * 목록에 붙일 비용이 아니다.
   *
   * uniqueListeners 오름차순은 색인 하나로 끝나면서 목적(노출 형평성 — 늦게 올린
   * 사람이 구조적으로 묻히지 않게)을 거의 그대로 달성한다. 개인화는 카드의
   * listened 표시가 대신한다. 화면 라벨을 "덜 들린 순"으로 쓰는 이유가 이것이다.
   * 개인화된 정렬은 P2로 미룬다.
   */
  const sortInput = String(request.data?.sort || 'unheard');
  const { field: sortField, dir: sortDir } =
    sortInput === 'latest'
      ? { field: 'submittedAt', dir: 'desc' }
      : sortInput === 'popular'
        ? { field: rankingMetric, dir: 'desc' }
        : { field: 'uniqueListeners', dir: 'asc' }; // 'unheard' 기본값 — 안 들어본 작품을 먼저 보여준다.

  const search = String(request.data?.search || '').trim().toLowerCase().slice(0, 40);
  const limit = Math.max(1, Math.min(STAGE_PAGE, Number(request.data?.limit) || STAGE_PAGE));
  let cursor = parseStageCursor(request.data?.cursor);

  const entriesCol = db.collection(`groups/${groupId}/entries`);
  // 정렬 방향과 __name__ 방향을 맞춘다 — 복합 색인이 그렇게 정의돼 있어야 한다.
  const base = entriesCol.where('status', '==', 'active').orderBy(sortField, sortDir).orderBy('__name__', sortDir);

  const rows = [];
  let exhausted = false;
  let stoppedMidBatch = false;

  for (let batchNo = 0; batchNo < STAGE_MAX_BATCHES && rows.length < limit; batchNo++) {
    let q = base.limit(STAGE_BATCH);
    if (cursor) q = q.startAfter(cursor.value, entriesCol.doc(cursor.id));
    const snap = await q.get();
    if (snap.empty) {
      exhausted = true;
      break;
    }

    for (const doc of snap.docs) {
      const data = doc.data();
      // 커서는 맞았는지와 무관하게 훑은 마지막 문서를 따라간다(listPublicFeed와 동일).
      const sortValue = Number(data[sortField]);
      if (Number.isFinite(sortValue)) cursor = { value: sortValue, id: doc.id };

      const title = String(data.title || '').slice(0, 20);
      const hint = String(data.hint || '').slice(0, 40);
      const authorNick = String(data.authorNick || '친구').slice(0, 30);
      if (search && !`${title} ${hint} ${authorNick}`.toLowerCase().includes(search)) continue;

      rows.push({
        id: doc.id,
        title,
        hint,
        authorNick,
        authorUid: typeof data.authorUid === 'string' ? data.authorUid : null,
        durationMs: Number(data.durationMs) || 0,
        replayCount: Number(data.replayCount) || 0,
        uniqueListeners: Number(data.uniqueListeners) || 0,
        submittedAt: Number(data.submittedAt) || 0,
      });
      if (rows.length >= limit) {
        stoppedMidBatch = true;
        break;
      }
    }

    // 배치를 끝까지 훑었을 때만 "다 봤다"고 말할 수 있다 — listPublicFeed와 같은 이유.
    if (stoppedMidBatch) break;
    if (snap.size < STAGE_BATCH) {
      exhausted = true;
      break;
    }
  }

  const authorUids = [...new Set(rows.map((row) => row.authorUid).filter(Boolean))];
  const [listenSnaps, profileSnaps] = await Promise.all([
    rows.length > 0 ? db.getAll(...rows.map((row) => listenRef(groupId, row.id, uid))) : Promise.resolve([]),
    authorUids.length > 0
      ? db.getAll(...authorUids.map((authorUid) => db.collection('publicProfiles').doc(authorUid)))
      : Promise.resolve([]),
  ]);
  const listenedIds = new Set(listenSnaps.filter((s) => s.exists).map((s) => s.id));
  const avatarOwners = new Set(
    profileSnaps.filter((p) => p.exists && p.data()?.enabled === true).map((p) => p.id),
  );

  const items = rows.map(({ authorUid, ...item }) => ({
    ...item,
    avatarUrl: authorUid && avatarOwners.has(authorUid) ? `${PUBLIC_ORIGIN}/avatar/${item.id}` : null,
    listened: listenedIds.has(`${item.id}__${uid}`),
    mine: authorUid === uid,
  }));

  // count()는 집계 쿼리다 — 문서를 하나씩 읽지 않고 서버가 센 숫자 하나만 돌아온다.
  const listenedCountSnap = await db
    .collection(`groups/${groupId}/listens`)
    .where('uid', '==', uid)
    .count()
    .get();

  return {
    group: {
      id: groupId,
      name: group.name,
      role: member.role,
      memberCount: Number(group.counts?.members) || 0,
      entryCount: Number(group.counts?.entries) || 0,
      submitPolicy: group.submitPolicy,
      rankingMetric,
    },
    items,
    nextCursor: exhausted ? null : cursor,
    listenedCount: listenedCountSnap.data().count,
  };
});

/**
 * 그룹에 제출.
 * 한 작품을 여러 그룹에 동시에 올릴 수 있지만 MAX_GROUPS_PER_WORK로 막혀 있다.
 */
export const submitToGroup = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

  const workId = String(request.data?.workId || '');
  if (!WORK_ID.test(workId)) {
    throw new HttpsError('invalid-argument', '작품 번호가 이상해요');
  }

  const workRef = db.collection('works').doc(workId);
  const workSnap = await workRef.get();
  if (!workSnap.exists || workSnap.data().authorUid !== uid) {
    throw new HttpsError('permission-denied', '내 작품이 아니에요');
  }
  const work = workSnap.data();
  if (work.visibility !== 'link') {
    throw new HttpsError('failed-precondition', '먼저 공유를 완료해 주세요');
  }

  const requestedIds = Array.isArray(request.data?.groupIds) ? request.data.groupIds : [];
  const uniqueRequested = [...new Set(requestedIds.map(String))]
    .filter((id) => GROUP_ID.test(id))
    .slice(0, MAX_GROUPS_PER_WORK);

  const existingGroupIds = Array.isArray(work.groupIds) ? work.groupIds.filter((id) => GROUP_ID.test(id)) : [];
  const existingSet = new Set(existingGroupIds);

  const submitted = [];
  const skipped = [];
  // 기존에 올라가 있던 그룹 수에서 시작해, 새로 통과하는 그룹만큼만 늘린다.
  let capUsed = existingSet.size;

  for (const groupId of uniqueRequested) {
    const isNewGroup = !existingSet.has(groupId);
    if (isNewGroup && capUsed >= MAX_GROUPS_PER_WORK) {
      skipped.push({ groupId, reason: 'too-many-groups' });
      continue;
    }

    const [memberSnap, groupSnap, entrySnap] = await db.getAll(
      memberRef(groupId, uid),
      groupRef(groupId),
      entryRef(groupId, workId),
    );
    if (!groupSnap.exists || !memberSnap.exists) {
      skipped.push({ groupId, reason: 'not-member' });
      continue;
    }
    const group = groupSnap.data();
    const role = memberSnap.data().role;
    if (group.submitPolicy === 'admins' && role === 'member') {
      skipped.push({ groupId, reason: 'admins-only' });
      continue;
    }
    if (entrySnap.exists && entrySnap.data().status === 'active') {
      // 에러가 아니다 — 이미 올라가 있으니 그대로 둔다.
      skipped.push({ groupId, reason: 'already-submitted' });
      continue;
    }
    const entryLimit = Number(group.limits?.entries) || GROUP_ENTRY_MAX;
    const entryCount = Number(group.counts?.entries) || 0;
    if (entryCount >= entryLimit) {
      skipped.push({ groupId, reason: 'group-full' });
      continue;
    }

    const now = Date.now();
    const batch = db.batch();
    /*
     * 다시 올리는 경우 집계를 **0으로 되돌리면 안 된다.**
     *
     * 표의 원본은 listens 문서다. 내렸다가 다시 올렸을 때 여기서 uniqueListeners를
     * 0으로 덮으면, 이미 들어서 listens 문서를 가진 사람들은 다시 세어질 수 없고
     * (그 문서가 곧 "이미 셌다"는 표시다) 집계는 영영 실제보다 낮은 채로 고정된다.
     * 그래서 카드 정보만 새로 쓰고 집계 필드는 처음 만들 때만 넣는다.
     */
    const entryFields = {
      workId,
      authorUid: uid,
      authorNick: work.authorNick || '친구',
      title: work.title || '',
      hint: work.hint || '',
      durationMs: Number(work.replay?.durationMs) || 0,
      submittedAt: now,
      status: 'active',
      removedAt: null,
    };
    if (!entrySnap.exists) {
      entryFields.uniqueListeners = 0;
      entryFields.replayCount = 0;
      entryFields.lastPlayedAt = null;
    }
    batch.set(entryRef(groupId, workId), entryFields, { merge: true });
    batch.set(groupRef(groupId), { counts: { entries: FieldValue.increment(1) } }, { merge: true });
    await batch.commit();

    submitted.push(groupId);
    if (isNewGroup) capUsed++;
  }

  if (submitted.length > 0) {
    /*
     * expiresAt을 null로 함께 쓴다.
     *
     * 참가자가 공유 기간을 7일로 골라 두면 컨테스트가 끝나기 전에 작품이 만료돼
     * 스테이지에서 사라진다. 화면에서도 만료일 선택을 숨기지만, 진짜 방어선은
     * 여기다 — 어떤 경로로 들어와도 그룹에 올라간 작품은 만료되지 않는다.
     */
    await workRef.update({
      groupIds: FieldValue.arrayUnion(...submitted),
      expiresAt: null,
    });
  }

  return { ok: true, submitted, skipped };
});

/**
 * 그룹 제출 내리기.
 * 작성자 본인이거나 그 그룹의 owner/admin이면 내릴 수 있다.
 */
export const withdrawEntry = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

  const groupId = String(request.data?.groupId || '');
  const workId = String(request.data?.workId || '');
  if (!GROUP_ID.test(groupId)) {
    throw new HttpsError('invalid-argument', '그룹 번호가 이상해요');
  }
  if (!WORK_ID.test(workId)) {
    throw new HttpsError('invalid-argument', '작품 번호가 이상해요');
  }

  const ref = entryRef(groupId, workId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, alreadyGone: true };
  const entry = snap.data();

  if (entry.authorUid !== uid) {
    const memberSnap = await memberRef(groupId, uid).get();
    const role = memberSnap.exists ? memberSnap.data().role : null;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', '내릴 권한이 없어요');
    }
  }

  // 이미 내려간 항목이면 다시 할 일이 없다 — counts.entries를 또 깎으면 안 된다.
  if (entry.status === 'removed') return { ok: true };

  /*
   * 문서를 지우지 않고 status만 바꾼다 — 순위 이력을 남기기 위해서다.
   * unshareWork에서 같은 판단을 내린 이유와 같다(위 주석 참고).
   */
  const batch = db.batch();
  batch.set(ref, { status: 'removed', removedAt: Date.now() }, { merge: true });
  batch.set(groupRef(groupId), { counts: { entries: FieldValue.increment(-1) } }, { merge: true });
  await batch.commit();

  await db
    .doc(`works/${workId}`)
    .update({ groupIds: FieldValue.arrayRemove(groupId) })
    .catch((error) => {
      // 작품 문서가 이미 지워졌을 수 있다(unshareWork가 먼저 지났을 때). 치명적이지 않다.
      console.warn('작품의 groupIds 정리 실패', workId, groupId, error?.code || error);
    });

  return { ok: true };
});
