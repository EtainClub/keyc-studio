import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 앱인토스 콘솔에 등록한 appName과 반드시 같아야 한다.
  appName: 'keyc-studio',
  brand: {
    displayName: '키캡 크리에이터',
    primaryColor: '#FFD400',
    icon: 'https://keyc.studio/appintoss-submission/app-logo-light-600x600.png',
  },
  web: {
    host: 'localhost',
    port: 5173,
    commands: {
      dev: 'vite --host 0.0.0.0',
      /*
       * outdir과 같은 곳으로 뽑아야 한다 — ait CLI가 <outdir>에서 웹 결과를
       * 집어 <outdir>/web으로 다시 담는다. 어긋나면 "Web build output is empty".
       *
       * VITE_TOSS=1은 __TOSS_BUILD__로 들어간다(vite.config.ts). 이 산출물은
       * 토스 웹뷰 안에서만 열리므로, 뒤로가기를 그릴지 말지를 런타임 감지가
       * 아니라 빌드 시점에 확정한다. 앞에 붙이지 말고 `vite` 바로 앞에 둘 것 —
       * CLI가 명령 전체를 패키지 매니저에 넘겨서, 맨 앞이면 실행 파일 이름이 된다.
       */
      build: 'tsc --noEmit && VITE_TOSS=1 vite build --outDir dist-ait --emptyOutDir',
    },
  },
  webViewProps: {
    type: 'partner',
    bounces: false,
    pullToRefreshEnabled: false,
    mediaPlaybackRequiresUserAction: true,
  },
  permissions: [
    {
      name: 'microphone',
      access: 'access',
    },
  ],
  /*
   * 토스 산출물은 웹 배포용 dist와 **다른 디렉터리**에 쌓는다.
   *
   * `ait build`는 vite 결과를 `<outdir>/web/`으로 옮기고 그 옆에 RN 번들을 둔다.
   * 예전처럼 둘 다 'dist'를 쓰면, 토스 빌드를 한 번 돌린 순간 `dist/index.html`이
   * 사라져 `firebase deploy --only hosting`이 Page Not Found인 사이트를 올린다
   * — 실제로 그렇게 한 번 내려갔다. 디렉터리를 갈라 두면 둘이 서로를 지우지 않는다.
   */
  outdir: 'dist-ait',
});
