# 배포 절차 — v0.8.0 (그룹 개방 + 기기 복구)

이 판에서 **배포 단계가 하나 늘었다.** `npm run deploy:functions:signer`(서비스 계정 토큰
생성자 권한)를 건너뛰면 다른 기능은 전부 멀쩡히 돌면서 **기기 복구만 조용히 실패한다.**
계정 없이 쓰는 사용자에게 복구 실패는 곧 작품 유실이므로, 이 문서의 3단계를 빠뜨리지 말 것.

일반적인 Firebase 설정·규칙·인덱스 설명은 [FIREBASE.md](../FIREBASE.md)에, 프로젝트 전반은
[README.md](../README.md)에 있다. 여기에는 **이번 배포에서 실제로 손을 움직여야 하는 것**만 적는다.

---

## 0. 이 판에서 바뀌는 것

| 바뀐 것 | 영향 |
|---|---|
| `createGroup`에서 Google 계정 요구 제거 | 익명 계정도 그룹 주최 가능. uid당 10분 3회 생성 제한이 대신 붙는다 |
| 신규 callable 3종 (`issueRecoveryCode`·`getRecoveryStatus`·`redeemRecoveryCode`) | **IAM 서명 권한 필요** (아래 3단계) |
| Firestore 규칙에 `recoveryCodes`·`recoveryOwners` 추가 | 둘 다 클라이언트 접근 전면 차단(추가만, 기존 규칙 불변) |
| 익명 계정 클라우드 백업 | **opt-in.** 복구 코드를 만든 사람에게만 켜진다 — 기존 사용자 데이터가 저절로 올라가지 않는다 |
| 그룹 탭 활용 안내 모달 | 프런트엔드만. Hosting 배포로 끝 |

