/**
 * 실제 기계식 키보드 단일 타건 녹음 프리셋.
 *
 * 파일은 앱과 함께 배포하고 화면 진입 때 AudioBuffer로 디코드한다. 재생 시점에는
 * 네트워크나 디코딩을 기다리지 않고 SoundBank의 동기 캐시만 사용한다.
 * 출처와 라이선스는 THIRD_PARTY_NOTICES.md에 기록한다.
 */

import { t } from '../i18n';

const FILES: Readonly<Record<string, string>> = {
  'realTactile9@1': 'keycap-tactile-9.mp3',
  'realTactile8@1': 'keycap-tactile-8.mp3',
  'realTactile14@1': 'keycap-tactile-14.mp3',
  'realMxBlue@1': 'keycap-mx-blue.mp3',
};

export function isRecordedPresetAvailable(id: string): boolean {
  return id in FILES;
}

export function recordedPresetUrl(id: string): string | undefined {
  const file = FILES[id];
  if (!file) return undefined;
  return `${import.meta.env.BASE_URL}${file}`;
}

export async function loadRecordedPreset(id: string): Promise<ArrayBuffer> {
  const url = recordedPresetUrl(id);
  if (!url) throw new Error(t('engine.presetUnregistered', { id }));
  const response = await fetch(url);
  if (!response.ok) throw new Error(t('engine.presetLoadFailed', { status: response.status }));
  return response.arrayBuffer();
}
