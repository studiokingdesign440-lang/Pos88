import React, { useEffect, useMemo, useState } from 'react';
import { Printer, RefreshCw, Save } from 'lucide-react';
import { DailyRecord, Expense, Sale, Settings } from '../types';
import { rp } from '../utils/format';
import { fmtLongDate, localDate } from '../utils/time';
import { computeDailyMetrics } from '../utils/sheets';

interface SummaryViewProps {
  sales: Sale[];
  expenses: Expense[];
  daily: Record<string, DailyRecord>;
  settings: Settings;
  syncing: boolean;
  onSaveDaily: (date: string, kas: number, actualCash: number) => Promise<void>;
  onPrintSummary: (date: string) => void;
  onPushAll: () => Promise<void>;
}

export function SummaryView({
  sales,
  expenses,
  daily,
  settings,
  syncing,
  onSaveDaily,
  onPrintSummary,
  onPushAll,
}: SummaryViewProps) {
  const today = localDate(new Date(), settings.timezone);
  const [selectedDate, setSelectedDate] = useState(today);
  const [kasInput, setKasInput] = useState<string>('');
  const [actualCashInput, setActualCashInput] = useState<string>('');

  const metrics = useMemo(
    () => computeDailyMetrics(selectedDate, sales, expenses, daily[selectedDate]),
    [selectedDate, sales, expenses, daily]
  );

  useEffect(() => {
    const rec = daily[selectedDate];
    setKasInput(rec?.kas ? String(rec.kas) : '');
    setActualCashInput(rec?.actualCash ? String(rec.actualCash) : '');
  }, [selectedDate, daily]);

  const parsedKas = Number(kasInput) || 0;
  const parsedActual = Number(actualCashInput) || 0;
  const liveExpectedCash = parsedKas + metrics.cashSales - metrics.cashExpenses;
  const variance = parsedActual > 0 ? parsedActual - liveExpectedCash : 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink)]">Daily Summary</h1>
            <p className="text-xs text-[var(--muted)] mt-0.5">{fmtLongDate(selectedDate)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value || today)}
              className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)]"
            />
            {selectedDate !== today && (
              <button
                type="button"
                onClick={() => setSelectedDate(today)}
                className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] whitespace-nowrap shrink-0 cursor-pointer"
              >
                Today
              </button>
            )}
            {settings.gasUrl && (
              <button
                type="button"
                disabled={syncing}
                onClick={onPushAll}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                Sync to Sheets
              </button>
            )}
            <button
              type="button"
              onClick={() => onPrintSummary(selectedDate)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold shadow-sm hover:bg-[var(--accent-hover)] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print End of Day
            </button>
          </div>
        </div>

        {/* Cash Drawer Setup Card */}
        <div className="theme-card p-5 mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--gold)]">Cash Drawer</div>
            <div className="text-sm text-[var(--ink-2)] mt-1">
              Enter Start of Day Cash Float (Kas) and optional Actual Drawer Count.
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-[10px] font-extrabold uppercase text-[var(--muted)] mb-1">
                Start Kas (Rp)
              </span>
              <input
                type="number"
                value={kasInput}
                onChange={e => setKasInput(e.target.value)}
                placeholder="0"
                className="w-40 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-lg font-extrabold text-right text-[var(--ink)] tabular-nums outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>

            <label className="block">
              <span className="block text-[10px] font-extrabold uppercase text-[var(--muted)] mb-1">
                Actual Cash (Optional)
              </span>
              <input
                type="number"
                value={actualCashInput}
                onChange={e => setActualCashInput(e.target.value)}
                placeholder="0"
                className="w-40 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-lg font-extrabold text-right text-[var(--ink)] tabular-nums outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>

            <button
              type="button"
              disabled={syncing}
              onClick={() => onSaveDaily(selectedDate, parsedKas, parsedActual)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-bold hover:bg-[var(--accent-hover)] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              Save &amp; Push
            </button>
          </div>
        </div>

        {/* Revenue & Expense Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          <div className="theme-card p-5">
            <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)] mb-3">
              Sales Revenue
            </h3>
            <div className="flex justify-between items-center py-2 border-b border-[var(--line-soft)] text-[15px] font-bold">
              <span>Total Sales</span>
              <span className="tabular-nums">{rp(metrics.totalSales)}</span>
            </div>
            <div className="flex justify-between items-center py-2 text-xs font-semibold text-[var(--green)]">
              <span>↳ Cash Sales</span>
              <span className="tabular-nums">{rp(metrics.cashSales)}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 text-xs font-semibold text-[var(--blue)]">
              <span>↳ QRIS / Transfer</span>
              <span className="tabular-nums">{rp(metrics.qrisSales)}</span>
            </div>
          </div>

          <div className="theme-card p-5">
            <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)] mb-3">
              Expenses
            </h3>
            <div className="flex justify-between items-center py-2 border-b border-[var(--line-soft)] text-[15px] font-bold">
              <span>Total Expenses</span>
              <span className="tabular-nums text-[var(--danger)]">{rp(metrics.totalExpenses)}</span>
            </div>
            <div className="flex justify-between items-center py-2 text-xs font-semibold text-[var(--ink-2)]">
              <span>↳ Paid Cash</span>
              <span className="tabular-nums">{rp(metrics.cashExpenses)}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 text-xs font-semibold text-[var(--ink-2)]">
              <span>↳ Credit (Unpaid)</span>
              <span className="tabular-nums">{rp(metrics.creditExpenses)}</span>
            </div>
          </div>
        </div>

        {/* End of Day Math */}
        <div className="bg-[var(--eod-bg)] text-[var(--eod-ink)] border border-[var(--line)] rounded-[var(--card-radius)] p-6">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)] mb-4">
            End of Day Reconciliation
          </h3>

          <div className="flex justify-between items-center pb-3 mb-3 border-b border-white/15 text-sm text-[var(--eod-muted)]">
            <span>Net Profit (Total Sales − All Expenses)</span>
            <span className="text-xl font-extrabold text-[var(--eod-ink)] tabular-nums">{rp(metrics.netProfit)}</span>
          </div>

          <div className="flex justify-between items-center text-sm text-[var(--eod-muted)]">
            <span>Expected Cash in Drawer (Start Kas + Cash Sales − Cash Expenses)</span>
            <span
              className={`text-2xl font-extrabold tabular-nums ${
                liveExpectedCash < 0 ? 'text-[var(--danger)]' : 'text-[var(--eod-accent)]'
              }`}
            >
              {rp(liveExpectedCash)}
            </span>
          </div>

          {parsedActual > 0 && (
            <div className="flex justify-between items-center pt-3 mt-3 border-t border-white/15 text-sm text-[var(--eod-muted)]">
              <span>Drawer Variance (Actual − Expected)</span>
              <span
                className={`text-lg font-extrabold tabular-nums ${
                  variance < 0
                    ? 'text-[var(--danger)]'
                    : variance > 0
                    ? 'text-[var(--gold)]'
                    : 'text-[var(--eod-accent)]'
                }`}
              >
                {variance > 0 ? '+' : ''}
                {rp(variance)}
              </span>
            </div>
          )}

          <p className="text-[11px] text-[var(--muted)] mt-3 leading-relaxed">
            Expected Cash is the physical money that should be in the drawer right now. Take back your Start Kas,
            settle cash obligations, and the remainder is your cash profit.
          </p>
        </div>
      </div>
    </div>
  );
}
