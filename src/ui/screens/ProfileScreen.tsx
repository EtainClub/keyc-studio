import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PROFILE_AVATAR_MAX_CHARS, PROFILE_NAME_MAX } from '../../storage/identity';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { useAppState } from '../state';

export function ProfileScreen() {
  const nav = useNavigate();
  const { profile, account, updateCreatorProfile, connectGoogle } = useAppState();
  const [name, setName] = useState(profile.name);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatarSource, setAvatarSource] = useState(profile.avatarSource);
  const [stageAvatarEnabled, setStageAvatarEnabled] = useState(profile.stageAvatarEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(profile.name);
    setAvatarUrl(profile.avatarUrl);
    setAvatarSource(profile.avatarSource);
    setStageAvatarEnabled(profile.stageAvatarEnabled);
  }, [profile]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('크리에이터 이름을 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await updateCreatorProfile({
        name: trimmed,
        avatarUrl,
        avatarSource,
        stageAvatarEnabled,
        customized: true,
      });
      setMessage(stageAvatarEnabled
        ? '프로필을 저장하고 스테이지 공개용 사진도 업데이트했어요.'
        : '프로필과 작품의 만든이 이름을 바꿨어요.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '프로필을 저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await updateCreatorProfile({
        name: name.trim() || profile.name,
        avatarUrl,
        avatarSource,
        stageAvatarEnabled,
        customized: true,
      });
      await connectGoogle();
      setMessage('Google 계정에 연결하고 작품을 안전하게 보관했어요.');
    } catch (cause) {
      console.warn('[account] Google 계정 연결 또는 작품 동기화에 실패했어요', cause);
      setError(accountError(cause));
    } finally {
      setBusy(false);
    }
  };

  const chooseAvatar = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      setAvatarUrl(await resizeAvatar(file));
      setAvatarSource('custom');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '사진을 불러오지 못했어요.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const changeStageAvatar = async (enabled: boolean) => {
    if (enabled && account.kind !== 'google') {
      setError('공개 사진을 언제든 내릴 수 있도록 먼저 Google 계정을 연결해 주세요.');
      return;
    }
    if (enabled && avatarSource !== 'custom') {
      setError('Google 계정 사진은 자동 공개하지 않아요. 먼저 공개할 사진을 직접 선택해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await updateCreatorProfile({
        name: name.trim() || profile.name,
        avatarUrl,
        avatarSource,
        stageAvatarEnabled: enabled,
        customized: true,
      });
      setStageAvatarEnabled(enabled);
      setMessage(enabled
        ? '공개용 사진을 따로 저장했어요. 앞으로 스테이지 작품에만 표시돼요.'
        : '스테이지에서 프로필 사진을 내리고 공개용 파일도 삭제했어요.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '공개 설정을 바꾸지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen profile-screen">
      <header className="bar">
        <button type="button" className="bar-back" onClick={() => nav('/')}>
          ‹ 홈
        </button>
        <h1>내 프로필</h1>
      </header>

      <section className="profile-card">
        <button
          type="button"
          className="profile-avatar-button"
          onClick={() => fileRef.current?.click()}
          aria-label="프로필 사진 바꾸기"
        >
          <ProfileAvatar url={avatarUrl} name={name} />
          <span>사진 바꾸기</span>
        </button>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void chooseAvatar(event.target.files?.[0])}
        />

        <label className="field">
          <span>크리에이터 이름</span>
          <input
            value={name}
            maxLength={PROFILE_NAME_MAX}
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
          />
          <em>{Array.from(name).length}/{PROFILE_NAME_MAX}</em>
        </label>

        <div className="stage-avatar-setting">
          <div className="stage-avatar-copy">
            <strong>스테이지에 프로필 사진 공개</strong>
            <p>
              직접 선택한 사진을 작은 공개용 이미지로 따로 저장해요.
              Google 계정 사진은 자동으로 공개하지 않아요.
            </p>
          </div>
          <button
            type="button"
            className={`privacy-switch${stageAvatarEnabled ? ' active' : ''}`}
            role="switch"
            aria-checked={stageAvatarEnabled}
            aria-label="스테이지 프로필 사진 공개"
            disabled={busy || (!stageAvatarEnabled && (account.kind !== 'google' || avatarSource !== 'custom'))}
            onClick={() => void changeStageAvatar(!stageAvatarEnabled)}
          >
            <span aria-hidden="true" />
          </button>
          {account.kind !== 'google' || avatarSource !== 'custom' ? (
            <p className="stage-avatar-help">
              {account.kind !== 'google'
                ? '언제든 공개 해제할 수 있도록 Google 계정을 먼저 연결해 주세요.'
                : '사진 바꾸기에서 공개할 사진을 직접 골라야 켤 수 있어요.'}
            </p>
          ) : null}
        </div>

        <button type="button" className="big-cta profile-save" onClick={save} disabled={busy}>
          프로필 저장
        </button>
      </section>

      <section className="account-card">
        <p className="feed-kicker">CLOUD SAVE</p>
        <h2>작품을 오래 보관하기</h2>
        {account.kind === 'google' ? (
          <>
            <p className="account-connected">✓ Google 계정에 보관 중</p>
            {account.email ? <p className="note">{account.email}</p> : null}
            <p className="note">이 기기에서 만든 작품은 자동으로 비공개 백업돼요.</p>
            <button type="button" className="chip wide" onClick={connect} disabled={busy}>
              {busy ? '동기화하고 있어요…' : '지금 다시 동기화'}
            </button>
          </>
        ) : (
          <>
            <p className="note">
              Google 계정을 연결하면 기기를 바꿔도 내 작품을 다시 불러올 수 있어요.
              연결만으로 작품이 키크 스테이지에 공개되지는 않아요.
            </p>
            <button type="button" className="google-connect" onClick={connect} disabled={busy}>
              <span aria-hidden="true">G</span>
              {account.kind === 'syncing' ? '연결하고 있어요…' : 'Google 계정 연결'}
            </button>
          </>
        )}
      </section>

      {message ? <p className="profile-message" role="status">{message}</p> : null}
      {error ? <p className="warn" role="alert">{error}</p> : null}

      <footer className="app-version" aria-label={`키크 앱 버전 ${__APP_VERSION__}`}>
        키크 <span aria-hidden="true">·</span> v{__APP_VERSION__}
      </footer>
    </main>
  );
}

