# 키크 (KEYC)

아이가 그림과 자기 목소리로 키캡 4개를 만들고, 루프를 쌓아 올리며 15초 공연을
녹화해, 링크 하나로 누구나 브라우저에서 눌러볼 수 있게 하는 창작 도구.

성공 기준은 "많이 누르기"가 아니라 **작품 1개 완성 후 공유**다.

> 스키마 v2. 공연은 "탭 목록"이 아니라 **재생 가능한 기록(Replay)** 이다.

---

## 로컬 실행과 프로덕션 빌드

### 요구 사항

- **Node.js 22.12 이상 권장** — Vite 8은 Node.js 20을 쓸 경우 20.19 이상이 필요하다.
- npm
- Firebase에 배포할 때만 [Firebase CLI](https://firebase.google.com/docs/cli),
  [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), 프로젝트 권한

Cloud Functions의 배포 런타임은 [`functions/package.json`](functions/package.json)의
`engines.node: 20`으로 고정되어 있다. 로컬에서 Node.js 22를 써도 배포된 함수는 Node.js 20에서
실행된다.

### 처음 설치

```bash
npm ci
cp .env.example .env
npm run dev
```

Firebase 설정 없이도 만들기·공연·IndexedDB 저장은 동작한다. Google 계정 백업과 공개 공유를
사용하려면 Firebase Console의 **프로젝트 설정 → 내 앱 → 웹 앱**에서 받은 값을 `.env`에 넣는다.

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

`.env`는 Git에서 제외되어 있으므로 커밋하지 않는다. 배포용 값의 이름과 설명은
[`.env.example`](.env.example)을 기준으로 한다.

### 빌드 확인

```bash
npm test
npm run build
npm run preview
```

`npm run build`는 `tsc --noEmit`과 Vite 프로덕션 빌드를 차례로 실행하고 결과를 `dist/`에 만든다.
`npm run preview`는 만들어진 `dist/`를 로컬에서 확인할 때만 사용하며 Firebase에 배포하지 않는다.

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | Vite 개발 서버 실행 |
| `npm test` | 전체 Vitest 테스트 실행 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run build` | 타입 검사 후 `dist/` 프로덕션 번들 생성 |
| `npm run preview` | 마지막 빌드 결과 로컬 확인 |
| `npm run emulators` | Firebase Emulator Suite 실행 |
| `npm run deploy:cors` | Storage 버킷에 허용 웹 출처 적용 |
| `npm run deploy:functions:iam` | callable Function의 Cloud Run 호출 IAM 적용 |
| `npm run deploy` | 빌드·Firebase 배포 후 CORS와 callable IAM 적용 |

## Apps in Toss `.ait` 빌드

Apps in Toss Web Framework 설정은 [`granite.config.ts`](granite.config.ts)에 있다.
기존 Vite/Firebase 빌드는 그대로 유지하며 Toss 전용 명령만 별도로 실행한다.

```bash
npm run dev:ait
npm run build:ait
```

`npm run build:ait`는 먼저 Vite 정적 번들을 `dist/`에 만든 뒤 프로젝트 루트에
업로드 가능한 `keyc-studio.ait`를 생성한다. `.ait`와 `.granite/`는 생성 산출물이므로 Git에서
제외한다. 앱인토스 콘솔의 appName이 `keyc-studio`와 다르면 빌드 전에
[`granite.config.ts`](granite.config.ts)의 `appName`을 콘솔 값과 똑같이 바꿔야 한다.

`npm run deploy:ait`는 Apps in Toss CLI 인증과 콘솔 권한이 준비된 경우에만 사용한다.
WebView에서 녹음을 사용하므로 심사용 권한 선언에는 `microphone/access`를 포함한다.

## Firebase 배포

이 저장소의 기본 Firebase 프로젝트는 [`.firebaserc`](.firebaserc)의 `keyc-studio`, Functions
리전은 `asia-northeast3`이다. 다른 프로젝트에 배포할 때는 `.env`와 Firebase CLI의 활성
프로젝트를 모두 바꿔야 한다.

### 1. 최초 준비

Firebase Console에서 다음 항목을 먼저 준비한다.

1. 웹 앱을 등록하고 `.env`의 여섯 값을 입력한다.
2. Authentication에서 **익명 로그인**을 활성화한다. Google 계정 백업도 사용할 경우
   **Google 로그인**과 배포 도메인을 함께 설정한다.
3. `(default)` Firestore 데이터베이스와 Storage 버킷을 만든다. Storage 리전은
   `asia-northeast3`으로 맞춘다.
4. Functions를 배포할 프로젝트를 Blaze 요금제에 연결한다.

CLI와 두 개의 npm 프로젝트 의존성을 설치한 뒤 로그인한다. 루트의 `npm ci`는
`functions/` 의존성을 설치하지 않으므로 둘 다 실행해야 한다.

```bash
npm ci
npm --prefix functions ci
npm install --global firebase-tools
firebase login
firebase use keyc-studio
firebase use
```

마지막 `firebase use` 출력이 의도한 프로젝트인지 반드시 확인한다. 운영 프로젝트에 대한
권한이 없는 환경이나 CI에서는 `firebase login:ci` 토큰보다 Google Application Default
Credentials 또는 CI 전용 서비스 계정 사용을 우선 검토한다.

### 2. 배포 전 검증

```bash
npm test
npm run build
node functions/smoke-load.mjs
```

스모크 테스트는 `shareMeta`, `thumb`, `avatar`, `listPublicFeed`, `recordPlay`, `unshareWork`
여섯 함수가 실제로 로드되는지 확인한다. `npm run build`는 프런트엔드만 검사하므로 이 단계를
대체하지 않는다.

### 3. 최초 배포

첫 배포는 규칙과 인덱스, Functions, Hosting 순서로 나누어 실행한다.

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
npm run deploy:cors
firebase deploy --only functions
npm run deploy:functions:iam
firebase deploy --only hosting
```

- `firebase deploy`는 Storage Rules만 배포하고 버킷 CORS는 바꾸지 않는다. 새 웹 출처를 추가하면
  [`firebase-storage-cors.json`](firebase-storage-cors.json)을 수정한 뒤 `npm run deploy:cors`를
  다시 실행한다. 이 명령에는 Google Cloud CLI와 버킷 수정 권한이 필요하다.
- 2세대 callable Function은 브라우저가 Cloud Run까지 도달할 수 있도록 `roles/run.invoker`의
  `allUsers` 바인딩이 필요하다. `npm run deploy:functions:iam`은 공개 피드·재생 집계·공유 중단
  서비스에 이 전송 권한을 적용한다. 실제 데이터 권한은 Firebase Auth·App Check와 함수 내부
  소유권 검사가 계속 제한한다.
- 공개 피드는 Firestore 복합 인덱스가 필요하다. 콘솔에서 인덱스 상태가 **사용 설정됨**이 될
  때까지 `listPublicFeed`가 실패할 수 있다.
- Hosting의 `/w/**`, `/thumb/**`, `/avatar/**` rewrite는 Functions를 가리키므로 Functions를
  먼저 배포한다.
- `unshareWork`가 없으면 공유 중단 때 공개 Storage 파일을 완전히 지울 수 없으므로 공개 공유를
  열기 전에 Functions 배포를 확인한다.

최초 구성이 끝난 뒤의 일반적인 전체 배포는 다음 한 줄로 충분하다.

```bash
npm run deploy
```

이 명령은 프런트엔드를 다시 빌드한 뒤 Hosting, Functions, Firestore 규칙·인덱스, Storage
규칙을 배포하고, 버킷 CORS와 callable Function IAM까지 적용한다.
일부만 바꿨다면 위의 `firebase deploy --only ...` 명령으로 해당 리소스만 배포할 수 있다.

### 4. 배포 후 확인

1. Hosting 기본 주소에서 홈과 새 작품 만들기가 열리는지 확인한다.
2. Firebase Console에서 여섯 Functions가 `asia-northeast3`에 배포됐는지 확인한다.
3. 실제 작품을 하나 공유하고 시크릿 창이나 다른 기기에서 `/w/{workId}` 링크의 그림과 녹음
   소리가 모두 재생되는지 확인한다.
4. 공유 중단 후 문서와 `works/{workId}/...` Storage 파일이 삭제됐는지 확인한다.

App Check를 등록한 뒤 callable Functions 검증을 강제하려면 `functions/.env`에
`ENFORCE_APP_CHECK=true`를 넣고 Functions를 다시 배포한다. 등록 전에 이 값을 켜면 공개 피드와
집계·공유 중단 호출이 모두 거부된다. 콘솔 설정과 운영 체크리스트는
[FIREBASE.md](FIREBASE.md)에 더 자세히 정리되어 있다.

### Emulator Suite 주의

```bash
npm run build
npm run emulators
```

이 명령은 Auth, Functions, Firestore, Storage, Hosting 에뮬레이터와 Emulator UI를 시작한다.
다만 현재 프런트엔드에는 `connectAuthEmulator`·`connectFirestoreEmulator` 등의 연결 코드가
없으므로, 앱 SDK는 `.env`의 실제 Firebase 프로젝트를 계속 바라본다. 연결 코드를 추가하기
전까지는 에뮬레이터 실행만으로 안전한 로컬 통합 테스트가 된다고 간주하면 안 된다.

---

## 먼저, 정정 사항

이전 판(v1)에서 **"익명 로그인만 쓰면 만 14세 미만 법정대리인 동의 문제를
구조적으로 회피한다"고 적었는데, 그건 틀렸다.**

동의 필요 여부는 로그인 방식이 아니라 **아동의 개인정보를 수집·이용하는가**로
판단되고, 아이 목소리·그림·작품 기록은 명백히 그 대상이다. 익명 인증은 서버에서
"이 작품의 주인이 누구인가"를 판별하는 기술 수단일 뿐이며, 동의를 대체하지 않는다.

그래서 구조를 바꿨다 — [6. 로컬·계정 백업·공개 공유](#6-로컬계정-백업공개-공유) 참조.
**보호자 확인을 어디까지 할지는 법률 검토가 필요한 사항이고, 코드가 정할 문제가 아니다.**
현재 구현은 사용자 테스트 단계용 최소 확인 화면이다.

---

## 구조

```
src/
  audio-engine/   Web Audio, lookahead 스케줄러, 녹음, 목소리 변형  ← 순수 TS
  work-model/     스키마, 결정론(rnd/타이밍/리플레이 전개)          ← 순수 TS
  ui/             React 화면
  storage/        IndexedDB(로컬) / Firebase(계정 백업·공유)
functions/        shareMeta, thumb, avatar, listPublicFeed, recordPlay, unshareWork
```

`audio-engine`과 `work-model`은 React를 import하지 않는다. 네이티브로 갈 때
`work-model`은 그대로 쓰고, `audio-engine`은 인터페이스만 유지한 채 내부를 교체한다.

---

## 결정론 — 이 설계의 심장

리플레이가 원본과 다르면 이 제품은 성립하지 않는다. 네 가지로 보장한다.

### ① 시간 기준은 오직 AudioContext

```ts
const t = Math.round((ctx.currentTime - stageStart) * 1000);
```

`Date.now()`나 `performance.now()`를 이벤트 타임스탬프에 섞으면 오디오와 미세하게
어긋나고, 그 어긋남이 리플레이마다 달라진다. 엔진에서 시간을 만드는 곳은
`NoteScheduler.elapsedMs()` 하나뿐이다.

### ② 난수는 스트림이 아니라 해시

```ts
rnd(seed, eventIndex, purpose)   // work-model/rng.ts
```

순차 PRNG를 쓰면, 공연 중 UI가 난수를 **한 번이라도 더** 뽑는 순간(호버 반짝임,
나중에 누가 추가한 파티클 하나) 그 이후 모든 값이 밀려서 리플레이가 통째로 달라진다.
그런 버그는 재현이 안 되고 사용자 신고로만 알게 된다. 그래서 모든 무작위 값은
`(seed, 이벤트 인덱스, 용도)`에서 직접 유도한다. 순서 의존성이 없으므로 중간부터
탐색해도 값이 같다. 자동 반복 노트는 이벤트 인덱스가 없으므로 음수 공간을 쓴다.

### ③ 라이브와 리플레이가 같은 코드를 탄다

두 벌의 코드를 "맞추는" 게 아니라, **둘 다 `expandReplay()` 하나가 만든 노트 목록을
재생한다.** 라이브 중 루프를 토글하면 이벤트를 기록하고 노트 목록을 통째로 다시 계산해
스케줄러에 갈아끼운다. 그래서 라이브가 곧 리플레이다 — 맞출 필요가 자체가 없다.

루프 노트는 **저장하지 않는다.** `loopOn`~`loopOff` 구간과 bpm·everyBeats·offsetBeats만
있으면 어느 비트에서 울렸는지는 순수 계산이다. 켜기는 `loopStartBeat()`로 다음 비트
경계에 양자화된다(3.1초에 켰다고 그 순간 소리 나면 박자가 무너진다). 끄기는 즉시 —
아이 직관에 맞다.

### ④ 셀프체크

공연이 끝나면 **실제로 울린 노트**와 **저장될 기록에서 재계산한 노트**의 해시를 비교한다.
불일치는 결정론이 깨졌다는 뜻이고, 그건 사용자 신고 전에 알아야 한다.

> 이 장치는 실제로 버그를 잡았다. 직접 누른 탭은 스케줄러를 거치지 않고 즉시 발음되는데,
> 그 탭이 발화 로그에 빠져 있어 재계산 결과와 영원히 불일치했다.

### 공연 길이는 마디 단위

15초 벽시계로 자르면 마지막 루프가 어중간하게 잘린다. **15초를 넘지 않는 최대 마디 수**로 정의한다.

| 템포 | BPM | 비트 | 마디 | durationMs |
|---|---|---|---|---|
| 느리게 | 80 | 750ms | 5 | 15,000 |
| 보통 | 100 | 600ms | 6 | 14,400 |
| 빠르게 | 130 | 461.5ms | 8 | 14,769 |

카운트인도 1마디(4비트)라 3·2·1이 박자에 맞는다.

### 프리셋 버전 접미사

`squish@1`, `tok@1` — **기존 값을 절대 고치지 않는다.** 고치고 싶으면 `squish@2`를 추가한다.
이걸 어기면 6개월 뒤 애니메이션 하나 손봤을 때 과거 작품 전체가 다르게 재생된다.

---

## 오디오 — 실패 지점 세 곳

**① 지연** — `<audio>` 태그 금지. 화면 진입 시 4개 소리를 전부 디코드해 두고
(`SoundBank`), 누를 때는 **동기적으로** 캐시에서 꺼낸다. `press()` 앞에 `await`나
`setState`를 두면 30ms 예산이 날아간다.

**② 반복** — `setInterval`로 박자를 돌리면 반드시 밀린다. 25ms마다 깨어나 오디오 시계
기준 0.1초 앞을 예약하고, 노트 시각은 절대 계산한다(누적 덧셈 금지).
애니메이션은 예약 시각을 큐에 넣고 rAF에서 `ctx.currentTime`과 비교해 발화시킨다.
화면이 가려지면 rAF는 멈추고 오디오만 흐르므로, 0.2초 넘게 지난 이벤트는 버린다.

**③ 녹음** — MediaRecorder를 쓰지 않는다. iOS Safari는 mp4/aac, Android Chrome은
webm/opus를 뱉고, 한쪽에서 녹음한 파일이 다른 쪽에서 안 열리는 사고가 난다.
**아이가 만든 소리가 친구 폰에서 안 나오면 그 순간 제품은 끝이다.**
대신 `getUserMedia → AudioWorklet → RMS 트림 → 22050Hz/16bit mono → WAV`.

**④ 기본 타건음** — 합성음만으로 실제 키보드의 충돌·공간·마이크 질감을 재현하는 데에는
한계가 있어, 새 작품의 네 키는 CC0로 공개된 실제 기계식 키보드 단일 타건 녹음으로 시작한다.
화면 진입 때 네 파일을 Web Audio 버퍼로 미리 디코드하므로 누르는 순간에는 네트워크나
디코딩을 기다리지 않는다. 거절된 초기 합성 타건음 ID를 가진 기존 작품도 대응하는 실제
녹음으로 자동 재생하며, ID 자체는 데이터 호환성을 위해 보존한다. `톡`, `뿅` 같은 의도적인
효과음은 그대로 유지한다. 음원 출처는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 기록한다.

---

## 공연장 — 라이브 루퍼

"녹화 버튼이 달린 화면"이 아니라 악기다. 아이가 루프를 하나씩 쌓아 올리는 과정 자체가
작품이 된다.

- **루프 토글은 키캡과 물리적으로 분리된 44pt 히트박스.** 아이 손가락은 크고,
  겹치면 "소리 내려다 루프가 켜지는" 사고가 난다.
- **켜기는 즉시 시각 피드백(깜빡임), 소리는 다음 비트.** 이 0~0.6초의 예고가 없으면
  아이는 "안 눌렸나?" 하고 다시 누른다.
- **비트 펄스는 시각만.** 메트로놈 클릭음을 넣으면 작품에 섞여 들어간 것처럼 들린다.
- **공연 중에는 편집 불가.** 누르기와 루프 토글, 일시정지·계속하기·중단만 허용한다.
  일시정지는 오디오 시계와 화면 진행을 같은 위치에 멈추고, 중단은 예약된 소리까지
  즉시 끈 뒤 저장하지 않고 공연 시작 전으로 돌아간다.
- 공연 후: `방금 공연 다시 보기` / `다시 공연하기` / `이 공연으로 완성`.
  **다시 하기는 필수다** — 15초 한 번에 만족스러운 결과가 나올 확률은 낮다.

준비 단계(무대)에서 켜둔 루프는 기록되지 않고 `KeyDef.loop.enabled`가 되어
**공연 시작 시점의 초기 상태**가 된다. 처음부터 켜놓고 시작하거나, 전부 꺼놓고
공연 중에 하나씩 쌓거나 — 후자가 훨씬 극적이고 그게 이 제품의 자랑거리다.

---

## 두 가지 감상 모드

| | 작품 다시 보기 | 내가 직접 눌러보기 |
|---|---|---|
| 입력 | 차단 | 전체 허용 |
| 루프 초기 상태 | `loop.enabled` 그대로 | 전부 off |
| 길이 | `durationMs`에서 종료 | 무제한 |
| 난수 | `replay.seed` | 새 seed |

공유 링크를 열면 **다시 보기가 먼저** 1회 재생되고, 끝나면 "직접 눌러보기"가 크게 뜬다.
만든 아이의 의도를 먼저 보여준 뒤 장난감을 넘기는 순서다.
키크 스테이지에서 공연을 감상하는 중에는 `일시정지`로 같은 위치에 멈췄다가 계속할 수 있고,
`재생 중단`을 누르면 예약된 소리까지 즉시 끄고 감상 완료 상태로 전환한다.

---

## 6. 로컬·계정 백업·공개 공유

### 로컬 만들기 모드 — 기본값

- 가입이나 익명 계정을 만들지 않는다(앱 시작 시 기존 로그인 세션만 확인)
- 네트워크 전송 **없음**
- 작품·그림·녹음 전부 IndexedDB
- 크리에이터 이름과 아바타 사진을 기기 안에서 변경 가능
- 모든 창작 기능 사용 가능

아이는 여기서 시작해서 여기서 끝낼 수 있다. 이게 기본 경로다.

프로필 이름을 바꾸면 현재 작업과 이 기기에 저장된 모든 작품의 `authorNick`을 함께 바꾼다.
비공개 아바타는 256×256 JPEG로 줄여 로컬 프로필에 저장한다. 이 사진과 Google 계정 사진은
공개 설정을 따로 켜지 않는 한 공개 작품이나 키크 스테이지로 전송하지 않는다.

### 스테이지 공개 아바타 — 명시적 선택

- 기본값은 `stageAvatarEnabled:false`다.
- 나중에도 소유권을 잃지 않고 해제할 수 있도록 Google 계정 연결 후에만 켤 수 있다.
- 사용자가 직접 사진을 선택한 뒤 **스테이지에 프로필 사진 공개**를 켜야 한다.
- Google 계정 사진은 공개용으로 자동 전환하지 않는다.
- 공개본은 다시 128×128 JPEG(50KB 미만)로 줄여 `/publicProfiles/{uid}/avatar.jpg`에 저장한다.
- 공개 여부 문서 `/publicProfiles/{uid}`에는 이름이나 사진 URL을 넣지 않는다.
- 피드는 uid 대신 작품 기반의 작은 URL `/avatar/{workId}`만 받는다. `avatar` Function이
  작품의 공개 상태와 아바타 동의를 확인한 뒤 이미지를 서빙한다.
- 공개를 끄면 허용 문서를 먼저 삭제해 응답을 막고 실제 공개용 파일도 삭제한다.

공개 동의를 하지 않은 피드 카드는 이전처럼 사진 없이 크리에이터 이름만 표시한다.

### Google 계정 백업 — 비공개

프로필에서 명시적으로 **Google 계정 연결**을 누르면 Firebase Auth 계정과 연결한다.

- 기존 익명 uid가 있으면 `linkWithPopup`으로 같은 uid를 유지한다.
- 선택한 Google 계정이 이미 키크에 연결돼 있으면 그 계정으로 전환하고 로컬 작품을 병합한다.
- 작품 메타데이터는 `/users/{uid}/works/{workId}`, 그림·녹음은
  `/users/{uid}/works/{workId}/...`에 소유자 전용으로 백업한다.
- 같은 작품이 양쪽에 있으면 `updatedAt`이 더 최신인 쪽을 사용한다.
- 이후의 저장과 삭제도 계정 백업에 반영한다.
- 프로필은 `/users/{uid}`에 저장하며, 이름과 아바타 모두 소유자만 읽을 수 있다.

계정 연결은 공개 동의가 아니다. Google 계정에 연결해도 작품은 키크 스테이지에 나타나지
않으며, 아래 공유 게이트를 따로 완료해야 공개된다.

### 온라인 공유 모드 — 명시적 관문

공유 버튼을 누르면 공개용 서버 전송이 시작된다. 게이트 화면에서:

1. 업로드될 항목을 쉬운 말로 나열
2. **목소리 처리 선택** — 그대로 / 로봇 목소리로 / 기본 소리로 / 소리 없이
   (업로드 시점에 한 번 처리한다. 재생 이펙트로 하면 원본이 그대로 올라간다)
3. 보호자 확인
4. 공유 기간 (7일 / 30일 / 계속)
5. 언제든 공유 중단 → 문서·자산 **실제 삭제**
6. 공유 완료된 작품의 제목·별명·미리보기는 **키크 스테이지에서 누구나 발견 가능**

음성 변형을 "완전 익명"이라고 표기하지 않는다. "목소리를 바꿔서 올려요" 정도의 사실 서술만 한다.
맞춤형 광고·행태정보 수집은 넣지 않는다.

### 공유 트랜잭션 순서

```
1. 익명 인증 확보 (여기서 처음 계정이 생긴다)
2. Firestore에 visibility:'local'로 문서 선생성 → 소유권 확정
3. 자산 업로드 (실패 시 재시도 3회)
4. 썸네일 업로드
5. 문서 갱신: remotePath 채우고 visibility:'link', discoverable:true → 링크와 키크 스테이지 활성화
```

2번을 먼저 하는 이유는 Storage 쓰기 규칙이 "작품 문서가 있고 내가 소유자인가"를 검사하기
때문이다. 3~5 사이에 실패하면 문서는 `local`로 남고 링크는 열리지 않는다.
**미완성 상태가 공유되는 사고가 구조적으로 없다.**

### 키크 스테이지 (공개 피드)

현재 공유 게이트에서 공개 안내를 확인한 `visibility:'link'`, `discoverable:true` 작품은
키크 스테이지에 최신순으로 표시된다. `link`라는 내부 값은 스키마 v2 호환을 위해 유지하고,
`discoverable`로 공개 목록 동의 여부를 분리한다. 과거의 “링크를 받은 사람만” 안내로 공유된
작품에는 이 필드가 없으므로 피드에 소급 노출하지 않는다. 공개하려면 공유를 중단한 뒤 현재
게이트를 거쳐 다시 공유해야 한다.

클라이언트에 `/works` 컬렉션 `list` 권한을 열지는 않는다. `listPublicFeed` Function이
공개·미만료 작품을 최대 24개 조회한 뒤 `id`, 제목, 힌트, 별명, 공연 길이, 생성 시각만
돌려준다. `authorUid`, 자산 경로, 키 설정, 리플레이 이벤트는 피드 응답에 포함하지 않는다.
기간 만료·공유 중단 작품도 피드에서 제외된다.

---

## Firebase

- **Firestore**: `/works/{id}` — `get`과 `list`를 분리하고 **클라이언트 list는 열지 않는다**.
  공개 피드 목록은 Admin SDK를 쓰는 `listPublicFeed`가 최소 필드만 중계한다. 집계는 `/workStats/{id}`로 분리하고
  작품 문서에 `stats`를 심으려는 시도는 규칙에서 거부한다.
- **계정 백업**: `/users/{uid}` 아래의 프로필·작품·자산은 해당 Google 계정 소유자만
  읽고 쓸 수 있다. 공개 공유 경로와 분리한다.
- **공개 아바타**: 별도 Storage 경로의 128px JPEG를 `avatar` Function만 읽는다.
  피드 응답에는 `authorUid`나 비공개 사진 URL 없이 `/avatar/{workId}`만 포함한다.
- **공개 Storage**: 읽기는 열고 **쓰기만 잠근다**. 이건 인지하고 가는 트레이드오프다 —
  읽기까지 `firestore.get()`으로 검사하면 ⓐ 카카오톡 크롤러가 토큰 URL을 못 따라가
  og:image가 깨지고, ⓑ 작품 하나 열 때 자산 수만큼 Firestore read가 청구된다
  (조회 10만 건 = 80만 read). 공개 완료된 작품과 자산은 피드에서도 발견 가능하다.
  업로드 중 `local` 상태의 짧은 구간은 추측 불가능한 경로로 우발 접근을 막고,
  **공유 중단 시 파일을 실제로 지우는 것**으로 값을 치른다.
- **Functions** (Blaze 등록 필요): `shareMeta`(OG 태그), `thumb`(썸네일), `avatar`(공개 아바타),
  `listPublicFeed`(공개 피드), `recordPlay`(App Check + 중복 방지), `unshareWork`(자산 실제 삭제).

초기 사용량은 무료 할당량 안에서 운영될 가능성이 높으나, **Functions 배포를 위해
Blaze 등록 및 결제 계정 연결은 필요하다.**

---

## 테스트

```bash
npm test
```

자동 검증되는 것:

- **라이브 = 리플레이** — 실시간 스케줄러의 발화가 `expandReplay` 재계산과 정확히 일치
- **2분간 드리프트 없음** — 시계·타이머를 주입하고 지터를 준 채 2분치를 즉시 돌린다(오차 < 1e-9초)
- **루프 양자화** — 켜기가 다음 비트 경계로 밀리는지, offset 이전에 안 울리는지
- **마디 단위 길이** — 세 템포 모두 15초 이하 최대 마디, 마지막 비트가 안 잘림
- **난수 안정성** — 중간에 값을 1000번 더 뽑아도 원래 값이 안 흔들림
- **WAV 규격** — 16bit mono PCM, 샘플 왕복, 1.5초/200KB 상한
- **녹음 소리 재시도** — 자산 등록 전 로드가 실패해도 실패 캐시를 버리고 다음 preload에서 복구
- **키캡 타건음** — 실제 녹음 프리셋이 앱 내부 파일로 연결되고 사용자 자산 resolver와 분리되는지 검증
- **피드 응답 검증** — 최소 필드만 허용하고 잘못된 id·공연 길이를 제거

## 아직 검증되지 않은 것

- **iOS·Android 실기기 교차 녹음/재생.** WAV가 이 문제를 구조적으로 피하게 돼 있지만,
  실기기 두 대로 직접 확인해야 한다. 시뮬레이터로는 오디오 지연과 마이크 문제를 못 잡는다.
- **카카오톡 실제 미리보기.** Functions·Hosting 배포 후 링크를 보내봐야 안다.
- **업로드 경로 전체.** Storage가 아직 설정되지 않아 그림·소리 업로드는 확인하지 못했다.
  [FIREBASE.md](FIREBASE.md) 참조.

### 이미 검증된 것 (실물 백엔드)

Firestore 보안 규칙은 keyc-studio에 배포하고 **실제로 확인했다** — 소유자 생성/읽기 허용,
`list` 거부, `stats` 주입 거부, 남의 uid 생성 거부, 미인증자의 `local` 읽기 403,
미인증자의 `link` 읽기 200. 다만 이건 수동 확인이므로 Emulator Suite로 자동화해
회귀를 막아야 한다.

---

## 일정 (11주 + 테스트 2주)

| 주 | 목표 |
|---|---|
| 1 | 오디오 커널 |
| 2 | 루프 스케줄러 |
| **3** | **결정론 계층** — 나중에 끼워 넣으려면 애니메이션·파티클 코드를 전부 뜯어야 한다 |
| 4 | 그리기 캔버스 |
| **5** | **녹음 파이프라인** — iOS↔Android 교차 검증 (최대 위험) |
| 6 | 움직임·LED 프리셋 |
| 7 | 공연장 (준비 단계) |
| **8** | **공연장 (라이브)** — 루프 토글·양자화 (최대 위험) |
| 9 | 감상 2모드 |
| 10 | Firebase + 공유 트랜잭션 |
| 11 | OG·썸네일·마감 |
| 12~13 | 사용자 테스트 (초등학생 15~20명) |

**두 기기 실물을 1주차 전에 확보할 것.**

---

## 범위 밖 (v1에 넣지 않음)

LED 패턴 에디터, 재질 8종(필드만 확보), 흔적 시스템(필드만 확보), 비밀 반응(빈 배열만 확보),
표정 변화(필드만 확보), 센서, 리믹스, mp4 내보내기.

**선반영이 싼 것과 비싼 것을 구분했다.** 값이 확정된 enum(`haptic`, `material`, `face`,
`trace.type`, `secrets: []`)은 지금 넣었고, 구조가 미정인 것(`expressions`,
`trace`의 lifetime·개수·방향, LED 커스텀 타임라인)은 넣지 않았다. 빈 껍데기는 지금 넣어도
어차피 재설계되고, 그때 마이그레이션 비용은 필드가 없을 때와 같다.
`Secret.trigger`도 v1.5에 구현할 `pressCount` 하나만 뒀다 — TypeScript 유니온은
케이스 추가가 파괴적 변경이 아니다.
