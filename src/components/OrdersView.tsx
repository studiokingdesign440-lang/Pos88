import React, { useMemo, useState } from 'react';
import { Plus, X, Pencil, Trash2 } from 'lucide-react';
import { BusinessDaySession, Order, OrderItem, OrderTotals, PaymentSplit, Product, Settings } from '../types';
import { ORDER_SHORTCUTS } from '../constants';
import { rp, uid } from '../utils/format';
import { fmtTime } from '../utils/time';
import { ConfirmModal, Modal } from './Modal';

interface OrdersViewProps {
  orders: Order[];
  currentOrderId: string | null;
  products: Product[];
  settings: Settings;
  businessDay: BusinessDaySession | null;
  onOpenBusinessDayModal: () => void;
  onSelectOrder: (id: string) => void;
  onCreateOrder: (name: string) => void;
  onDeleteOrder: (id: string) => void;
  onUpdateOrderName: (id: string, name: string) => void;
  onAddItem: (item: OrderItem) => void;
  onUpdateItemQty: (idx: number, delta: number) => void;
  onUpdateItemNote: (idx: number, note: string) => void;
  onRemoveItem: (idx: number) => void;
  onClearItems: () => void;
  onCompleteSale: (payments: PaymentSplit[]) => void;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}

export function computeOrderTotals(items: OrderItem[], settings: Settings): OrderTotals {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = Math.round((subtotal * (Number(settings.taxPercent) || 0)) / 100);
  const svc = Math.round((subtotal * (Number(settings.servicePercent) || 0)) / 100);
  return { subtotal, tax, svc, total: subtotal + tax + svc };
}

/**
 * Generates 3 likely Indonesian Rupiah cash tender amounts above `due`
 * based on 5.000, 10.000, 20.000, 50.000, and 100.000 denominations and combinations.
 */
export function getIndonesianCashSuggestions(due: number): number[] {
  if (due <= 0) return [5000, 10000, 20000];

  const pool = new Set<number>();
  const add = (val: number) => {
    if (val > due) pool.add(val);
  };

  const ceil5k = Math.ceil((due + 1) / 5000) * 5000;
  const ceil10k = Math.ceil((due + 1) / 10000) * 10000;
  const ceil20k = Math.ceil((due + 1) / 20000) * 20000;
  const ceil50k = Math.ceil((due + 1) / 50000) * 50000;
  const ceil100k = Math.ceil((due + 1) / 100000) * 100000;

  if (due % 5000 !== 0) add(ceil5k);
  add(ceil10k);

  if (due < 20000) add(20000);
  if (due < 50000) add(50000);
  if (due < 100000) add(100000);
  add(ceil50k);
  add(ceil100k);

  if (pool.size < 3) add(ceil5k);
  if (pool.size < 3) add(ceil20k);
  if (pool.size < 3 && ceil10k + 5000 <= ceil50k) add(ceil10k + 5000);
  if (pool.size < 3) add(ceil10k + 10000);
  if (pool.size < 3) add(ceil50k + 50000);
  if (pool.size < 3) add(ceil100k + 50000);
  if (pool.size < 3) add(ceil100k + 100000);

  return [...pool].sort((a, b) => a - b).slice(0, 3);
}

