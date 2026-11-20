import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { BusinessDaySession, Expense, Settings } from '../types';
import { QUICK_EXPENSES } from '../constants';
import { rp } from '../utils/format';
import { localDate } from '../utils/time';
import { ConfirmModal, Modal } from './Modal';

interface ExpensesViewProps {
  expenses: Expense[];
  settings: Settings;
  businessDay: BusinessDaySession | null;
  syncing: boolean;
  onAddExpense: (data: { date: string; name: string; amount: number; type: 'Cash' | 'Credit' }) => Promise<void>;
  onDeleteExpense: (id: string) => Promise<void>;
  onPushAll: () => Promise<void>;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}

export function ExpensesView({
  expenses,
  settings,
  businessDay,
  syncing,
  onAddExpense,
  onDeleteExpense,
  onPushAll,
  onToast,
}: ExpensesViewProps) {
  const today = localDate(new Date(), settings.timezone);
  const activeDay = businessDay?.date || today;
  const [selectedDate, setSelectedDate] = useState(activeDay);
  const prevActiveDayRef = useRef(activeDay);
  const [modalOpen, setModalOpen] = useState(false);
  const [expName, setExpName] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expType, setExpType] = useState<'Cash' | 'Credit'>('Cash');
  const [expDate, setExpDate] = useState(activeDay);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (prevActiveDayRef.current !== activeDay) {
      prevActiveDayRef.current = activeDay;
      setSelectedDate(activeDay);
      setExpDate(activeDay);
    }
  }, [activeDay]);

  const dayExpenses = useMemo(
    () =>
      expenses
        .filter(e => e.date === selectedDate)
        .sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    [expenses, selectedDate]
  );

  const totalDay = useMemo(
    () => dayExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [dayExpenses]
  );

  const openExpenseModal = (defaultName: string) => {
    setExpName(defaultName);
    setExpAmount('');
    setExpType('Cash');
    setExpDate(selectedDate || activeDay);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const name = expName.trim();
    const amt = Number(expAmount) || 0;
    if (!name || amt <= 0) {
      onToast('Enter a valid expense name and amount', 'err');
      return;
    }
    setModalOpen(false);
    await onAddExpense({
      date: expDate || activeDay,
      name,
      amount: amt,
      type: expType,
    });
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink)]">Expenses</h1>
            <p className="text-xs text-[var(--muted)] mt-0.5 tabular-nums">
              {selectedDate} · Total: <b className="text-[var(--danger)]">{rp(totalDay)}</b>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value || activeDay)}
              className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)]"
            />
            {selectedDate !== activeDay && (
              <button
                type="button"
                onClick={() => setSelectedDate(activeDay)}
                className="px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] whitespace-nowrap shrink-0 cursor-pointer"
              >
                {businessDay ? 'Active Day' : 'Today'}
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
              onClick={() => openExpenseModal('')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold shadow-sm hover:bg-[var(--accent-hover)] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Custom Expense
            </button>
          </div>
        </div>

        {/* Quick Add Grid */}
        <div className="theme-card p-5 mb-5">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--gold)] mb-3">
            Quick Add ({selectedDate === activeDay ? (businessDay ? `Business Day ${activeDay}` : 'Today') : selectedDate})
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2">
            {QUICK_EXPENSES.map(name => (
              <button
                key={name}
                type="button"
                onClick={() => openExpenseModal(name)}
                className="px-3 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] font-bold text-xs text-[var(--ink)] hover:bg-[var(--accent-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)] active:scale-[0.97] transition-all cursor-pointer"
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Expenses Table */}
        <div className="theme-card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--bg)] border-b border-[var(--line)]">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Item
                </th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Payment Type
                </th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Amount
                </th>
                <th className="w-16 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {!dayExpenses.length ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-xs text-[var(--muted)]">
                    No expenses recorded for {selectedDate}.
                  </td>
                </tr>
              ) : (
                dayExpenses.map(e => (
                  <tr
                    key={e.id}
                    className="border-b border-[var(--line-soft)] last:border-b-0 hover:bg-[var(--surface-hover)]"
                  >
                    <td className="px-4 py-3 font-bold text-[var(--ink)]">{e.name}</td>
                    <td className="px-4 py-3 text-xs font-semibold">
                      <span className={e.type === 'Cash' ? 'text-[var(--green)]' : 'text-[var(--blue)]'}>
                        {e.type === 'Cash' ? 'Paid Cash' : 'Credit / Pay Later'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-extrabold text-[var(--danger)] tabular-nums">
                      {rp(e.amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteId(e.id)}
                        aria-label={`Delete ${e.name}`}
                        className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--accent-soft)] cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Expense Modal */}
      <Modal
        open={modalOpen}
        title="Add Expense"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              Save Expense
            </button>
          </>
        }
      >
        <label className="block mb-3">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">Date</span>
          <input
            type="date"
            value={expDate}
            onChange={e => setExpDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        </label>
        <label className="block mb-3">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">Item Name</span>
          <input
            autoFocus={!expName}
            type="text"
            value={expName}
            onChange={e => setExpName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        </label>
        <label className="block mb-3">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
            Amount (Rp)
          </span>
          <input
            autoFocus={!!expName}
            type="number"
            value={expAmount}
            onChange={e => setExpAmount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="0"
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm font-bold text-[var(--ink)] tabular-nums outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
            Payment Type
          </span>
          <select
            value={expType}
            onChange={e => setExpType(e.target.value as 'Cash' | 'Credit')}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          >
            <option value="Cash">Paid Cash (Deducts from drawer)</option>
            <option value="Credit">Credit / Pay Later</option>
          </select>
        </label>
      </Modal>

      <ConfirmModal
        open={deleteId !== null}
        title="Delete Expense"
        message="Delete this expense record? If connected to Google Sheets, it will also be removed from the database."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteId) void onDeleteExpense(deleteId);
        }}
        onClose={() => setDeleteId(null)}
      />
    </div>
  );
}
