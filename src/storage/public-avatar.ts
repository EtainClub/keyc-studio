/**
 * 키크 스테이지 공개용 아바타.
 *
 * 비공개 프로필 사진을 그대로 공개하지 않는다. 사용자가 직접 올린 사진을 128px JPEG로
 * 다시 줄여 별도 경로에 저장하고, publicProfiles 문서가 있을 때만 Function이 서빙한다.
 */
import { deleteDoc, doc, setDoc } from 'firebase/firestore/lite';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { t } from '../i18n';
import { auth, ensureSignedIn, firestore, isFirebaseConfigured, storage } from './firebase';
import type { CreatorProfile } from './identity';
import { publicAvatarPath } from './paths';

const PUBLIC_AVATAR_SIZE = 128;
const PUBLIC_AVATAR_MAX_BYTES = 50 * 1024;

function publicProfileRef(uid: string) {
  return doc(firestore(), 'publicProfiles', uid);
}

export async function syncPublicAvatar(profile: CreatorProfile): Promise<void> {
  if (!isFirebaseConfigured) {
    if (profile.stageAvatarEnabled) throw new Error(t('avatar.needFirebase'));
    return;
  }

  if (!profile.stageAvatarEnabled) {
    await removePublicAvatar();
    return;
  }
  if (profile.avatarSource !== 'custom' || !profile.avatarUrl?.startsWith('data:image/')) {
    throw new Error(t('avatar.pickOwn'));
  }

  /*
   * 계정 **종류**는 묻지 않는다.
   *
   * 예전에는 비익명(Google) 계정만 공개 아바타를 올릴 수 있었다. 토스 미니앱에는
   * Google 연결이 아예 없으므로, 그 조건을 남겨두면 "아무도 사진을 공개할 수 없다"와
   * 같은 말이 된다. 규칙(storage.rules)이 보는 것은 언제나 경로의 uid == 인증 uid
   * 하나뿐이고 내리기(removePublicAvatar)도 같은 uid로 하므로, 익명 계정이어도
   * 올린 사람이 언제든 내릴 수 있다.
   *
   * 로그인은 여기서 **확보한다** — 공개 토글은 사용자가 직접 누르는 일이라
   * 이 자리에서 익명 계정이 만들어져도 앱의 약속(firebase.ts 주석)을 어기지 않는다.
   */
  const signed = await ensureSignedIn();
  if (!signed.user) throw signed.error ?? new Error(t('avatar.needSignIn'));
  const uid = signed.user.uid;
  const path = publicAvatarPath(uid);
  const blob = await renderPublicAvatar(profile.avatarUrl);

  await uploadBytes(ref(storage(), path), blob, {
    contentType: 'image/jpeg',
    cacheControl: 'no-store',
  });
  try {
    await setDoc(publicProfileRef(uid), { enabled: true, updatedAt: Date.now() });
  } catch (error) {
    await deleteObject(ref(storage(), path)).catch(() => {});
    throw error;
  }
}

/** 문서를 먼저 지워 Function 응답을 즉시 막고, 그 뒤 실제 이미지 파일을 지운다. */
export async function removePublicAvatar(): Promise<void> {
  if (!isFirebaseConfigured) return;
  const user = auth().currentUser;
  if (!user) return;
  await deleteDoc(publicProfileRef(user.uid));
  await deleteObject(ref(storage(), publicAvatarPath(user.uid))).catch(() => {});
}

async function renderPublicAvatar(source: string): Promise<Blob> {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = PUBLIC_AVATAR_SIZE;
  canvas.height = PUBLIC_AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('avatar.cannotProcess'));
  ctx.fillStyle = '#2a1e50';
  ctx.fillRect(0, 0, PUBLIC_AVATAR_SIZE, PUBLIC_AVATAR_SIZE);
  const scale = Math.max(PUBLIC_AVATAR_SIZE / image.naturalWidth, PUBLIC_AVATAR_SIZE / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.drawImage(
    image,
    (PUBLIC_AVATAR_SIZE - width) / 2,
    (PUBLIC_AVATAR_SIZE - height) / 2,
    width,
    height,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error(t('avatar.resizeFailed'))),
      'image/jpeg',
      0.78,
    ),
  );
  if (blob.size > PUBLIC_AVATAR_MAX_BYTES) throw new Error(t('avatar.stillTooBig'));
  return blob;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t('avatar.readFailed')));
    image.src = url;
  });
}