export function OrdersView({
  orders,
  currentOrderId,
  products,
  settings,
  businessDay,
  onOpenBusinessDayModal,
  onSelectOrder,
  onCreateOrder,
  onDeleteOrder,
  onUpdateOrderName,
  onAddItem,
  onUpdateItemQty,
  onUpdateItemNote,
  onRemoveItem,
  onClearItems,
  onCompleteSale,
  onToast,
}: OrdersViewProps) {
  const [activeCat, setActiveCat] = useState<string>('ALL');
  const [newOrderModal, setNewOrderModal] = useState(false);
  const [newOrderName, setNewOrderName] = useState('');

  const [customModal, setCustomModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customNote, setCustomNote] = useState('');

  const [noteModalIdx, setNoteModalIdx] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');

  const [payModal, setPayModal] = useState(false);
  const [payments, setPayments] = useState<PaymentSplit[]>([{ method: 'Cash', amount: 0 }]);
  const [customCashInputs, setCustomCashInputs] = useState<Record<number, string>>({});

  const [confirmDeleteOrderId, setConfirmDeleteOrderId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const currentOrder = useMemo(
    () => orders.find(o => o.id === currentOrderId) || null,
    [orders, currentOrderId]
  );

  const activeProducts = useMemo(() => products.filter(p => p.active !== false), [products]);

  const categories = useMemo(
    () => [...new Set(activeProducts.map(p => p.main))],
    [activeProducts]
  );

  const visibleProducts = useMemo(
    () => (activeCat === 'ALL' ? activeProducts : activeProducts.filter(p => p.main === activeCat)),
    [activeProducts, activeCat]
  );

  const currentTotals = useMemo(
    () => computeOrderTotals(currentOrder?.items || [], settings),
    [currentOrder, settings]
  );

  const openNewOrder = () => {
    setNewOrderName('');
    setNewOrderModal(true);
  };

  const submitNewOrder = () => {
    onCreateOrder(newOrderName.trim());
    setNewOrderModal(false);
  };

  const openPayModal = () => {
    if (!currentOrder || !currentOrder.items.length) return;
    setPayments([{ method: 'Cash', amount: currentTotals.total }]);
    setCustomCashInputs({});
    setPayModal(true);
  };

  const paidTotal = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const payDiff = currentTotals.total - paidTotal;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Orders Strip */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--line)] bg-[var(--surface)] shrink-0 min-h-[88px]">
        <button
          type="button"
          onClick={openNewOrder}
          className="shrink-0 flex items-center gap-2 px-4 py-3 rounded-[var(--card-radius)] border-[1.5px] border-dashed border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] font-bold text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] active:scale-[0.98] transition-all whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Order
        </button>

        <div className="flex items-center gap-2.5 overflow-x-auto flex-1 pb-0.5">
          {!orders.length ? (
            <div className="text-xs font-semibold text-[var(--muted)] pl-1">No active orders.</div>
          ) : (
            orders.map(o => {
              const count = o.items.reduce((a, b) => a + b.qty, 0);
              const total = computeOrderTotals(o.items, settings).total;
              const isActive = o.id === currentOrderId;
              return (
                <div
                  key={o.id}
                  onClick={() => onSelectOrder(o.id)}
                  className={`relative min-w-[180px] max-w-[220px] px-3.5 py-2.5 rounded-[var(--card-radius)] bg-[var(--surface)] border transition-all cursor-pointer shrink-0 ${
                    isActive
                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent-soft)]'
                      : 'border-[var(--line)] hover:border-[var(--muted)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      setConfirmDeleteOrderId(o.id);
                    }}
                    aria-label={`Delete ${o.name}`}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--danger)] transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="font-bold text-sm text-[var(--ink)] pr-5 truncate">{o.name}</div>
                  <div className="text-[11px] text-[var(--muted)] font-medium tabular-nums">
                    {count} item{count === 1 ? '' : 's'} · {fmtTime(o.createdAt, settings.timezone)}
                  </div>
                  <div className="font-extrabold text-[var(--accent)] text-xs mt-1 tabular-nums">{rp(total)}</div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {!businessDay && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 border-b border-[var(--line)] bg-[var(--accent-soft)] text-xs shrink-0">
          <span className="font-semibold text-[var(--ink)]">
            Business Day is currently closed. Open a Business Day to group all sales (including after midnight) into one shift.
          </span>
          <button
            type="button"
            onClick={onOpenBusinessDayModal}
            className="px-3 py-1 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer hover:bg-[var(--accent-hover)]"
          >
            Open Business Day
          </button>
        </div>
      )}

      {/* Main POS Split */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] flex-1 min-h-0 overflow-hidden">
        {/* Left: Categories + Product Grid */}
        <div className="flex flex-col min-h-0 min-w-0 overflow-hidden">
          {!currentOrder ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <h3 className="text-xl font-extrabold text-[var(--ink)] mb-1.5">No active order</h3>
              <p className="text-sm text-[var(--muted)] mb-5">Create a new order to start adding items.</p>
              <button
                type="button"
                onClick={openNewOrder}
                className="px-5 py-2.5 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-bold shadow-sm hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                + New Order
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-5 pt-3.5 pb-2 overflow-x-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveCat('ALL')}
                  className={`px-4 py-2 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeCat === 'ALL'
                      ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)] shadow-sm'
                      : 'bg-[var(--surface)] border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--muted)]'
                  }`}
                >
                  All
                </button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCat(cat)}
                    className={`px-4 py-2 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      activeCat === cat
                        ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)] shadow-sm'
                        : 'bg-[var(--surface)] border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--muted)]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto px-5 pt-2 pb-6 grid grid-cols-[repeat(auto-fill,minmax(145px,1fr))] gap-2.5 content-start">
                {visibleProducts.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      onAddItem({ productId: p.id, name: p.name, price: p.price, qty: 1, note: '' })
                    }
                    className="theme-card flex flex-col text-left p-3 min-h-[112px] justify-between hover:border-[var(--accent)] active:scale-[0.97] transition-all cursor-pointer"
                  >
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold)] truncate">
                        {p.main}
                      </div>
                      <div className="font-semibold text-[13.5px] leading-snug text-[var(--ink)] mt-1 line-clamp-2">
                        {p.name}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-1">
                      <span className="font-extrabold text-[var(--accent)] text-[13px] tabular-nums">
                        {rp(p.price)}
                      </span>
                      <span className="w-6 h-6 rounded-md bg-[var(--surface-2)] text-[var(--ink-2)] flex items-center justify-center text-sm font-bold">
                        +
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right: Cart */}
        <aside className="flex flex-col bg-[var(--surface)] border-t lg:border-t-0 lg:border-l border-[var(--line)] min-h-0 max-h-[52dvh] lg:max-h-none">
          <div className="px-4 py-3 border-b border-[var(--line)] shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                Table / Customer
              </span>
              <button
                type="button"
                disabled={!currentOrder}
                onClick={() => {
                  setCustomName('');
                  setCustomPrice('');
                  setCustomNote('');
                  setCustomModal(true);
                }}
                className="px-2.5 py-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[11px] font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
              >
                + Custom
              </button>
            </div>
            <input
              type="text"
              value={currentOrder ? currentOrder.name : ''}
              disabled={!currentOrder}
              onChange={e => currentOrder && onUpdateOrderName(currentOrder.id, e.target.value)}
              placeholder="Select or create an order…"
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] font-bold text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)] transition-colors disabled:opacity-55"
            />
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
            {!currentOrder ? (
              <div className="text-center py-10 text-xs text-[var(--muted)]">No order selected.</div>
            ) : !currentOrder.items.length ? (
              <div className="text-center py-10 text-xs text-[var(--muted)]">Order is empty. Tap items to add.</div>
            ) : (
              <div className="divide-y divide-[var(--line-soft)]">
                {currentOrder.items.map((item, idx) => (
                  <div key={`${item.productId}-${idx}`} className="flex items-center gap-2 py-2.5 px-1">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13px] text-[var(--ink)] truncate">{item.name}</div>
                      {item.note && (
                        <div className="text-[11px] text-[var(--gold)] italic truncate">* {item.note}</div>
                      )}
                      <div className="text-[11.5px] text-[var(--muted)] mt-0.5 tabular-nums">
                        {rp(item.price)} × {item.qty} ={' '}
                        <b className="text-[var(--ink-2)]">{rp(item.price * item.qty)}</b>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 bg-[var(--bg)] border border-[var(--line)] rounded-lg p-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onUpdateItemQty(idx, -1)}
                        className="w-7 h-7 rounded-md font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] flex items-center justify-center cursor-pointer"
                      >
                        −
                      </button>
                      <span className="min-w-[20px] text-center font-extrabold text-xs tabular-nums">
                        {item.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateItemQty(idx, 1)}
                        className="w-7 h-7 rounded-md font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] flex items-center justify-center cursor-pointer"
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setNoteModalIdx(idx);
                        setNoteText(item.note || '');
                      }}
                      title="Edit note"
                      className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--gold)] hover:bg-[var(--bg)] cursor-pointer shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveItem(idx)}
                      title="Remove item"
                      className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--accent-soft)] cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--line)] px-4 py-3.5 shrink-0 bg-[var(--surface)]">
            <div className="flex justify-between text-xs text-[var(--ink-2)] py-0.5">
              <span>Subtotal</span>
              <span className="font-bold text-[var(--ink)] tabular-nums">{rp(currentTotals.subtotal)}</span>
            </div>
            {currentTotals.tax > 0 && (
              <div className="flex justify-between text-xs text-[var(--ink-2)] py-0.5">
                <span>Tax ({settings.taxPercent}%)</span>
                <span className="font-bold text-[var(--ink)] tabular-nums">{rp(currentTotals.tax)}</span>
              </div>
            )}
            {currentTotals.svc > 0 && (
              <div className="flex justify-between text-xs text-[var(--ink-2)] py-0.5">
                <span>Service ({settings.servicePercent}%)</span>
                <span className="font-bold text-[var(--ink)] tabular-nums">{rp(currentTotals.svc)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline text-lg font-extrabold text-[var(--ink)] pt-2.5 mt-2 border-t border-dashed border-[var(--line)]">
              <span>Total</span>
              <span className="text-xl text-[var(--accent)] tabular-nums">{rp(currentTotals.total)}</span>
            </div>

            <button
              type="button"
              disabled={!currentOrder || !currentOrder.items.length}
              onClick={openPayModal}
              className="w-full mt-3 py-3.5 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] font-bold text-sm shadow-sm hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Pay &amp; Print
            </button>
            <button
              type="button"
              disabled={!currentOrder || !currentOrder.items.length}
              onClick={() => setConfirmClear(true)}
              className="w-full mt-2 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] font-bold text-xs hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Clear Items
            </button>
          </div>
        </aside>
      </div>

      {/* New Order Modal */}
      <Modal
        open={newOrderModal}
        title="New Order"
        onClose={() => setNewOrderModal(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setNewOrderModal(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitNewOrder}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              Create
            </button>
          </>
        }
      >
        <label className="block mb-3">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
            Table / Customer Name
          </span>
          <input
            autoFocus
            type="text"
            value={newOrderName}
            onChange={e => setNewOrderName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitNewOrder()}
            placeholder="e.g. Budi, Meja 8"
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        </label>
        <div className="text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-2">Quick Select</div>
        <div className="flex flex-wrap gap-2">
          {ORDER_SHORTCUTS.map(name => (
            <button
              key={name}
              type="button"
              onClick={() => setNewOrderName(name)}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                newOrderName === name
                  ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)]'
                  : 'bg-[var(--surface)] border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--muted)]'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </Modal>

      {/* Custom Item Modal */}
      <Modal
        open={customModal}
        title="Custom Item"
        onClose={() => setCustomModal(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setCustomModal(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!customName.trim()) {
                  onToast('Enter an item name', 'err');
                  return;
                }
                onAddItem({
                  productId: 'c_' + uid(),
                  name: customName.trim(),
                  price: Number(customPrice) || 0,
                  qty: 1,
                  note: customNote.trim(),
                });
                setCustomModal(false);
              }}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              Add Item
            </button>
          </>
        }
      >
        <label className="block mb-3">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">Name</span>
          <input
            autoFocus
            type="text"
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        </label>
        <label className="block mb-3">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">Price (Rp)</span>
          <input
            type="number"
            value={customPrice}
            onChange={e => setCustomPrice(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)] tabular-nums"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">Note</span>
          <input
            type="text"
            value={customNote}
            onChange={e => setCustomNote(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        </label>
      </Modal>

      {/* Item Note Modal */}
      <Modal
        open={noteModalIdx !== null}
        title="Item Note"
        onClose={() => setNoteModalIdx(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setNoteModalIdx(null)}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (noteModalIdx !== null) {
                  onUpdateItemNote(noteModalIdx, noteText.trim());
                }
                setNoteModalIdx(null);
              }}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              Save Note
            </button>
          </>
        }
      >
        <label className="block">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
            Special Request
          </span>
          <input
            autoFocus
            type="text"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && noteModalIdx !== null) {
                onUpdateItemNote(noteModalIdx, noteText.trim());
                setNoteModalIdx(null);
              }
            }}
            placeholder="e.g. No MSG, Extra spicy"
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        </label>
      </Modal>

      {/* Split Payment Modal */}
      <Modal
        open={payModal}
        title={`Payment — ${currentOrder?.name || ''}`}
        onClose={() => setPayModal(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setPayModal(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={payDiff > 0}
              onClick={() => {
                setPayModal(false);
                onCompleteSale(payments);
              }}
              className="px-5 py-2 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] disabled:opacity-40 cursor-pointer"
            >
              Pay &amp; Print
            </button>
          </>
        }
      >
        <div className="text-center pb-5">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted)]">Amount Due</div>
          <div className="text-4xl font-extrabold text-[var(--accent)] mt-1 tabular-nums">
            {rp(currentTotals.total)}
          </div>
        </div>

        <div className="space-y-3">
          {payments.map((p, idx) => {
            const otherPaid = payments.reduce(
              (sum, item, i) => (i === idx ? sum : sum + (Number(item.amount) || 0)),
              0
            );
            const cashDue = Math.max(0, currentTotals.total - otherPaid);
            const cashSuggestions = p.method === 'Cash' ? getIndonesianCashSuggestions(cashDue) : [];
            const customVal = customCashInputs[idx] ?? '';
            const isCustomActive =
              customVal !== '' &&
              Number(customVal) === (Number(p.amount) || 0) &&
              !cashSuggestions.includes(Number(p.amount) || 0);

            return (
              <div key={idx} className="space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={p.method}
                    onChange={e => {
                      const next = [...payments];
                      next[idx] = { ...next[idx], method: e.target.value as PaymentSplit['method'] };
                      setPayments(next);
                      setCustomCashInputs(prev => {
                        const copy = { ...prev };
                        delete copy[idx];
                        return copy;
                      });
                    }}
                    className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
                  >
                    <option value="Cash">Cash</option>
                    <option value="QRIS">QRIS</option>
                    <option value="Transfer">Transfer</option>
                  </select>
                  <input
                    type="number"
                    value={p.amount}
                    onChange={e => {
                      const next = [...payments];
                      next[idx] = { ...next[idx], amount: Number(e.target.value) || 0 };
                      setPayments(next);
                    }}
                    className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm font-bold text-right text-[var(--ink)] tabular-nums outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
                  />
                  {payments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPayments(payments.filter((_, i) => i !== idx));
                        setCustomCashInputs({});
                      }}
                      className="p-2.5 rounded-xl border border-[var(--line)] text-[var(--danger)] hover:bg-[var(--accent-soft)] cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {p.method === 'Cash' && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted)]">
                        Cash Received
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...payments];
                          next[idx] = { ...next[idx], amount: cashDue };
                          setPayments(next);
                          setCustomCashInputs(prev => ({ ...prev, [idx]: '' }));
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer tabular-nums ${
                          Number(p.amount) === cashDue
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                            : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--accent)]'
                        }`}
                      >
                        Exact {rp(cashDue)}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {cashSuggestions.map(amt => {
                        const selected = Number(p.amount) === amt && !isCustomActive;
                        return (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => {
                              const next = [...payments];
                              next[idx] = { ...next[idx], amount: amt };
                              setPayments(next);
                              setCustomCashInputs(prev => ({ ...prev, [idx]: '' }));
                            }}
                            className={`flex items-center justify-center px-2.5 py-2.5 rounded-xl border text-center transition-all cursor-pointer active:scale-[0.98] ${
                              selected
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)]'
                                : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--accent)]'
                            }`}
                          >
                            <span className="text-xs font-extrabold tabular-nums whitespace-nowrap">
                              {rp(amt)}
                            </span>
                          </button>
                        );
                      })}

                      <label
                        className={`flex flex-col justify-center px-2.5 py-1.5 rounded-xl border transition-all ${
                          isCustomActive
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]'
                            : 'border-[var(--line)] bg-[var(--surface)] focus-within:border-[var(--accent)]'
                        }`}
                      >
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--muted)]">
                          Custom Rp
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          step="1000"
                          value={customVal}
                          placeholder="Type..."
                          onChange={e => {
                            const raw = e.target.value;
                            setCustomCashInputs(prev => ({ ...prev, [idx]: raw }));
                            const parsed = Number(raw);
                            const next = [...payments];
                            next[idx] = {
                              ...next[idx],
                              amount: raw === '' ? cashDue : Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
                            };
                            setPayments(next);
                          }}
                          className="w-full bg-transparent text-xs font-extrabold text-[var(--ink)] tabular-nums outline-none placeholder:text-[var(--muted)] placeholder:font-medium"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setPayments([...payments, { method: 'QRIS', amount: Math.max(0, payDiff) }])}
          className="w-full mt-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] cursor-pointer"
        >
          + Add Split Payment
        </button>

        <div className="flex items-center justify-between bg-[var(--bg)] border border-[var(--line)] rounded-xl px-4 py-3.5 mt-4 text-sm font-bold text-[var(--ink-2)]">
          <span>{payDiff > 0 ? 'Remaining to Pay' : 'Change'}</span>
          <strong className={`text-lg tabular-nums ${payDiff > 0 ? 'text-[var(--danger)]' : 'text-[var(--green)]'}`}>
            {payDiff > 0 ? `Short ${rp(payDiff)}` : rp(-payDiff)}
          </strong>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmDeleteOrderId !== null}
        title="Delete Order"
        message="Remove this active order and its items?"
        confirmLabel="Delete Order"
        onConfirm={() => {
          if (confirmDeleteOrderId) onDeleteOrder(confirmDeleteOrderId);
        }}
        onClose={() => setConfirmDeleteOrderId(null)}
      />

      <ConfirmModal
        open={confirmClear}
        title="Clear Items"
        message="Remove all items from the current order?"
        confirmLabel="Clear Items"
        onConfirm={onClearItems}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
