import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Modal } from './Modal';

export const PWAInstallButton: React.FC<{ variant?: 'header' | 'card' }> = ({
  variant = 'header',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    if (variant === 'card') {
      return (
        <span className="text-xs font-bold text-[var(--green)]">
          Installed as App
        </span>
      );
    }
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold shadow-sm hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)] text-xs font-bold hover:border-[var(--muted)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install on iOS</span>
        </button>

        <Modal
          open={showIOSGuide}
          title="Install Hokkien 88 POS on iPhone / iPad"
          onClose={() => setShowIOSGuide(false)}
          footer={
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              Close
            </button>
          }
        >
          <div className="space-y-2 text-sm text-[var(--ink-2)] leading-relaxed">
            <p>1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.</p>
            <p>2. Scroll down and tap <strong>Add to Home Screen</strong>.</p>
            <p>3. Tap <strong>Add</strong> in the top right to launch Hokkien 88 POS as a standalone app.</p>
          </div>
        </Modal>
      </>
    );
  }

  if (variant === 'card') {
    return (
      <span className="text-xs text-[var(--muted)]">
        Open in Chrome/Edge over HTTPS to install via the address bar icon or menu → Install Hokkien 88 POS.
      </span>
    );
  }

  return null;
};
