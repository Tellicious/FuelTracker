interface Props {
  daysAgo: number | null;
  onBackup: () => void;
  onDismiss: () => void;
}

// Yellow banner that appears at the top of the dashboard when a backup is
// overdue. Shows how many days since the last backup, with a primary
// "Back up now" action and a secondary dismiss (snoozes for ~24h).
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
