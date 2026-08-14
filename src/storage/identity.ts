/**
 * 신원.
 *
 * ── 이전 판단을 정정한 부분 ──
 * "익명 로그인만 쓰면 만 14세 미만 법정대리인 동의 문제를 구조적으로 회피한다"는
 * **틀린 설명이었다.** 동의 필요 여부는 로그인 방식이 아니라 아동의 개인정보를
 * 수집·이용하는가로 판단되고, 아이 목소리·그림·작품 기록은 명백히 그 대상이다.
 * 익명 인증은 서버 측 소유권 판별용 기술 수단일 뿐이며, 동의를 대체하지 않는다.
 *
 * 로컬 프로필은 계정 없이도 쓸 수 있고, 서버 소유권이 필요한 공유·계정 연결에서만
 * Firebase 익명 인증을 만든다.
 */

import { t } from '../i18n';
import { generateNickname } from '../work-model/nickname';
import { ensureSignedIn } from './firebase';

const NICK_KEY = 'keycap.nickname';
const PROFILE_KEY = 'keyc.creator-profile.v1';
export const PROFILE_NAME_MAX = 20;
export const PROFILE_AVATAR_MAX_CHARS = 220_000;

export type AvatarSource = 'custom' | 'google' | null;

export type CreatorProfile = {
  name: string;
  avatarUrl: string | null;
  avatarSource: AvatarSource;
  stageAvatarEnabled: boolean;
  customized: boolean;
};

export function normalizeProfile(value: unknown, fallbackName = generateNickname()): CreatorProfile {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const proposedName = typeof raw.name === 'string' ? raw.name.trim() : '';
  const name = Array.from(proposedName || fallbackName).slice(0, PROFILE_NAME_MAX).join('');
  const proposedAvatar = typeof raw.avatarUrl === 'string' ? raw.avatarUrl : '';
  const avatarUrl =
    proposedAvatar.length <= PROFILE_AVATAR_MAX_CHARS &&
    (/^data:image\/(?:png|jpeg|webp);base64,/i.test(proposedAvatar) || /^https:\/\//i.test(proposedAvatar))
      ? proposedAvatar
      : null;
  const inferredSource: AvatarSource = avatarUrl?.startsWith('data:image/')
    ? 'custom'
    : avatarUrl?.startsWith('https://')
      ? 'google'
      : null;
  const avatarSource = avatarUrl && (raw.avatarSource === 'custom' || raw.avatarSource === 'google')
    ? raw.avatarSource
    : inferredSource;
  const stageAvatarEnabled = raw.stageAvatarEnabled === true && avatarSource === 'custom';
  return {
    name,
    avatarUrl,
    avatarSource,
    stageAvatarEnabled,
    customized: raw.customized === true,
  };
}

export function creatorProfile(): CreatorProfile {
  const fallback = nickname();
  try {
    const saved = localStorage.getItem(PROFILE_KEY);
    return normalizeProfile(saved ? JSON.parse(saved) : null, fallback);
  } catch {
    return normalizeProfile(null, fallback);
  }
}

export function saveCreatorProfile(profile: CreatorProfile): CreatorProfile {
  const normalized = normalizeProfile(profile, nickname());
  localStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
  localStorage.setItem(NICK_KEY, normalized.name);
  return normalized;
}

/** 이전 버전 닉네임을 새 프로필의 초기 이름으로 마이그레이션한다. */
export function nickname(): string {
  let nick = localStorage.getItem(NICK_KEY);
  if (!nick) {
    nick = generateNickname();
    localStorage.setItem(NICK_KEY, nick);
  }
  return nick;
}

/**
 * 공유용 uid 확보. **공유 트랜잭션 1단계에서만 호출한다.**
 * 실패하면 공유가 실패할 뿐, 로컬 작업은 아무 영향이 없다.
 */
export async function acquireUid(): Promise<string> {
  const { user, error } = await ensureSignedIn();
  if (user) return user.uid;
  // 실패 원인을 그대로 올려 보낸다 — 공유 게이트가 읽을 수 있는 말로 바꾼다.
  throw error ?? new Error(t('identity.needConnection'));
}