function accountError(cause: unknown): string {
  const code = (cause as { code?: string })?.code ?? '';
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) {
    return 'Google 계정 연결을 취소했어요.';
  }
  if (code.includes('operation-not-allowed')) {
    return 'Google 로그인이 아직 준비되지 않았어요 (Firebase 제공업체 설정 필요).';
  }
  if (code.includes('unauthorized-domain')) {
    return '현재 주소에서는 Google 로그인을 사용할 수 없어요 (승인된 도메인 설정 필요).';
  }
  if (code.includes('invalid-argument')
    || (cause instanceof Error && cause.message.includes('Unsupported field value'))) {
    return '작품 백업 데이터를 정리하지 못했어요. 앱을 새로고침한 뒤 다시 동기화해 주세요.';
  }
  return 'Google 계정 연결 또는 작품 보관을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

async function resizeAvatar(file: File): Promise<string> {
  if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type)) throw new Error('PNG, JPG, WebP 사진을 골라 주세요.');
  if (file.size > 10 * 1024 * 1024) throw new Error('10MB보다 작은 사진을 골라 주세요.');

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('사진을 처리할 수 없어요.');
    ctx.fillStyle = '#2a1e50';
    ctx.fillRect(0, 0, size, size);
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('사진을 줄이지 못했어요.')),
        'image/jpeg',
        0.82,
      ),
    );
    const dataUrl = await blobToDataUrl(blob);
    if (dataUrl.length > PROFILE_AVATAR_MAX_CHARS) throw new Error('사진 용량을 더 줄여 주세요.');
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
    image.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('사진을 저장하지 못했어요.'));
    reader.readAsDataURL(blob);
  });
}
