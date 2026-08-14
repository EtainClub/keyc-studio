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
      build: 'tsc --noEmit && vite build',
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
  outdir: 'dist',
});
