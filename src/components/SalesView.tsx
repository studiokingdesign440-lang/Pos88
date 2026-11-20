import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { BusinessDaySession, Sale, Settings } from '../types';
import { rp } from '../utils/format';
import { fmtDateTime, localDate, monthStart, shiftDays } from '../utils/time';
import { Modal } from './Modal';

interface SalesViewProps {
  sales: Sale[];
  settings: Settings;
  businessDay: BusinessDaySession | null;
  onReprint: (sale: Sale) => void;
}

export function SalesView({ sales, settings, businessDay, onReprint }: SalesViewProps) {
  const today = localDate(new Date(), settings.timezone);
  const activeDay = businessDay?.date || today;
  const [fromDate, setFromDate] = useState(activeDay);
  const [toDate, setToDate] = useState(activeDay);
  const prevActiveDayRef = useRef(activeDay);
  const [detailSale, setDetailSale] = useState<Sale | null>(null);

  useEffect(() => {
    if (prevActiveDayRef.current !== activeDay) {
      prevActiveDayRef.current = activeDay;
      setFromDate(activeDay);
      setToDate(activeDay);
    }
  }, [activeDay]);

  const filtered = useMemo(() => {
    return sales
      .filter(s => {
        if (fromDate && s.date < fromDate) return false;
        if (toDate && s.date > toDate) return false;
        return true;
      })
      .sort((a, b) => b.ts - a.ts);
  }, [sales, fromDate, toDate]);

  const totalRange = useMemo(() => filtered.reduce((sum, s) => sum + (Number(s.total) || 0), 0), [filtered]);

  const applyPreset = (preset: 'today' | 'yesterday' | '7' | 'month') => {
    const baseDate = businessDay?.date || localDate(new Date(), settings.timezone);
    if (preset === 'today') {
      setFromDate(baseDate);
      setToDate(baseDate);
    } else if (preset === 'yesterday') {
      const y = shiftDays(baseDate, -1);
      setFromDate(y);
      setToDate(y);
    } else if (preset === '7') {
      setFromDate(shiftDays(baseDate, -6));
      setToDate(baseDate);
    } else if (preset === 'month') {
      setFromDate(monthStart(baseDate));
      setToDate(baseDate);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink)]">Sales History</h1>
            <p className="text-xs text-[var(--muted)] mt-0.5 tabular-nums">
              {filtered.length} order{filtered.length === 1 ? '' : 's'} · Total:{' '}
              <b className="text-[var(--ink)]">{rp(totalRange)}</b>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)]"
            />
            <span className="text-xs font-bold text-[var(--muted)]">→</span>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => applyPreset('today')}
              className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {businessDay ? 'Active Day' : 'Today'}
            </button>
            <button
              type="button"
              onClick={() => applyPreset('yesterday')}
              className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={() => applyPreset('7')}
              className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] whitespace-nowrap shrink-0 cursor-pointer"
            >
              7 Days
            </button>
            <button
              type="button"
              onClick={() => applyPreset('month')}
              className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] whitespace-nowrap shrink-0 cursor-pointer"
            >
              This Month
            </button>
          </div>
        </div>

        <div className="theme-card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--bg)] border-b border-[var(--line)]">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Time
                </th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  No.
                </th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Payment
                </th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Total
                </th>
                <th className="w-24 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {!filtered.length ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-xs text-[var(--muted)]">
                    No transactions in this range.
                  </td>
                </tr>
              ) : (
                filtered.map(s => (
                  <tr
                    key={s.id}
                    className="border-b border-[var(--line-soft)] last:border-b-0 hover:bg-[var(--surface-hover)]"
                  >
                    <td className="px-4 py-3 text-xs text-[var(--ink-2)] tabular-nums">
                      {fmtDateTime(s.ts, settings.timezone)}
                    </td>
                    <td className="px-4 py-3 font-mono-num text-xs font-semibold text-[var(--ink-2)]">
                      #{s.orderNo}
                    </td>
                    <td className="px-4 py-3 font-bold text-[var(--ink)]">{s.orderName}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ink-2)]">
                      {(s.payments || []).map(p => p.method).join(' + ')}
                    </td>
                    <td className="px-4 py-3 text-right font-extrabold tabular-nums text-[var(--ink)]">
                      {rp(s.total)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDetailSale(s)}
                        className="px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] cursor-pointer"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transaction Details Modal */}
      <Modal
        open={detailSale !== null}
        title={detailSale ? `Transaction #${detailSale.orderNo}` : ''}
        onClose={() => setDetailSale(null)}
        footer={
          detailSale && (
            <>
              <button
                type="button"
                onClick={() => setDetailSale(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const s = detailSale;
                  setDetailSale(null);
                  onReprint(s);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Reprint
              </button>
            </>
          )
        }
      >
        {detailSale && (
          <div>
            <div className="text-xs text-[var(--muted)] mb-3 tabular-nums">
              {fmtDateTime(detailSale.ts, settings.timezone)} · {detailSale.orderName} · Cashier:{' '}
              {detailSale.cashier}
            </div>
            <div className="space-y-1.5 mb-4">
              {detailSale.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span>
                    {item.qty}× {item.name}
                    {item.note ? <em className="text-xs text-[var(--gold)] ml-1.5">({item.note})</em> : null}
                  </span>
                  <span className="font-semibold tabular-nums">{rp(item.price * item.qty)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-[var(--line)] pt-3 flex justify-between font-extrabold text-base">
              <span>Total</span>
              <span className="tabular-nums text-[var(--accent)]">{rp(detailSale.total)}</span>
            </div>
            <div className="mt-2.5 text-xs text-[var(--ink-2)] tabular-nums space-y-0.5">
              <div>
                Paid: {(detailSale.payments || []).map(p => `${p.method} ${rp(p.amount)}`).join(', ')}
              </div>
              {detailSale.change > 0 && (
                <div className="text-[var(--green)] font-semibold">Change: {rp(detailSale.change)}</div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