스테이징 프로젝트가 없다. **배포는 곧 프로덕션 반영이다.** 변경 성격이 완화·추가 위주라
되돌리기는 쉽다(→ [6. 롤백](#6-롤백)).

## 1. 배포할 수 있는 환경인가

Termux/proot(android-arm64) 같은 환경에서는 **배포할 수 없다.** CLI가 없어서가 아니라
빌드가 안 된다 — `typescript`, `lightningcss`, `rolldown` 모두 그 플랫폼용 네이티브
바이너리를 배포하지 않는다. `npm run build`가 실패하는 기기에서는 이 문서를 따라가도 소용없다.

필요한 것:

- Node.js 22.12 이상, npm
- `firebase-tools` (`npm i -g firebase-tools`)
- Google Cloud CLI (`gcloud`) — CORS와 IAM 두 단계에서만 쓴다. 없으면 콘솔로 대신할 수 있다(3단계 참고)
- `keyc-studio` 프로젝트의 편집 권한, Blaze 요금제 연결
- `.env` 여섯 값 (Firebase 콘솔 → 프로젝트 설정 → 내 앱 → 웹 앱)

**서비스 계정 키(`sa.json`)는 필요 없다.** `firebase login`(대화형)이면 충분하고, 배포된
함수는 런타임에 GCP 기본 자격증명(ADC)을 쓴다. 키가 필요한 경우는 브라우저가 없는 CI뿐인데,
그 키는 Functions 배포와 IAM 수정 권한까지 갖게 되므로 꼭 필요할 때만 만든다.

## 2. 배포 전 검증

```bash
npm ci
npm --prefix functions ci
cp .env.example .env        # 아직 없다면. 여섯 값을 채운다

npm test                    # 복구 코드 형식·백업 opt-in·안내 모달 노출 규칙
npm run typecheck
npm run build
node functions/smoke-load.mjs   # 16개 함수가 실제로 로드되는지
```

`npm run build`는 프런트엔드만 본다. `smoke-load`는 Cloud Run 컨테이너가 기동할 때 하는
일과 같아서, "배포는 됐는데 함수가 뜨다 죽는" 경우를 5분짜리 배포 전에 잡는다.

```bash
firebase login
firebase use keyc-studio
firebase use                # 출력이 keyc-studio인지 눈으로 확인
```

## 3. 배포

순서가 있다. 규칙 → 함수 → IAM → 호스팅이다. 규칙보다 함수가 먼저 뜨면 새 컬렉션에
클라이언트 접근이 잠깐 열려 있는 창이 생기고, Hosting이 먼저 뜨면 새 화면이 아직 없는
함수를 부른다.

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
npm run deploy:cors
firebase deploy --only functions
npm run deploy:functions:iam
npm run deploy:functions:signer     # ★ 이번 판에서 새로 생긴 단계
firebase deploy --only hosting
```

익숙해진 뒤에는 `npm run deploy` 한 줄로 같은 일을 한다(빌드 → 전체 배포 → CORS → IAM → 서명 권한).

### 3-0. 웹 빌드와 토스 빌드는 디렉터리가 다르다

| 명령 | 산출물 | 쓰이는 곳 |
| --- | --- | --- |
| `npm run build` | `dist-web/` | Firebase Hosting (`firebase.json`의 `hosting.public`) |
| `npm run build:ait` | `dist-ait/` + `keyc-studio.ait` | 앱인토스 콘솔 업로드 |

`ait build`는 시작할 때 패키지 루트의 `dist/`를 통째로 지운다(CLI에 하드코딩돼 있고
`granite.config.ts`의 `outdir`과 무관하다). 예전처럼 둘 다 `dist`를 쓰면 토스 빌드 뒤에
호스팅으로 올릴 파일이 사라져 **Page Not Found인 사이트가 배포된다** — 실제로 한 번
그렇게 내려갔다. 그래서 `dist-web`과 `dist-ait`으로 갈라 뒀고, 이제 둘은 서로를 지우지
않는다. 호스팅 배포 전에는 `npm run build`를 돌린 그 결과인지만 확인하면 된다.

**`build:ait`·`deploy:ait`는 `dist-ait`을 먼저 지운다. 이 `rm -rf`를 빼지 말 것.**
`ait build`는 `<outdir>/web/index.html`이 이미 있으면 **웹 빌드를 통째로 건너뛰고 그
디렉터리를 그대로 다시 포장한다**(CLI의 `ensurePrepared`). outdir이 `dist`였을 때는 CLI가
매번 `dist`를 지워서 드러나지 않던 동작인데, `dist-ait`으로 옮긴 뒤로는 아무도 지우지 않아
**어제 번들이 든 `.ait`이 조용히 만들어진다.** 실제로 이것 때문에 고친 코드가 안 들어간
빌드를 제출해 같은 사유로 두 번 반려됐다. 빌드 뒤 `dist-ait/web/index.html`의 시각이
방금인지 한 번 보면 확실하다.

토스 산출물은 `VITE_TOSS=1`로 빌드돼 `__TOSS_BUILD__`가 참이다(`vite.config.ts`).
화면 왼쪽 위 뒤로가기는 이 값으로 감춘다 — 토스가 자기 내비게이션 바에 뒤로가기를
이미 그리기 때문이다(`src/platform/toss.ts`). 그래서 **`dist-ait/web`을 그냥 브라우저로
열어도 뒤로가기가 없어야 정상**이다. 있으면 그 `.ait`은 제출하면 안 된다.

### 3-1. 서명 권한이 무엇이고 왜 필요한가

`redeemRecoveryCode`는 복구 코드를 확인한 뒤 **원래 uid로 커스텀 토큰을 발급**한다. 그 토큰에
서명하려면 함수를 실행하는 서비스 계정이 **자기 자신에 대해** `roles/iam.serviceAccountTokenCreator`를
가져야 한다. `npm run deploy:functions:signer`가 그 바인딩을 건다.

`gcloud`가 없거나 권한이 막혔다면 콘솔에서 같은 일을 할 수 있다:

> GCP 콘솔 → **IAM 및 관리자 → 서비스 계정** →
> `{프로젝트번호}-compute@developer.gserviceaccount.com` 선택 → **권한** 탭 →
> **액세스 권한 부여** → 주 구성원에 **같은 서비스 계정 이메일을 그대로** 입력 →
> 역할 **서비스 계정 토큰 생성자(Service Account Token Creator)** → 저장

권한이 없을 때의 증상은 눈에 잘 안 띈다. 그룹도 공유도 멀쩡히 돌고 **복구만** 실패한다:

- 사용자 화면: "복구 토큰을 만들지 못했어요. 서비스 계정에 토큰 생성 권한이 필요해요"
- Functions 로그: `[recovery] 커스텀 토큰을 만들지 못했어요`

## 4. 배포 후 확인

Firebase Emulator로는 확인할 수 없다 — 프런트엔드에 `connectAuthEmulator` 계열 연결 코드가
없어서 에뮬레이터를 띄워도 앱은 실제 프로젝트를 바라본다. 아래는 전부 **실 배포 후 브라우저**로 한다.

1. Firebase 콘솔에서 함수 16개가 `asia-northeast3`에 있는지 확인한다.
2. **시크릿 창**으로 접속 → `/feed` → [그룹] 탭 → 안내 모달이 뜬다 → [다음에 보지 않기] →
   새로고침해도 안 뜬다 → `? 그룹 활용법` 버튼으로 다시 열린다.
3. **Google 로그인 없이** [그룹 만들기] → 이름 입력 → 초대 코드가 나오고, 그 아래
   "주최자 자리를 지켜두세요" 패널이 보인다.
4. [복구 코드 만들기] → 16자 코드를 **적어 둔다.** (해시만 저장하므로 다시 볼 수 없다.)
5. 작품을 하나 만들고 3초쯤 기다린다(백업 예약이 1.8초 뒤에 돈다).
6. **다른 브라우저 또는 다른 기기**에서 접속 → 프로필 → [복구 코드로 되찾기]에 코드 입력 →
   [되찾기] → 홈에 그 작품이 나타난다. ← **이번 판의 핵심 검증이다.**
7. 되찾은 계정의 [그룹] 탭에 3번에서 만든 그룹이 그대로 있고, 주최자로서 초대 코드가 보인다.
8. 프로필에서 [새 복구 코드 만들기] → 4번의 옛 코드로 되찾기를 시도하면
   "그런 복구 코드가 없어요"로 거부된다.
9. 그룹 스테이지 헤더에 `참가자 N명 · 최대 100명까지 들어올 수 있어요`가 보인다.

6번이 실패하고 8번이 정상이면 백업 쪽(작품 동기화), 6번이 "복구 토큰" 문구로 실패하면
3-1의 서명 권한 문제다. 둘은 원인이 완전히 다르니 증상을 구별해서 볼 것.

## 5. App Check

`ENFORCE_APP_CHECK=true`를 이미 켠 프로젝트라면, 새 함수 3종도 같은 설정을 따른다
(`CALLABLE_OPTIONS`를 공유한다). 아직 App Check를 등록하지 않았다면 켜지 말 것 — 켜는 순간
모든 callable이 거부된다. 자세한 것은 [FIREBASE.md](../FIREBASE.md)의 App Check 절.

## 6. 롤백

```bash
git checkout <이전 커밋>
npm ci && npm run build
firebase deploy --only hosting,functions
```

규칙은 되돌릴 필요가 없다(새 컬렉션 차단만 추가했다). 되돌려도 이미 발급된 복구 코드는
`recoveryCodes`에 남아 있으므로, 나중에 다시 배포하면 그대로 동작한다.

되돌릴 때 유일하게 신경 쓸 것: 이전 판의 `createGroup`은 **Google 계정만** 그룹을 만들 수
있다. 롤백 뒤에는 익명 주최자가 새 그룹을 못 만든다(이미 만든 그룹은 그대로 돈다).
