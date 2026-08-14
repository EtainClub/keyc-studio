import { t } from '../../i18n';

export function ProfileAvatar({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img
      className="profile-avatar"
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
    />
  ) : (
    <span className="profile-avatar profile-avatar-fallback" aria-hidden="true">
      {Array.from(name.trim())[0] || t('common.avatarFallback')}
    </span>
  );
}
