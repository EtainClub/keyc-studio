import { describe, expect, it } from 'vitest';
import {
  normalizeProfile,
  PROFILE_AVATAR_MAX_CHARS,
  PROFILE_NAME_MAX,
} from './identity';

describe('normalizeProfile', () => {
  it('이름의 공백을 정리하고 유니코드 글자 수를 제한한다', () => {
    const name = `  ${'🎹'.repeat(PROFILE_NAME_MAX + 3)}  `;
    const profile = normalizeProfile({ name, customized: true }, '키크');

    expect(Array.from(profile.name)).toHaveLength(PROFILE_NAME_MAX);
    expect(profile.name).toBe('🎹'.repeat(PROFILE_NAME_MAX));
    expect(profile.customized).toBe(true);
  });

  it('비어 있는 이름은 안전한 대체 이름을 사용한다', () => {
    expect(normalizeProfile({ name: '   ' }, '키크친구').name).toBe('키크친구');
  });

  it('지원하는 data URL과 HTTPS 사진만 허용한다', () => {
    expect(normalizeProfile({ avatarUrl: 'data:image/jpeg;base64,AA==' }, '키크').avatarUrl)
      .toBe('data:image/jpeg;base64,AA==');
    expect(normalizeProfile({ avatarUrl: 'https://example.com/avatar.webp' }, '키크').avatarUrl)
      .toBe('https://example.com/avatar.webp');
    expect(normalizeProfile({ avatarUrl: 'http://example.com/avatar.png' }, '키크').avatarUrl)
      .toBeNull();
    expect(normalizeProfile({ avatarUrl: `data:image/png;base64,${'A'.repeat(PROFILE_AVATAR_MAX_CHARS)}` }, '키크').avatarUrl)
      .toBeNull();
  });

  it('공개 아바타는 기본으로 꺼지고 직접 선택한 사진에만 허용된다', () => {
    const custom = normalizeProfile({
      avatarUrl: 'data:image/jpeg;base64,AA==',
      stageAvatarEnabled: true,
    }, '키크');
    const google = normalizeProfile({
      avatarUrl: 'https://lh3.googleusercontent.com/avatar.jpg',
      avatarSource: 'google',
      stageAvatarEnabled: true,
    }, '키크');

    expect(custom.avatarSource).toBe('custom');
    expect(custom.stageAvatarEnabled).toBe(true);
    expect(google.stageAvatarEnabled).toBe(false);
    expect(normalizeProfile({}, '키크').stageAvatarEnabled).toBe(false);
  });
});
