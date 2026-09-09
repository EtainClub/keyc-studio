import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const packageJson = createRequire(import.meta.url)('./package.json') as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    /*
     * 토스 미니앱용 빌드인가. granite.config.ts의 빌드 명령이 VITE_TOSS=1을 준다.
     *
     * 웹뷰 안에서만 달라져야 하는 것(뒤로가기를 그리지 않는 것)이 런타임 감지에만
     * 기대면, 네이티브 브리지가 늦게 붙는 순간 조용히 틀린다 — 그리고 그건 심사
     * 반려로 돌아온다. 산출물 자체에 박아 두면 틀릴 여지가 없다.
     */
    __TOSS_BUILD__: JSON.stringify(process.env.VITE_TOSS === '1'),
  },
  build: {
    /*
     * 웹(Firebase Hosting) 산출물은 `dist`가 아니라 `dist-web`이다.
     *
     * `ait build`는 시작할 때 패키지 루트의 `dist`를 통째로 지운다(CLI 하드코딩,
     * outdir 설정과 무관하다). 호스팅 결과를 `dist`에 두면 토스 빌드를 한 번
     * 돌리는 것만으로 배포할 파일이 사라지거나 토스용 레이아웃(dist/web + RN 번들)으로
     * 바뀌고, 그대로 `firebase deploy --only hosting`을 하면 Page Not Found인
     * 사이트가 올라간다 — 실제로 그렇게 한 번 내려갔다. 디렉터리를 갈라 둔다.
     * (firebase.json의 hosting.public과 같은 값이어야 한다.)
     */
    outDir: 'dist-web',
    // 감상 화면이 첫 방문이자 대부분의 방문이다. 초기 번들을 작게 유지한다.
    target: 'es2020',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
