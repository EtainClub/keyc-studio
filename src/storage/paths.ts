/**
 * 원격 경로 규약.
 *
 * 경로에는 workId(12자)가 들어간다. 공개 완료 뒤에는 피드에도 노출되므로 비밀값이 아니다.
 * Storage 읽기는 열려 있고 쓰기만 잠근다 — 그 트레이드오프의 근거와 대가는
 * storage.rules 주석에 적어 뒀다.
 */

import type { AssetKind } from '../work-model/types';

export function assetPath(workId: string, kind: AssetKind, assetId: string): string {
  const ext = kind === 'art' ? 'png' : 'wav';
  return `works/${workId}/${kind}/${assetId}.${ext}`;
}

export function thumbPath(workId: string): string {
  return `works/${workId}/thumb.jpg`;
}

/** 그룹 전용 작품은 공개 `works/`와 경로부터 나눈다. 이 경로의 파일은 Storage에서
 * 직접 읽지 않고 callable이 그룹 멤버십을 확인한 뒤 바이트로 돌려준다. */
export function groupAssetPath(workId: string, kind: AssetKind, assetId: string): string {
  const ext = kind === 'art' ? 'png' : 'wav';
  return `groupWorks/${workId}/${kind}/${assetId}.${ext}`;
}

export function groupThumbPath(workId: string): string {
  return `groupWorks/${workId}/thumb.jpg`;
}

/** Google 계정 백업은 공개 works 경로와 분리하며 Storage Rules로 소유자만 읽는다. */
export function backupAssetPath(
  uid: string,
  workId: string,
  kind: AssetKind,
  assetId: string,
): string {
  const ext = kind === 'art' ? 'png' : 'wav';
  return `users/${uid}/works/${workId}/${kind}/${assetId}.${ext}`;
}

/** 공개용 아바타는 비공개 프로필 사진 및 작품 자산과 분리한다. */
export function publicAvatarPath(uid: string): string {
  return `publicProfiles/${uid}/avatar.jpg`;
}

export function workIdOfPath(path: string): string | null {
  const m = /^works\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}
