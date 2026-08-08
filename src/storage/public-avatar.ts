/**
 * 키크 스테이지 공개용 아바타.
 *
 * 비공개 프로필 사진을 그대로 공개하지 않는다. 사용자가 직접 올린 사진을 128px JPEG로
 * 다시 줄여 별도 경로에 저장하고, publicProfiles 문서가 있을 때만 Function이 서빙한다.
 */
import { deleteDoc, doc, setDoc } from 'firebase/firestore/lite';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { auth, firestore, isFirebaseConfigured, isPermanentUser, storage } from './firebase';
import type { CreatorProfile } from './identity';
import { publicAvatarPath } from './paths';

const PUBLIC_AVATAR_SIZE = 128;
const PUBLIC_AVATAR_MAX_BYTES = 50 * 1024;

function publicProfileRef(uid: string) {
  return doc(firestore(), 'publicProfiles', uid);
}

export async function syncPublicAvatar(profile: CreatorProfile): Promise<void> {
  if (!isFirebaseConfigured) {
    if (profile.stageAvatarEnabled) throw new Error('공개 프로필을 사용하려면 Firebase 설정이 필요해요.');
    return;
  }

  if (!profile.stageAvatarEnabled) {
    await removePublicAvatar();
    return;
  }
  if (profile.avatarSource !== 'custom' || !profile.avatarUrl?.startsWith('data:image/')) {
    throw new Error('스테이지에 공개할 사진을 직접 선택해 주세요. Google 사진은 자동 공개하지 않아요.');
  }

  const user = auth().currentUser;
  if (!isPermanentUser(user)) {
    throw new Error('공개 사진을 언제든 내릴 수 있도록 먼저 Google 계정을 연결해 주세요.');
  }
  const uid = user.uid;
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
  if (!ctx) throw new Error('공개용 사진을 처리할 수 없어요.');
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
      (value) => value ? resolve(value) : reject(new Error('공개용 사진을 줄이지 못했어요.')),
      'image/jpeg',
      0.78,
    ),
  );
  if (blob.size > PUBLIC_AVATAR_MAX_BYTES) throw new Error('공개용 사진의 용량을 줄이지 못했어요.');
  return blob;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('공개용 사진을 읽지 못했어요.'));
    image.src = url;
  });
}
