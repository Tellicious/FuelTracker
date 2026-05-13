interface Props {
  daysAgo: number | null;
  onBackup: () => void;
  onDismiss: () => void;
}

export function BackupBanner({ daysAgo, onBackup, onDismiss }: Props) {
  const text =
    daysAgo == null
      ? 'No backup yet — back up to iCloud Drive?'
      : `Last backup ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago — back up?`;
  return (
    <div className="banner" role="status">
      <div className="banner-text">{text}</div>
      <button onClick={onDismiss} aria-label="Dismiss" className="muted">
        Later
      </button>
      <button onClick={onBackup} aria-label="Back up now">
        Back up
      </button>
    </div>
  );
}
