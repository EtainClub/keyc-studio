# Firebase 연동 상태 (keyc-studio)

프로젝트: **keyc-studio** (359378996338) · 리전: **asia-northeast3(서울)**

`.env`에 웹 앱 설정이 들어가 있고 `.firebaserc`가 이 프로젝트를 가리킨다.
웹 API 키는 비밀이 아니다 — 클라이언트 번들에 그대로 들어가고 프로젝트를 식별할 뿐이며,
실제 보호는 아래 보안 규칙이 한다.

---

## 완료된 것

| 항목 | 상태 |
|---|---|
| 웹 앱 설정(`.env`) | ✅ 앱이 config를 읽고 초기화됨 |
| 익명 로그인 | ✅ 실제 uid 발급 확인 |
| Firestore 데이터베이스 | ✅ `(default)` 생성됨 |
| 공개 작품 Firestore 보안 규칙 | ✅ 기존 버전 배포·검증 완료 |
| 프로필·계정 백업 규칙 | 🟡 코드 반영, 재배포 필요 |
| 공개 아바타 규칙·Function | 🟡 코드 반영, 재배포 필요 |
| Google 로그인 제공업체 | 🟡 콘솔에서 활성화 필요 |

### 배포된 규칙을 실물에서 검증한 결과

| 케이스 | 결과 |
|---|---|
| 소유자가 작품 생성 | 허용 ✅ |
| 소유자가 자기 `local` 작품 읽기 | 허용 ✅ |
| 컬렉션 목록 조회(`list`) | **거부** ✅ |
| `stats` 필드 주입 시도 | **거부** ✅ |
| 남의 uid로 작품 생성 | **거부** ✅ |
| 미인증 사용자가 `local` 작품 읽기 | **403 거부** ✅ |
| 미인증 사용자가 `link` 작품 읽기 | 200 허용 ✅ |

마지막 두 줄이 이 제품의 공유 전제다 — 공개 작품은 로그인 없이 링크와 피드에서 볼 수 있고,
`local` 작품은 주인만 본다. 클라이언트의 문서 전체 `list`는 계속 거부하고,
공개 목록은 `listPublicFeed`가 최소 메타데이터만 반환한다.

---

## 남은 것

### 1. Google 로그인 켜기 (콘솔에서만 가능)

Firebase Console → **Authentication → Sign-in method → Google**에서 제공업체를 사용 설정하고
프로젝트 지원 이메일을 선택한다. 배포 도메인이 Authentication의 **승인된 도메인** 목록에
없다면 함께 추가한다.

앱은 팝업 방식으로 현재 익명 사용자와 Google 자격 증명을 연결한다. 이미 연결된 Google
계정을 선택하면 그 계정으로 로그인한 뒤 이 기기의 로컬 작품을 최신 수정 시각 기준으로
병합한다. Google 계정 연결만으로 작품이 공개되지는 않는다.

### 2. Storage 시작하기 (콘솔에서만 가능)

CLI로는 안 된다. 리전 선택과 약관 동의가 필요해서 콘솔 1회 클릭이 필수다.

> https://console.firebase.google.com/project/keyc-studio/storage → **시작하기**
> 리전은 Firestore와 같은 **asia-northeast3**으로 맞출 것.

끝나면:

```bash
npx firebase deploy --only firestore:rules,storage
npm run deploy:cors
```

두 번째 명령은 [`firebase-storage-cors.json`](firebase-storage-cors.json)을 Storage 버킷에
적용한다. Firebase 배포는 Storage Rules와 버킷 CORS를 별개로 취급하므로, 이 단계를 빼면
공개 WAV 파일이 200으로 존재해도 다른 출처의 브라우저에서는 CORS 오류로 재생되지 않는다.

이 배포에는 공개 `/works` 규칙뿐 아니라 소유자만 접근하는 `/users/{uid}` 프로필·작품,
`/users/{uid}/works/...` 자산 백업, `/publicProfiles/{uid}` 공개 동의와 공개용 128px JPEG
쓰기 규칙도 포함된다. 공개용 JPEG는 Storage에서 직접 읽을 수 없고 `avatar` Function만
Admin SDK로 읽는다. 재배포하기 전에는 계정 동기화와 공개 아바타가 권한 오류로 실패한다.

