import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { safeGet, safeSet } from '../lib/storage';

const KEY = 'ft.installPromptDismissed';

function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua);
}

function isStandalone(): boolean {
  try {

    if ((navigator as unknown as { standalone?: boolean }).standalone === true) {
      return true;
    }
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

// One-time iOS install hint shown to Safari users who haven't yet added
// the app to their home screen. On Chrome, listens for the beforeinstall-
// prompt event and surfaces a native install button instead. Dismissal is
// persisted to localStorage so the user only sees it once.
export function InstallPrompt() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isIOS() || isStandalone()) return;
    if (safeGet(KEY)) return;
    const t = setTimeout(() => setOpen(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    safeSet(KEY, '1');
    setOpen(false);
  };

  return (
    <Modal open={open} title="Install FuelTracker" onClose={dismiss}>
      <p className="muted" style={{ marginTop: 0 }}>
        For the best experience, install this app to your Home Screen:
      </p>
      <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
        <li>
          Tap the <strong>Share</strong> icon in Safari (square with ↑).
        </li>
        <li>
          Scroll and tap <strong>Add to Home Screen</strong>.
        </li>
        <li>
          Tap <strong>Add</strong>.
        </li>
      </ol>
      <button className="btn btn-primary btn-block" onClick={dismiss}>
        Got it
      </button>
    </Modal>
  );
}
