import React, { useEffect, useRef, useState } from 'react';
import { Code2, Copy, Download, RefreshCw, Upload } from 'lucide-react';
import { Settings, SyncMeta, ThemeId } from '../types';
import { THEME_OPTIONS } from '../constants';
import { fmtClockWithSeconds, getEffectiveTimezone, TIMEZONE_OPTIONS } from '../utils/time';
import { ConfirmModal, Modal } from './Modal';

interface SettingsViewProps {
  settings: Settings;
  syncing: boolean;
  syncMeta: SyncMeta;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onConnectPrinter: () => void;
  onTestPrint: () => void;
  onPullSheets: () => Promise<void>;
  onPushAll: () => Promise<void>;
  onPushProducts: () => Promise<void>;
  onPushSettings: () => Promise<void>;
  onTestConnection: () => Promise<void>;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onResetData: () => void;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}

export function SettingsView({
  settings,
  syncing,
  syncMeta,
  onUpdateSettings,
  onConnectPrinter,
  onTestPrint,
  onPullSheets,
  onPushAll,
  onPushProducts,
  onPushSettings,
  onTestConnection,
  onExportJson,
  onImportJson,
  onResetData,
  onToast,
}: SettingsViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [scriptModal, setScriptModal] = useState(false);
  const [scriptCode, setScriptCode] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const openAppsScriptModal = async () => {
    setScriptModal(true);
    if (!scriptCode) {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}database_appscript.js`);
        if (res.ok) {
          setScriptCode(await res.text());
        } else {
          setScriptCode('// Unable to load database_appscript.js');
        }
      } catch {
        setScriptCode('// Unable to load database_appscript.js');
      }
    }
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(scriptCode);
      onToast('Apps Script copied to clipboard');
    } catch {
      onToast('Copy failed — select and copy manually', 'err');
    }
  };

  const effectiveTz = getEffectiveTimezone(settings.timezone);
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
  const activeTheme: ThemeId = settings.theme || 'original';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink)] mb-5">Settings</h1>

        {/* Theme Selector */}
        <div className="theme-card p-5 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
            <div>
              <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)]">
                Appearance Theme
              </h3>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Switch visual style anytime. Synced with your Store Settings in Google Sheets.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {THEME_OPTIONS.map(t => {
              const selected = activeTheme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onUpdateSettings({ theme: t.id })}
                  className={`text-left p-3.5 rounded-[var(--card-radius)] border transition-all cursor-pointer ${
                    selected
                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent-soft)] bg-[var(--bg)]'
                      : 'border-[var(--line)] bg-[var(--surface)] hover:border-[var(--muted)]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-2.5">
                    {t.swatches.map((hex, i) => (
                      <span
                        key={i}
                        className="h-3.5 flex-1 rounded-sm border border-black/15"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                  <div className="text-xs font-extrabold text-[var(--ink)]">{t.name}</div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5 leading-snug">{t.subtitle}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* Google Sheets Sync */}
          <div className="theme-card p-5">
            <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)] mb-3.5">
              Google Sheets Sync
            </h3>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
                Apps Script Web App URL
              </span>
              <input
                type="url"
                value={settings.gasUrl}
                onChange={e => onUpdateSettings({ gasUrl: e.target.value })}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs text-[var(--ink)] font-mono-num outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>

            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                disabled={syncing}
                onClick={onPullSheets}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-50 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Pull All Data
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={onPushAll}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Push All Data
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={onPushSettings}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 cursor-pointer"
              >
                Push Store Settings
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={onPushProducts}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 cursor-pointer"
              >
                Push Products Only
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                disabled={syncing}
                onClick={onTestConnection}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--bg)] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                Check Sync &amp; Timezone
              </button>
              <button
                type="button"
                onClick={openAppsScriptModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--bg)] cursor-pointer"
              >
                <Code2 className="w-3.5 h-3.5" />
                View Fixed Apps Script
              </button>
            </div>

            <div className="text-xs text-[var(--ink-2)] bg-[var(--bg)] border border-[var(--line)] rounded-xl p-3 space-y-1">
              <div>
                Last sync:{' '}
                <b className="text-[var(--ink)]">
                  {syncMeta.lastSyncedAt
                    ? `${syncMeta.lastAction || 'Synced'} at ${syncMeta.lastSyncedAt}`
                    : 'Not synced yet'}
                </b>
              </div>
              {syncMeta.pendingCount > 0 && (
                <div className="text-[var(--gold)] font-semibold">
                  {syncMeta.pendingCount} pending change{syncMeta.pendingCount === 1 ? '' : 's'} queued — click Push
                  All Data.
                </div>
              )}
              {syncMeta.lastError && (
                <div className="text-[var(--danger)] font-semibold">Last error: {syncMeta.lastError}</div>
              )}
            </div>
          </div>

          {/* Timezone & Clock */}
          <div className="theme-card p-5">
            <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)] mb-3.5">
              Time &amp; Timezone
            </h3>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
                Store Timezone (Synced with Database)
              </span>
              <select
                value={settings.timezone || 'Asia/Jakarta'}
                onChange={e => onUpdateSettings({ timezone: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              >
                {TIMEZONE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="bg-[var(--bg)] border border-[var(--line)] rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-[var(--ink-2)]">Store Time ({effectiveTz})</span>
                <span className="font-mono-num font-bold text-[var(--ink)]">
                  {fmtClockWithSeconds(now, settings.timezone)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--ink-2)]">Device Time ({deviceTz})</span>
                <span className="font-mono-num text-[var(--ink-2)]">{fmtClockWithSeconds(now, 'local')}</span>
              </div>
              <p className="text-[11px] text-[var(--muted)] pt-1 leading-relaxed">
                All sales dates, expenses, and daily reports are stored as plain text YYYY-MM-DD in{' '}
                <b>{effectiveTz}</b> so Google Sheets never shifts dates across timezones.
              </p>
            </div>
          </div>

          {/* Store Identity */}
          <div className="theme-card p-5">
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)]">
                Store Identity
              </h3>
              {settings.gasUrl && (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={onPushSettings}
                  className="px-2.5 py-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[11px] font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 cursor-pointer"
                >
                  Push to Sheets
                </button>
              )}
            </div>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">
                Store Name
              </span>
              <input
                type="text"
                value={settings.storeName}
                onChange={e => onUpdateSettings({ storeName: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">Tagline</span>
              <input
                type="text"
                value={settings.tagline}
                onChange={e => onUpdateSettings({ tagline: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">Address</span>
              <input
                type="text"
                value={settings.address}
                onChange={e => onUpdateSettings({ address: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">Phone</span>
              <input
                type="text"
                value={settings.phone}
                onChange={e => onUpdateSettings({ phone: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">
                Receipt Footer
              </span>
              <input
                type="text"
                value={settings.footerText}
                onChange={e => onUpdateSettings({ footerText: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
          </div>

          {/* Printer & Tax */}
          <div className="theme-card p-5">
            <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)] mb-3.5">
              Printer &amp; Charges
            </h3>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">
                Print Method
              </span>
              <select
                value={settings.printMethod}
                onChange={e => onUpdateSettings({ printMethod: e.target.value as 'bluetooth' | 'browser' })}
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              >
                <option value="bluetooth">Bluetooth Thermal (ESC/POS)</option>
                <option value="browser">Browser Print (fallback)</option>
              </select>
            </label>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">
                Paper Width
              </span>
              <select
                value={settings.paperWidth}
                onChange={e => onUpdateSettings({ paperWidth: Number(e.target.value) === 80 ? 80 : 58 })}
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              >
                <option value={58}>58 mm (32 chars)</option>
                <option value={80}>80 mm (48 chars)</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="block">
                <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">Tax (%)</span>
                <input
                  type="number"
                  min={0}
                  value={settings.taxPercent}
                  onChange={e => onUpdateSettings({ taxPercent: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] tabular-nums outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">
                  Service (%)
                </span>
                <input
                  type="number"
                  min={0}
                  value={settings.servicePercent}
                  onChange={e => onUpdateSettings({ servicePercent: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] tabular-nums outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onConnectPrinter}
                className="px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] cursor-pointer"
              >
                Connect Printer
              </button>
              <button
                type="button"
                onClick={onTestPrint}
                className="px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] cursor-pointer"
              >
                Test Print
              </button>
            </div>
          </div>

          {/* Cashier & Messages */}
          <div className="theme-card p-5">
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)]">
                Cashier &amp; Messages
              </h3>
              {settings.gasUrl && (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={onPushSettings}
                  className="px-2.5 py-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[11px] font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 cursor-pointer"
                >
                  Push to Sheets
                </button>
              )}
            </div>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">
                Cashier Names (one per line)
              </span>
              <textarea
                rows={4}
                value={settings.cashierNames.join('\n')}
                onChange={e =>
                  onUpdateSettings({ cashierNames: e.target.value.split('\n').filter(Boolean) })
                }
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">
                Thank You (one per line)
              </span>
              <textarea
                rows={3}
                value={settings.thanks.join('\n')}
                onChange={e => onUpdateSettings({ thanks: e.target.value.split('\n').filter(Boolean) })}
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1">
                Quotes (one per line)
              </span>
              <textarea
                rows={3}
                value={settings.quotes.join('\n')}
                onChange={e => onUpdateSettings({ quotes: e.target.value.split('\n').filter(Boolean) })}
                className="w-full px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
          </div>

          {/* Local Backup */}
          <div className="theme-card p-5">
            <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)] mb-3.5">
              Local Data Backup
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onExportJson}
                className="px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] cursor-pointer"
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] cursor-pointer"
              >
                Import JSON
              </button>
              <button
                type="button"
                onClick={() => setResetConfirm(true)}
                className="px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--danger)] hover:bg-[var(--accent-soft)] cursor-pointer"
              >
                Reset Local Data
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) onImportJson(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </div>

      {/* Fixed Apps Script Viewer Modal */}
      <Modal
        open={scriptModal}
        title="Fixed Google Apps Script (database_appscript.js)"
        wide
        onClose={() => setScriptModal(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setScriptModal(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={copyScript}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              <Copy className="w-4 h-4" />
              Copy Code
            </button>
          </>
        }
      >
        <div className="text-xs text-[var(--ink-2)] mb-3 space-y-1 leading-relaxed">
          <p>
            1. Open your Google Sheet → <b>Extensions → Apps Script</b> and replace the old code with the script below.
          </p>
          <p>
            2. Click <b>Deploy → Manage deployments → Edit (pencil) → New version → Deploy</b> (set{' '}
            <b>Execute as: Me</b> and <b>Who has access: Anyone</b>).
          </p>
          <p>
            3. Also verify <b>File → Settings → Time zone</b> in your Google Sheet matches <b>{effectiveTz}</b>.
          </p>
        </div>
        <pre className="font-mono-num text-[11px] leading-relaxed bg-[var(--receipt-bg)] border border-[var(--line)] rounded-xl p-3.5 max-h-[50vh] overflow-auto whitespace-pre text-[var(--receipt-ink)]">
          {scriptCode || 'Loading…'}
        </pre>
      </Modal>

      <ConfirmModal
        open={resetConfirm}
        title="Reset Local Data"
        message="This will wipe all locally stored products, orders, sales, expenses, and settings in this browser. Export a JSON backup first if needed."
        confirmLabel="Wipe All Data"
        onConfirm={onResetData}
        onClose={() => setResetConfirm(false)}
      />
    </div>
  );
}