이게 되기 전까지 그림·소리 업로드는 실패한다(공유 게이트가 "저장 공간이 준비되지
않았어요"로 안내한다).

### 3. Functions 배포 (Blaze 요금제 필요)

```bash
cd functions && npm install && cd ..
npx firebase deploy --only functions
npm run deploy:functions:iam
```

callable Function은 Firebase Auth·App Check를 함수 안에서 검증하지만, 브라우저의 프리플라이트가
Cloud Run까지 도달하도록 서비스 IAM의 `roles/run.invoker`를 `allUsers`에 열어야 한다. 위 npm
명령이 공개 피드·재생 집계·공유 중단 함수에 그 전송 권한을 적용한다.

Functions 배포에는 **Blaze 등록(결제 계정 연결)이 필수**다. 초기 사용량은 무료
할당량 안에서 운영될 가능성이 높지만, 등록 자체는 피할 수 없다.

배포되는 함수 여섯: `shareMeta`(OG 태그) · `thumb`(썸네일 서빙) ·
`avatar`(공개 아바타 서빙) · `listPublicFeed`(공개 피드) · `recordPlay`(집계) ·
`unshareWork`(공유 중단 시 자산 실제 삭제).

공개 피드는 `visibility == 'link'`, `discoverable == true`, `createdAt desc` 복합 인덱스가 필요하다. Functions보다
인덱스를 먼저 배포하고 Firebase 콘솔에서 빌드 완료를 확인한다:

```bash
npx firebase deploy --only firestore:indexes
```

**`unshareWork`가 배포되기 전에는 공유 기능을 열면 안 된다.** Storage 읽기를
열어 둔 대가가 "공유 중단 시 파일을 확실히 지운다"는 약속이고, 그 약속을 지키는 게
이 함수다. (없으면 클라이언트가 문서만 지우고 파일은 남는다.)

### 4. App Check

`listPublicFeed`, `recordPlay`, `unshareWork`는 `enforceAppCheck`를 환경변수로 받는다.
**기본값은 꺼짐** — App Check를 등록하기 전에 켜면 모든 호출이 거부되기 때문이다.

App Check(reCAPTCHA v3) 설정을 마친 뒤 `functions/.env`에:

```
ENFORCE_APP_CHECK=true
```

일반 공개 전에 반드시 켤 것.

### 5. Hosting 배포

```bash
npm run build
npx firebase deploy --only hosting
```

`/w/**`와 `/thumb/**` rewrite가 Functions를 가리키므로 Functions 배포 후에 해야
카카오톡 미리보기가 정상 동작한다.

---

## 일부러 하지 않은 것

**Analytics를 넣지 않았다.** 콘솔에서 받은 `measurementId(G-DC2XMYPKT4)`를
`.env`에 넣지 않았고 `firebase/analytics`도 import하지 않는다.
설계서가 "맞춤형 광고·행태정보 수집은 넣지 않는다"고 못박았고, 대상이 아동이라
행태정보 수집은 별도 검토 사항이다. 필요해지면 그때 다시 판단할 것.

---

## 문제가 생겼을 때

앱은 백엔드가 덜 준비돼도 **만들기·공연·저장이 전부 로컬에서 돌아간다.**
공유만 막히고, 그때 화면에 나오는 문구로 원인을 짚을 수 있다:

| 화면 문구 | 원인 |
|---|---|
| 공유 기능이 아직 준비되지 않았어요 | 익명 로그인 미설정 |
| Google 로그인이 아직 준비되지 않았어요 | Google 제공업체가 비활성화됨 |
| 현재 주소에서는 Google 로그인을 사용할 수 없어요 | 승인된 도메인에 현재 호스트가 없음 |
| 프로필/작품 동기화 권한 오류 | 최신 Firestore·Storage 규칙 미배포 |
| 공유 권한이 없어요 | 보안 규칙 미배포 |
| 저장 공간이 준비되지 않았어요 | Storage 미설정 |
| 서버 기능이 아직 켜지지 않았어요 | Firebase API 미활성화 |
| 서버가 응답하지 않아요 (…) | 15초 타임아웃 — 네트워크 또는 DB 미생성 |

마지막 항목이 있는 이유: **Firestore SDK는 연결이 안 되면 에러를 주지 않고 무한히
재시도한다.** 그대로 두면 공유 버튼이 "올리는 중…"에서 영원히 멈춘다.
