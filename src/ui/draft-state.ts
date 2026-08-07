import type { Work } from '../work-model/types';

/**
 * 공개 뒤 내용을 바꾸면 서버의 공개본과 로컬 초안이 달라진다.
 * 새 목소리 같은 변경을 동의 없이 자동 업로드하지 않고, 다시 공유 게이트를 거치게 한다.
 */
export function applyDraftChange(work: Work, patch: Partial<Work>): Work {
  return {
    ...work,
    ...patch,
    visibility: patch.visibility === 'link' ? 'link' : 'local',
  };
}

/** 서버에 공개본이 있고 현재 로컬 내용도 그 공개본과 같은 상태인지 판별한다. */
export function isShareCurrent(work: Work, published: boolean): boolean {
  return published && work.visibility === 'link';
}
