import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { applyLangPreference, langPreference, t, type LangPreference } from '../../i18n';
import { isTossApp } from '../../platform/toss';
import { PROFILE_AVATAR_MAX_CHARS, PROFILE_NAME_MAX } from '../../storage/identity';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { RecoveryCard } from '../components/RecoveryCard';
import { useAppState } from '../state';

/**
 * 언어 이름은 **그 언어로** 적는다. 'Korean'이라고 쓰면 영어를 못 읽는 사람이
 * 자기 언어를 못 찾는다 — 언어 선택기가 유일하게 번역하면 안 되는 자리다.
 * 'system'만 지금 화면 언어로 말한다.
 */
const LANG_OPTIONS: { id: LangPreference; label: string }[] = [
  { id: 'system', label: t('profile.langSystem') },
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
];
export function ProfileScreen() {
  const nav = useNavigate();
  const { profile, updateCreatorProfile } = useAppState();
  const [name, setName] = useState(profile.name);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatarSource, setAvatarSource] = useState(profile.avatarSource);
  const [stageAvatarEnabled, setStageAvatarEnabled] = useState(profile.stageAvatarEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  /* 새로고침으로만 바뀌는 값이라 마운트 때 한 번만 읽는다 — 이름을 한 글자
   * 칠 때마다 localStorage를 두드릴 이유가 없다. */
  const [langPref] = useState(langPreference);
  /** 확인을 기다리는 언어. 저장 안 한 편집이 있을 때만 값이 찬다. */
  const [pendingLang, setPendingLang] = useState<LangPreference | null>(null);

  /* stageAvatarEnabled는 토글하는 즉시 저장되므로 여기 없다. */
  const unsaved = name.trim() !== profile.name || avatarUrl !== profile.avatarUrl;

  const changeLanguage = (next: LangPreference) => {
    if (next === langPref) return;
    if (unsaved) {
      setPendingLang(next);
      return;
    }
    applyLangPreference(next);
  };

  useEffect(() => {
    setName(profile.name);
    setAvatarUrl(profile.avatarUrl);
    setAvatarSource(profile.avatarSource);
    setStageAvatarEnabled(profile.stageAvatarEnabled);
  }, [profile]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('profile.nameRequired'));
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
        ? t('profile.savedWithAvatar')
        : t('profile.saved'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('profile.saveFailed'));
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
      setError(cause instanceof Error ? cause.message : t('profile.photoLoadFailed'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const changeStageAvatar = async (enabled: boolean) => {
    if (enabled && avatarSource !== 'custom') {
      setError(t('profile.needOwnPhoto'));
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
        ? t('profile.stageAvatarOn')
        : t('profile.stageAvatarOff'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('profile.visibilityFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen profile-screen">
      <header className="bar">
        {!isTossApp() && (
          <button type="button" className="bar-back" onClick={() => nav('/')}>
            ‹ {t('common.home')}
          </button>
        )}
        <h1>{t('profile.title')}</h1>
      </header>

      <section className="profile-card">
        <button
          type="button"
          className="profile-avatar-button"
          onClick={() => fileRef.current?.click()}
          aria-label={t('profile.changePhotoAria')}
        >
          <ProfileAvatar url={avatarUrl} name={name} />
          <span>{t('profile.changePhoto')}</span>
        </button>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void chooseAvatar(event.target.files?.[0])}
        />

        <label className="field">
          <span>{t('profile.nameField')}</span>
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
            <strong>{t('profile.stageAvatarTitle')}</strong>
            <p>
              {t('profile.stageAvatarBody1')}
              {' '}
              {t('profile.stageAvatarBody2')}
            </p>
          </div>
          <button
            type="button"
            className={`privacy-switch${stageAvatarEnabled ? ' active' : ''}`}
            role="switch"
            aria-checked={stageAvatarEnabled}
            aria-label={t('profile.stageAvatarToggleAria')}
            disabled={busy || (!stageAvatarEnabled && avatarSource !== 'custom')}
            onClick={() => void changeStageAvatar(!stageAvatarEnabled)}
          >
            <span aria-hidden="true" />
          </button>
          {avatarSource !== 'custom' ? (
            <p className="stage-avatar-help">{t('profile.stageAvatarNeedPhoto')}</p>
          ) : null}
        </div>

        <button type="button" className="big-cta profile-save" onClick={save} disabled={busy}>
          {t('profile.save')}
        </button>
      </section>

      {/* 기기를 잃어도 작품이 남는 길은 이제 복구 코드 하나다 — 토스 미니앱 웹뷰는
          OAuth 팝업을 띄울 수 없어 Google 계정 연결을 화면에서 걷어냈다. */}
      <RecoveryCard />

      <section className="account-card">
        <p className="feed-kicker">LANGUAGE</p>
        <h2>{t('profile.languageTitle')}</h2>
        <div className="seg lang-seg" role="group" aria-label={t('profile.languageAria')}>
          {LANG_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`seg-btn ${langPref === option.id ? 'on' : ''}`}
              aria-pressed={langPref === option.id}
              lang={option.id === 'system' ? undefined : option.id}
              onClick={() => changeLanguage(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="note">{t('profile.languageBody')}</p>
      </section>

      {message ? <p className="profile-message" role="status">{message}</p> : null}
      {error ? <p className="warn" role="alert">{error}</p> : null}

      {pendingLang && (
        <ConfirmDialog
          title={t('profile.langDirtyTitle')}
          detail={t('profile.langDirtyDetail')}
          confirmLabel={t('profile.langDirtyConfirm')}
          onConfirm={() => applyLangPreference(pendingLang)}
          onCancel={() => setPendingLang(null)}
        />
      )}

      <footer className="app-version" aria-label={t('profile.versionAria', { version: __APP_VERSION__ })}>
        {t('common.brand')} <span aria-hidden="true">·</span> v{__APP_VERSION__}
      </footer>
    </main>
  );
}

async function resizeAvatar(file: File): Promise<string> {
  if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type)) throw new Error(t('profile.avatar.badType'));
  if (file.size > 10 * 1024 * 1024) throw new Error(t('profile.avatar.tooBig'));

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('profile.avatar.cannotProcess'));
    ctx.fillStyle = '#FEF4F8';
    ctx.fillRect(0, 0, size, size);
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error(t('profile.avatar.resizeFailed'))),
        'image/jpeg',
        0.82,
      ),
    );
    const dataUrl = await blobToDataUrl(blob);
  if (dataUrl.length > PROFILE_AVATAR_MAX_CHARS) throw new Error(t('profile.avatar.stillTooBig'));
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t('profile.avatar.readFailed')));
    image.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t('profile.avatar.saveFailed')));
    reader.readAsDataURL(blob);
  });
}
