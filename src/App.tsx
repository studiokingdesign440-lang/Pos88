import React, { useCallback, useEffect, useState } from 'react';
import { Play, Printer } from 'lucide-react';
import {
  BusinessDaySession,
  DailyRecord,
  Expense,
  OrderItem,
  PaymentSplit,
  PosState,
  PrintLine,
  Product,
  Sale,
  Settings,
  SyncMeta,
  ToastItem,
  ViewTab,
} from './types';
import { DEFAULT_PRODUCTS, DEFAULT_SETTINGS, STORE_KEY } from './constants';
import { pickRandom, rp, uid } from './utils/format';
import { fmtDateTime, fmtTime, getEffectiveTimezone, localDate, normalizeDateFromSheet } from './utils/time';
import {
  buildEscPos,
  buildReceipt,
  buildSummaryReceipt,
  connectBluetoothPrinter,
  linesToPreviewText,
  printerState,
  printViaBrowser,
  sendToPrinter,
} from './utils/printer';
import {
  computeDailyMetrics,
  gasCall,
  pullAllFromSheets,
  pushAllToSheets,
  sanitizeSettingsForPush,
} from './utils/sheets';
import { computeOrderTotals, OrdersView } from './components/OrdersView';
import { SummaryView } from './components/SummaryView';
import { ExpensesView } from './components/ExpensesView';
import { ProductsView } from './components/ProductsView';
import { SalesView } from './components/SalesView';
import { SettingsView } from './components/SettingsView';
import { Modal } from './components/Modal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { useOnlineStatus } from './hooks/useOnlineStatus';

function loadInitialState(): PosState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PosState>;
      const settings: Settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
      const tz = settings.timezone || 'Asia/Jakarta';

      const products =
        Array.isArray(parsed.products) && parsed.products.length > 0
          ? parsed.products
          : DEFAULT_PRODUCTS;

      const sales: Sale[] = Array.isArray(parsed.sales)
        ? parsed.sales.map(s => ({
            ...s,
            date: normalizeDateFromSheet(s.date || new Date(s.ts || Date.now()).toISOString(), tz),
            tax: Number(s.tax) || 0,
            service: Number(s.service) || 0,
          }))
        : [];

      const expenses: Expense[] = Array.isArray(parsed.expenses)
        ? parsed.expenses.map(e => ({
            ...e,
            date: normalizeDateFromSheet(e.date, tz),
          }))
        : [];

      const daily: Record<string, DailyRecord> = {};
      if (parsed.daily && typeof parsed.daily === 'object') {
        Object.entries(parsed.daily).forEach(([k, v]) => {
          const nk = normalizeDateFromSheet(k, tz);
          if (nk && v) {
            daily[nk] = {
              kas: Number(v.kas) || 0,
              actualCash: Number(v.actualCash) || 0,
              expectedCash: Number(v.expectedCash) || 0,
              totalSales: v.totalSales,
              cashSales: v.cashSales,
              qrisSales: v.qrisSales,
              totalExpenses: v.totalExpenses,
              cashExpenses: v.cashExpenses,
              creditExpenses: v.creditExpenses,
              netProfit: v.netProfit,
              updatedAt: v.updatedAt,
            };
          }
        });
      }

      const businessDay: BusinessDaySession | null =
        parsed.businessDay && typeof parsed.businessDay === 'object' && parsed.businessDay.date
          ? {
              id: String(parsed.businessDay.id || uid()),
              date: normalizeDateFromSheet(parsed.businessDay.date, tz),
              openedAt: Number(parsed.businessDay.openedAt) || Date.now(),
            }
          : null;

      return {
        products,
        sales,
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
        expenses,
        daily,
        settings,
        pendingDeletes: {
          expenses: parsed.pendingDeletes?.expenses || [],
          sales: parsed.pendingDeletes?.sales || [],
        },
        businessDay,
      };
    }
  } catch (err) {
    console.warn('Failed to parse saved POS state:', err);
  }

  return {
    products: DEFAULT_PRODUCTS,
    sales: [],
    orders: [],
    expenses: [],
    daily: {},
    settings: { ...DEFAULT_SETTINGS },
    pendingDeletes: { expenses: [], sales: [] },
    businessDay: null,
  };
}

export default function App() {
  const [state, setState] = useState<PosState>(loadInitialState);
  const [activeTab, setActiveTab] = useState<ViewTab>('pos');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(() => {
    const initial = loadInitialState();
    return initial.orders[0]?.id || null;
  });

  const [printerConnected, setPrinterConnected] = useState(printerState.connected);
  const [printerLabel, setPrinterLabel] = useState(printerState.label);
  const [logoError, setLogoError] = useState(false);
  const isOnline = useOnlineStatus();

  const [syncing, setSyncing] = useState(false);
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({
    lastSyncedAt: null,
    lastAction: null,
    lastError: null,
    pendingCount: 0,
  });

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [previewModal, setPreviewModal] = useState<{
    open: boolean;
    title: string;
    subtitle?: string;
    lines: PrintLine[];
    summaryDate?: string;
  }>({ open: false, title: '', lines: [] });
  const [closeDayOnPrint, setCloseDayOnPrint] = useState(true);

  const [businessDayModal, setBusinessDayModal] = useState<'open' | 'info' | null>(null);
  const [openDayDate, setOpenDayDate] = useState(() => localDate(new Date(), state.settings.timezone));
  const [openDayKas, setOpenDayKas] = useState('');

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    const id = uid();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3200);
  }, []);

  // Apply active theme to <html>
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme || 'original';
  }, [state.settings.theme]);

  // Persist state to localStorage
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn('Failed to save state:', err);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [state]);

  // Keep pendingCount synced
  useEffect(() => {
    const count = state.pendingDeletes.expenses.length + state.pendingDeletes.sales.length;
    setSyncMeta(prev => (prev.pendingCount === count ? prev : { ...prev, pendingCount: count }));
  }, [state.pendingDeletes]);

  const handleConnectPrinter = async () => {
    const res = await connectBluetoothPrinter();
    setPrinterConnected(res.ok);
    setPrinterLabel(res.label);
    if (res.ok) {
      showToast('Printer connected: ' + res.label);
    } else {
      showToast(res.error || 'Printer connection failed', 'err');
    }
  };

  const printLines = async (lines: PrintLine[], previewTitle = 'Receipt Preview') => {
    if (state.settings.printMethod === 'browser') {
      printViaBrowser(lines, state.settings.paperWidth);
      return;
    }
    try {
      if (!printerState.connected) {
        const res = await connectBluetoothPrinter();
        setPrinterConnected(res.ok);
        setPrinterLabel(res.label);
        if (!res.ok) throw new Error(res.error || 'Printer not connected');
      }
      await sendToPrinter(buildEscPos(lines, state.settings));
      showToast('Printed');
    } catch {
      setPreviewModal({
        open: true,
        title: previewTitle,
        lines,
      });
    }
  };

  // --- Orders Handlers ---
  const handleCreateOrder = (name: string) => {
    const order = {
      id: uid(),
      name: name || `Order ${state.orders.length + 1}`,
      items: [],
      createdAt: Date.now(),
    };
    setState(prev => ({ ...prev, orders: [...prev.orders, order] }));
    setCurrentOrderId(order.id);
  };

  const handleDeleteOrder = (id: string) => {
    setState(prev => {
      const nextOrders = prev.orders.filter(o => o.id !== id);
      if (currentOrderId === id) {
        setCurrentOrderId(nextOrders[0]?.id || null);
      }
      return { ...prev, orders: nextOrders };
    });
  };

  const handleUpdateOrderName = (id: string, name: string) => {
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => (o.id === id ? { ...o, name } : o)),
    }));
  };

  const handleAddItem = (item: OrderItem) => {
    if (!currentOrderId) {
      showToast('Create an order first', 'err');
      return;
    }
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => {
        if (o.id !== currentOrderId) return o;
        const existingIdx = o.items.findIndex(
          i => i.productId === item.productId && !i.note && !item.note
        );
        if (existingIdx !== -1) {
          const nextItems = [...o.items];
          nextItems[existingIdx] = {
            ...nextItems[existingIdx],
            qty: nextItems[existingIdx].qty + item.qty,
          };
          return { ...o, items: nextItems };
        }
        return { ...o, items: [...o.items, item] };
      }),
    }));
  };

  const handleUpdateItemQty = (idx: number, delta: number) => {
    if (!currentOrderId) return;
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => {
        if (o.id !== currentOrderId) return o;
        const nextItems = [...o.items];
        const nextQty = (nextItems[idx]?.qty || 0) + delta;
        if (nextQty <= 0) nextItems.splice(idx, 1);
        else nextItems[idx] = { ...nextItems[idx], qty: nextQty };
        return { ...o, items: nextItems };
      }),
    }));
  };

  const handleUpdateItemNote = (idx: number, note: string) => {
    if (!currentOrderId) return;
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => {
        if (o.id !== currentOrderId) return o;
        const nextItems = [...o.items];
        if (nextItems[idx]) nextItems[idx] = { ...nextItems[idx], note };
        return { ...o, items: nextItems };
      }),
    }));
  };

  const handleRemoveItem = (idx: number) => {
    if (!currentOrderId) return;
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => {
        if (o.id !== currentOrderId) return o;
        const nextItems = [...o.items];
        nextItems.splice(idx, 1);
        return { ...o, items: nextItems };
      }),
    }));
  };

  const handleClearItems = () => {
    if (!currentOrderId) return;
    setState(prev => ({
      ...prev,
      orders: prev.orders.map(o => (o.id === currentOrderId ? { ...o, items: [] } : o)),
    }));
  };

  const openBusinessDayDialog = () => {
    if (state.businessDay) {
      setBusinessDayModal('info');
      return;
    }
    const d = localDate(new Date(), state.settings.timezone);
    setOpenDayDate(d);
    const existingKas = state.daily[d]?.kas;
    setOpenDayKas(existingKas ? String(existingKas) : '');
    setBusinessDayModal('open');
  };

  const handleOpenBusinessDay = async (dateStr: string, kasAmount: number) => {
    const cleanDate = dateStr || localDate(new Date(), state.settings.timezone);
    const session: BusinessDaySession = {
      id: uid(),
      date: cleanDate,
      openedAt: Date.now(),
    };
    const updatedDaily = computeDailyMetrics(cleanDate, state.sales, state.expenses, {
      ...(state.daily[cleanDate] || { kas: 0, actualCash: 0, expectedCash: 0 }),
      kas: kasAmount,
    });

    setState(prev => ({
      ...prev,
      businessDay: session,
      daily: { ...prev.daily, [cleanDate]: updatedDaily },
    }));
    setBusinessDayModal(null);
    showToast(`Business Day ${cleanDate} opened`);

    if (state.settings.gasUrl) {
      try {
        await gasCall(state.settings.gasUrl, 'saveDaily', updatedDaily, state.settings.timezone);
      } catch {
        // Daily kas stays saved locally and syncs with next sale/push
      }
    }
  };

  const handleCloseBusinessDay = async (dateOverride?: string) => {
    const targetDate = dateOverride || state.businessDay?.date;
    if (!targetDate) return;

    const updatedDaily = computeDailyMetrics(
      targetDate,
      state.sales,
      state.expenses,
      state.daily[targetDate]
    );

    setState(prev => ({
      ...prev,
      businessDay: prev.businessDay?.date === targetDate ? null : prev.businessDay,
      daily: { ...prev.daily, [targetDate]: updatedDaily },
    }));
    setBusinessDayModal(null);

    if (!state.settings.gasUrl) {
      showToast(`Business Day ${targetDate} closed & saved`);
      return;
    }

    try {
      await gasCall(state.settings.gasUrl, 'saveDaily', updatedDaily, state.settings.timezone);
      setSyncMeta(prev => ({
        ...prev,
        lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
        lastAction: `Business Day ${targetDate} closed & synced`,
        lastError: null,
      }));
      showToast(`Business Day ${targetDate} closed & synced`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setSyncMeta(prev => ({ ...prev, lastError: msg }));
      showToast(`Business Day ${targetDate} closed locally; sync failed: ${msg}`, 'err');
    }
  };

  const handleCompleteSale = async (payments: PaymentSplit[]) => {
    const order = state.orders.find(o => o.id === currentOrderId);
    if (!order) return;

    const totals = computeOrderTotals(order.items, state.settings);
    const nowMs = Date.now();
    const activeDay = state.businessDay;
    const saleDate = activeDay?.date || localDate(nowMs, state.settings.timezone);
    const nextBusinessDay: BusinessDaySession = activeDay || {
      id: uid(),
      date: saleDate,
      openedAt: nowMs,
    };
    const paidSum = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const cashier = pickRandom(state.settings.cashierNames, state.settings.lastCashier);

    const sale: Sale = {
      id: uid(),
      ts: nowMs,
      date: saleDate,
      orderNo: String(state.sales.length + 1).padStart(4, '0'),
      orderName: order.name,
      cashier,
      items: order.items,
      subtotal: totals.subtotal,
      tax: totals.tax,
      service: totals.svc,
      total: totals.total,
      payments,
      change: paidSum - totals.total,
      thanks: pickRandom(state.settings.thanks),
      quote: pickRandom(state.settings.quotes),
    };

    const nextSales = [...state.sales, sale];
    const updatedDaily = computeDailyMetrics(
      saleDate,
      nextSales,
      state.expenses,
      state.daily[saleDate]
    );
    const nextOrders = state.orders.filter(o => o.id !== order.id);

    setState(prev => ({
      ...prev,
      sales: nextSales,
      orders: nextOrders,
      daily: { ...prev.daily, [saleDate]: updatedDaily },
      settings: { ...prev.settings, lastCashier: cashier },
      businessDay: nextBusinessDay,
    }));
    setCurrentOrderId(nextOrders[0]?.id || null);
    if (!activeDay) {
      showToast(`Business Day ${saleDate} auto-opened`);
    }

    void printLines(buildReceipt(sale, state.settings), `Receipt #${sale.orderNo}`);

    if (state.settings.gasUrl) {
      try {
        await gasCall(state.settings.gasUrl, 'addSale', sale, state.settings.timezone);
        await gasCall(state.settings.gasUrl, 'saveDaily', updatedDaily, state.settings.timezone);
        setSyncMeta(prev => ({
          ...prev,
          lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
          lastAction: 'Sale & Daily Report synced',
          lastError: null,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sync failed';
        setSyncMeta(prev => ({ ...prev, lastError: msg }));
        showToast('Saved locally; Sheets sync failed: ' + msg, 'err');
      }
    }
  };

  // --- Expenses Handlers ---
  const handleAddExpense = async (data: {
    date: string;
    name: string;
    amount: number;
    type: 'Cash' | 'Credit';
  }) => {
    const exp: Expense = {
      id: uid(),
      date: data.date,
      name: data.name,
      amount: data.amount,
      type: data.type,
      ts: Date.now(),
      updatedAt: new Date().toISOString(),
    };

    const nextExpenses = [...state.expenses, exp];
    const updatedDaily = computeDailyMetrics(
      exp.date,
      state.sales,
      nextExpenses,
      state.daily[exp.date]
    );

    setState(prev => ({
      ...prev,
      expenses: nextExpenses,
      daily: { ...prev.daily, [exp.date]: updatedDaily },
    }));

    if (!state.settings.gasUrl) {
      showToast('Expense added locally');
      return;
    }

    setSyncing(true);
    try {
      await gasCall(state.settings.gasUrl, 'addExpense', exp, state.settings.timezone);
      await gasCall(state.settings.gasUrl, 'saveDaily', updatedDaily, state.settings.timezone);
      setSyncMeta(prev => ({
        ...prev,
        lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
        lastAction: 'Expense synced',
        lastError: null,
      }));
      showToast('Expense saved & synced to Google Sheets');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setSyncMeta(prev => ({ ...prev, lastError: msg }));
      showToast('Expense saved locally; Sheets sync failed: ' + msg, 'err');
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    const target = state.expenses.find(e => e.id === id);
    const nextExpenses = state.expenses.filter(e => e.id !== id);
    const expDate = target?.date || localDate(new Date(), state.settings.timezone);
    const updatedDaily = computeDailyMetrics(
      expDate,
      state.sales,
      nextExpenses,
      state.daily[expDate]
    );

    if (!state.settings.gasUrl) {
      setState(prev => ({
        ...prev,
        expenses: nextExpenses,
        daily: { ...prev.daily, [expDate]: updatedDaily },
        pendingDeletes: {
          ...prev.pendingDeletes,
          expenses: [...new Set([...prev.pendingDeletes.expenses, id])],
        },
      }));
      showToast('Expense deleted locally');
      return;
    }

    setState(prev => ({
      ...prev,
      expenses: nextExpenses,
      daily: { ...prev.daily, [expDate]: updatedDaily },
    }));

    setSyncing(true);
    try {
      await gasCall(state.settings.gasUrl, 'deleteExpense', { id }, state.settings.timezone);
      await gasCall(state.settings.gasUrl, 'saveDaily', updatedDaily, state.settings.timezone);
      setSyncMeta(prev => ({
        ...prev,
        lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
        lastAction: 'Expense deleted from Sheets',
        lastError: null,
      }));
      showToast('Expense deleted & synced');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setState(prev => ({
        ...prev,
        pendingDeletes: {
          ...prev.pendingDeletes,
          expenses: [...new Set([...prev.pendingDeletes.expenses, id])],
        },
      }));
      setSyncMeta(prev => ({ ...prev, lastError: msg }));
      showToast('Deleted locally; Sheets delete queued: ' + msg, 'err');
    } finally {
      setSyncing(false);
    }
  };

  // --- Daily Summary Handlers ---
  const handleSaveDaily = async (date: string, kas: number, actualCash: number) => {
    const metrics = computeDailyMetrics(date, state.sales, state.expenses, {
      ...(state.daily[date] || { kas: 0, actualCash: 0, expectedCash: 0 }),
      kas,
      actualCash,
    });

    setState(prev => ({
      ...prev,
      daily: { ...prev.daily, [date]: metrics },
    }));

    if (!state.settings.gasUrl) {
      showToast('Daily report saved locally');
      return;
    }

    setSyncing(true);
    try {
      await gasCall(state.settings.gasUrl, 'saveDaily', metrics, state.settings.timezone);
      setSyncMeta(prev => ({
        ...prev,
        lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
        lastAction: `Daily Report (${date}) synced`,
        lastError: null,
      }));
      showToast('Daily report saved & synced to Google Sheets');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setSyncMeta(prev => ({ ...prev, lastError: msg }));
      showToast('Saved locally; Sheets sync failed: ' + msg, 'err');
    } finally {
      setSyncing(false);
    }
  };

  const handlePrintSummary = (date: string) => {
    const lines = buildSummaryReceipt(
      state.settings,
      state.sales,
      state.expenses,
      state.daily,
      date,
      state.businessDay
    );
    const isCurrentBusinessDay = Boolean(state.businessDay && state.businessDay.date === date);
    setCloseDayOnPrint(isCurrentBusinessDay);
    setPreviewModal({
      open: true,
      title: `Preview: End of Day Report (${date})`,
      subtitle: 'Tip: If you spot a mistake, close this window, edit your Expenses or Kas, and print again.',
      lines,
      summaryDate: date,
    });
  };

  // --- Products Handlers ---
  const handleSaveProduct = (product: Product) => {
    setState(prev => {
      const exists = prev.products.some(p => p.id === product.id);
      const nextProducts = exists
        ? prev.products.map(p => (p.id === product.id ? product : p))
        : [...prev.products, product];
      return { ...prev, products: nextProducts };
    });
    showToast('Product saved');
  };

  const handleDeleteProduct = (id: string) => {
    setState(prev => ({
      ...prev,
      products: prev.products.filter(p => p.id !== id),
    }));
    showToast('Product deleted');
  };

  // --- Sheets Full Sync Handlers ---
  const handlePullSheets = async () => {
    if (!state.settings.gasUrl) {
      showToast('Set Apps Script Web App URL first', 'err');
      return;
    }
    setSyncing(true);
    try {
      const data = await pullAllFromSheets(state.settings.gasUrl, state.settings.timezone);
      setState(prev => ({
        ...prev,
        products: data.products.length ? data.products : prev.products,
        sales: data.sales,
        expenses: data.expenses,
        daily: data.daily,
        settings: data.settings
          ? { ...prev.settings, ...data.settings, gasUrl: prev.settings.gasUrl }
          : prev.settings,
        pendingDeletes: { expenses: [], sales: [] },
      }));
      setSyncMeta({
        lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
        lastAction: `Pulled ${data.sales.length} sales, ${data.expenses.length} expenses${data.settings ? ', settings' : ''}`,
        lastError: null,
        pendingCount: 0,
      });
      showToast(
        `Pulled ${data.products.length} products, ${data.sales.length} sales, ${data.expenses.length} expenses${
          data.settings ? ', & store settings' : ''
        }`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pull failed';
      setSyncMeta(prev => ({ ...prev, lastError: msg }));
      showToast('Pull failed: ' + msg, 'err');
    } finally {
      setSyncing(false);
    }
  };

  const handlePushAll = async () => {
    if (!state.settings.gasUrl) {
      showToast('Set Apps Script Web App URL first', 'err');
      return;
    }
    setSyncing(true);
    try {
      const { counts } = await pushAllToSheets(
        state.settings.gasUrl,
        {
          products: state.products,
          sales: state.sales,
          expenses: state.expenses,
          daily: state.daily,
          settings: state.settings,
          pendingDeletes: state.pendingDeletes,
        },
        state.settings.timezone
      );
      setState(prev => ({
        ...prev,
        pendingDeletes: { expenses: [], sales: [] },
      }));
      setSyncMeta({
        lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
        lastAction: `Pushed ${counts.products}p · ${counts.sales}s · ${counts.expenses}e · ${counts.daily}d · settings`,
        lastError: null,
        pendingCount: 0,
      });
      showToast(
        `Pushed to Sheets: ${counts.products} products, ${counts.sales} sales, ${counts.expenses} expenses, ${counts.daily} daily reports & store settings`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Push failed';
      setSyncMeta(prev => ({ ...prev, lastError: msg }));
      showToast('Push failed: ' + msg, 'err');
    } finally {
      setSyncing(false);
    }
  };

  const handlePushProducts = async () => {
    if (!state.settings.gasUrl) {
      showToast('Set Apps Script Web App URL first', 'err');
      return;
    }
    setSyncing(true);
    try {
      await gasCall(state.settings.gasUrl, 'saveProducts', state.products, state.settings.timezone);
      setSyncMeta(prev => ({
        ...prev,
        lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
        lastAction: `Pushed ${state.products.length} products`,
        lastError: null,
      }));
      showToast(`Pushed ${state.products.length} products`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Push failed';
      setSyncMeta(prev => ({ ...prev, lastError: msg }));
      showToast('Push products failed: ' + msg, 'err');
    } finally {
      setSyncing(false);
    }
  };

  const handlePushSettings = async () => {
    if (!state.settings.gasUrl) {
      showToast('Set Apps Script Web App URL first', 'err');
      return;
    }
    setSyncing(true);
    try {
      const payload = sanitizeSettingsForPush(state.settings);
      await gasCall(state.settings.gasUrl, 'saveSettings', payload, state.settings.timezone);
      setSyncMeta(prev => ({
        ...prev,
        lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
        lastAction: 'Store identity & messages pushed',
        lastError: null,
      }));
      showToast('Store settings, cashiers & messages pushed to Google Sheets');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Push settings failed';
      setSyncMeta(prev => ({ ...prev, lastError: msg }));
      showToast('Push settings failed: ' + msg, 'err');
    } finally {
      setSyncing(false);
    }
  };

  const handleTestConnection = async () => {
    if (!state.settings.gasUrl) {
      showToast('Set Apps Script Web App URL first', 'err');
      return;
    }
    setSyncing(true);
    try {
      const tz = getEffectiveTimezone(state.settings.timezone);
      const rawUrl = state.settings.gasUrl.trim();
      if (rawUrl.includes('docs.google.com/spreadsheets')) {
        throw new Error('Paste the Apps Script Web App URL (/exec), not the Google Sheet URL.');
      }
      if (/\/dev(\?|$)/.test(rawUrl)) {
        throw new Error('You pasted a /dev URL. Deploy as Web App and use the /exec URL.');
      }
      const sep = rawUrl.includes('?') ? '&' : '?';
      const url = `${rawUrl}${sep}action=ping&tz=${encodeURIComponent(tz)}&_=${Date.now()}`;
      const res = await fetch(url, { method: 'GET', redirect: 'follow' });
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Web App returned HTML — deploy with "Who has access: Anyone" and authorize permissions.');
      }
      const data = JSON.parse(text) as {
        ok?: boolean;
        error?: string;
        timezone?: string;
        spreadsheetTimezone?: string;
      };
      if (data.ok === false || data.error) {
        throw new Error(data.error || 'Apps Script returned an error.');
      }
      setSyncMeta(prev => ({
        ...prev,
        lastSyncedAt: fmtTime(Date.now(), state.settings.timezone),
        lastAction: `Connected (${data.timezone || tz})`,
        lastError: null,
      }));
      showToast(
        `Connected! App TZ: ${data.timezone || tz} · Sheet TZ: ${data.spreadsheetTimezone || 'Unknown'}`
      );
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? 'Blocked by CORS or network error. Ensure Apps Script is deployed as a New version with "Execute as: Me" and "Who has access: Anyone".'
          : err instanceof Error
          ? err.message
          : 'Connection test failed';
      setSyncMeta(prev => ({ ...prev, lastError: msg }));
      showToast(msg, 'err');
    } finally {
      setSyncing(false);
    }
  };

  // --- Backup / Settings ---
  const handleUpdateSettings = (patch: Partial<Settings>) => {
    setState(prev => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `h88_backup_${localDate(new Date(), state.settings.timezone)}.json`;
    a.click();
  };

  const handleImportJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result || '{}')) as Partial<PosState>;
        const settings = { ...DEFAULT_SETTINGS, ...(imported.settings || {}) };
        setState({
          products: Array.isArray(imported.products) ? imported.products : DEFAULT_PRODUCTS,
          sales: Array.isArray(imported.sales) ? imported.sales : [],
          orders: Array.isArray(imported.orders) ? imported.orders : [],
          expenses: Array.isArray(imported.expenses) ? imported.expenses : [],
          daily: imported.daily || {},
          settings,
          pendingDeletes: imported.pendingDeletes || { expenses: [], sales: [] },
          businessDay: imported.businessDay || null,
        });
        showToast('Backup imported');
      } catch {
        showToast('Invalid JSON backup file', 'err');
      }
    };
    reader.readAsText(file);
  };

  const handleResetData = () => {
    localStorage.removeItem(STORE_KEY);
    setState({
      products: DEFAULT_PRODUCTS,
      sales: [],
      orders: [],
      expenses: [],
      daily: {},
      settings: { ...DEFAULT_SETTINGS },
      pendingDeletes: { expenses: [], sales: [] },
      businessDay: null,
    });
    setCurrentOrderId(null);
    showToast('Local data wiped');
  };

  const navItems: { id: ViewTab; label: string }[] = [
    { id: 'pos', label: 'Orders' },
    { id: 'summary', label: 'Summary' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'products', label: 'Products' },
    { id: 'sales', label: 'Sales' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="flex flex-col h-dvh w-full overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      {/* Top Bar (3-zone contract) */}
      <header className="flex items-center justify-between gap-6 px-5 h-16 shrink-0 bg-[var(--header-bg)] backdrop-blur-md border-b border-[var(--line)] z-30">
        {/* Zone 1: Brand wordmark */}
        <div className="flex items-center gap-2.5 shrink-0">
          {!logoError ? (
            <img
              src={`${import.meta.env.BASE_URL}assets/aistudio/icon_74a256f3.png`}
              alt="Hokkien 88 Logo"
              onError={() => setLogoError(true)}
              className="w-10 h-10 rounded-full object-cover shrink-0 shadow-sm"
            />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] flex items-center justify-center font-display font-bold text-base shadow-sm">
              88
            </div>
          )}
          <span className="font-display font-bold text-base tracking-tight whitespace-nowrap shrink-0 text-[var(--ink)]">
            {state.settings.storeName || 'Hokkien 88'}
          </span>
        </div>

        {/* Zone 2: Navigation tabs */}
        <nav className="flex items-center gap-1 bg-[var(--surface-2)] p-1 rounded-xl overflow-x-auto border border-[var(--line)]">
          {navItems.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === item.id
                  ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm'
                  : 'text-[var(--ink-2)] hover:text-[var(--ink)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Primary actions (Business Day + Install + Printer) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={openBusinessDayDialog}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              state.businessDay
                ? 'bg-[var(--green-soft)] text-[var(--green)] border-[var(--green-line)]'
                : 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]'
            }`}
          >
            {state.businessDay ? (
              <>
                <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
                <span>Day: {state.businessDay.date.slice(5)}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Open Day</span>
              </>
            )}
          </button>
          <PWAInstallButton variant="header" />
          <button
            type="button"
            onClick={handleConnectPrinter}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              printerConnected
                ? 'bg-[var(--green-soft)] text-[var(--green)] border-[var(--green-line)]'
                : 'bg-[var(--surface-2)] text-[var(--ink-2)] border-[var(--line)] hover:border-[var(--muted)]'
            }`}
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{printerLabel}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0 relative overflow-hidden">
        {activeTab === 'pos' && (
          <OrdersView
            orders={state.orders}
            currentOrderId={currentOrderId}
            products={state.products}
            settings={state.settings}
            businessDay={state.businessDay}
            onOpenBusinessDayModal={openBusinessDayDialog}
            onSelectOrder={setCurrentOrderId}
            onCreateOrder={handleCreateOrder}
            onDeleteOrder={handleDeleteOrder}
            onUpdateOrderName={handleUpdateOrderName}
            onAddItem={handleAddItem}
            onUpdateItemQty={handleUpdateItemQty}
            onUpdateItemNote={handleUpdateItemNote}
            onRemoveItem={handleRemoveItem}
            onClearItems={handleClearItems}
            onCompleteSale={handleCompleteSale}
            onToast={showToast}
          />
        )}

        {activeTab === 'summary' && (
          <SummaryView
            sales={state.sales}
            expenses={state.expenses}
            daily={state.daily}
            settings={state.settings}
            businessDay={state.businessDay}
            syncing={syncing}
            onSaveDaily={handleSaveDaily}
            onPrintSummary={handlePrintSummary}
            onPushAll={handlePushAll}
            onOpenBusinessDayModal={openBusinessDayDialog}
          />
        )}

        {activeTab === 'expenses' && (
          <ExpensesView
            expenses={state.expenses}
            settings={state.settings}
            businessDay={state.businessDay}
            syncing={syncing}
            onAddExpense={handleAddExpense}
            onDeleteExpense={handleDeleteExpense}
            onPushAll={handlePushAll}
            onToast={showToast}
          />
        )}

        {activeTab === 'products' && (
          <ProductsView
            products={state.products}
            settings={state.settings}
            syncing={syncing}
            onSaveProduct={handleSaveProduct}
            onDeleteProduct={handleDeleteProduct}
            onPushProducts={handlePushProducts}
            onToast={showToast}
          />
        )}

        {activeTab === 'sales' && (
          <SalesView
            sales={state.sales}
            settings={state.settings}
            businessDay={state.businessDay}
            onReprint={sale => void printLines(buildReceipt(sale, state.settings), `Receipt #${sale.orderNo}`)}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            settings={state.settings}
            syncing={syncing}
            syncMeta={syncMeta}
            onUpdateSettings={handleUpdateSettings}
            onConnectPrinter={handleConnectPrinter}
            onTestPrint={() => {
              const fakeSale: Sale = {
                id: 'test',
                ts: Date.now(),
                date: localDate(new Date(), state.settings.timezone),
                orderNo: '0001',
                orderName: 'Test Table',
                cashier: 'Test Cashier',
                items: [{ productId: 'test', name: 'Nasi Goreng Daging', price: 28000, qty: 1, note: '' }],
                subtotal: 28000,
                tax: 0,
                service: 0,
                total: 28000,
                payments: [{ method: 'Cash', amount: 28000 }],
                change: 0,
                thanks: 'Thank you!',
                quote: '',
              };
              void printLines(buildReceipt(fakeSale, state.settings), 'Test Receipt Preview');
            }}
            onPullSheets={handlePullSheets}
            onPushAll={handlePushAll}
            onPushProducts={handlePushProducts}
            onPushSettings={handlePushSettings}
            onTestConnection={handleTestConnection}
            onExportJson={handleExportJson}
            onImportJson={handleImportJson}
            onResetData={handleResetData}
            onToast={showToast}
          />
        )}
      </main>

      {/* Receipt / Summary Print Preview Modal */}
      <Modal
        open={previewModal.open}
        title={previewModal.title}
        onClose={() => setPreviewModal(prev => ({ ...prev, open: false }))}
        footer={
          <>
            <button
              type="button"
              onClick={() => setPreviewModal(prev => ({ ...prev, open: false }))}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                const lines = previewModal.lines;
                const summaryDate = previewModal.summaryDate;
                const shouldCloseDay =
                  Boolean(summaryDate && closeDayOnPrint && state.businessDay?.date === summaryDate);
                setPreviewModal(prev => ({ ...prev, open: false }));
                printViaBrowser(lines, state.settings.paperWidth);
                if (shouldCloseDay && summaryDate) {
                  void handleCloseBusinessDay(summaryDate);
                }
              }}
              className="px-4 py-2 rounded-xl text-sm font-bold border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--bg)] cursor-pointer"
            >
              Browser Print
            </button>
            <button
              type="button"
              onClick={async () => {
                const lines = previewModal.lines;
                const summaryDate = previewModal.summaryDate;
                const shouldCloseDay =
                  Boolean(summaryDate && closeDayOnPrint && state.businessDay?.date === summaryDate);
                setPreviewModal(prev => ({ ...prev, open: false }));
                try {
                  if (!printerState.connected) {
                    const res = await connectBluetoothPrinter();
                    setPrinterConnected(res.ok);
                    setPrinterLabel(res.label);
                    if (!res.ok) throw new Error(res.error || 'Printer failed');
                  }
                  await sendToPrinter(buildEscPos(lines, state.settings));
                  showToast('Printed');
                  if (shouldCloseDay && summaryDate) {
                    await handleCloseBusinessDay(summaryDate);
                  }
                } catch {
                  showToast('Thermal printer failed — use Browser Print', 'err');
                }
              }}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              Thermal Print
            </button>
          </>
        }
      >
        {previewModal.subtitle && (
          <p className="text-xs text-[var(--muted)] italic mb-3">{previewModal.subtitle}</p>
        )}
        {previewModal.summaryDate && state.businessDay?.date === previewModal.summaryDate && (
          <label className="flex items-center gap-2.5 px-3 py-2.5 mb-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-semibold text-[var(--ink)] cursor-pointer">
            <input
              type="checkbox"
              checked={closeDayOnPrint}
              onChange={e => setCloseDayOnPrint(e.target.checked)}
              className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
            />
            <span>End Business Day ({previewModal.summaryDate}) after printing</span>
          </label>
        )}
        <pre className="font-mono-num text-[11.5px] leading-snug bg-[var(--receipt-bg)] border border-dashed border-[var(--line)] rounded-xl p-4 whitespace-pre overflow-x-auto max-h-[55vh] text-[var(--receipt-ink)]">
          {linesToPreviewText(previewModal.lines, state.settings.paperWidth)}
        </pre>
      </Modal>

      {/* Open Business Day Modal */}
      <Modal
        open={businessDayModal === 'open'}
        title="Open Business Day"
        onClose={() => setBusinessDayModal(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setBusinessDayModal(null)}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleOpenBusinessDay(openDayDate, Number(openDayKas) || 0)}
              className="px-5 py-2 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              Start Business Day
            </button>
          </>
        }
      >
        <p className="text-xs text-[var(--muted)] mb-4 leading-relaxed">
          All orders and expenses recorded until you print the End of Day Report will be grouped under this Business Day, even past midnight.
        </p>
        <label className="block mb-3">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
            Business Date
          </span>
          <input
            type="date"
            value={openDayDate}
            onChange={e => {
              const val = e.target.value;
              setOpenDayDate(val);
              const existingKas = state.daily[val]?.kas;
              setOpenDayKas(existingKas ? String(existingKas) : '');
            }}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
            Opening Cash Float / Start Kas (Rp, optional)
          </span>
          <input
            autoFocus
            type="number"
            value={openDayKas}
            onChange={e => setOpenDayKas(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleOpenBusinessDay(openDayDate, Number(openDayKas) || 0)}
            placeholder="0"
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-base font-extrabold text-right text-[var(--ink)] tabular-nums outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        </label>
      </Modal>

      {/* Active Business Day Info Modal */}
      <Modal
        open={businessDayModal === 'info' && state.businessDay !== null}
        title="Active Business Day"
        onClose={() => setBusinessDayModal(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => void handleCloseBusinessDay()}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--danger)] hover:bg-[var(--accent-soft)] cursor-pointer"
            >
              Close Without Printing
            </button>
            <button
              type="button"
              onClick={() => {
                setBusinessDayModal(null);
                setActiveTab('summary');
              }}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              Go to Summary &amp; Print EOD
            </button>
          </>
        }
      >
        {state.businessDay && (() => {
          const activeDate = state.businessDay.date;
          const activeSales = state.sales.filter(s => s.date === activeDate);
          const metrics = computeDailyMetrics(activeDate, state.sales, state.expenses, state.daily[activeDate]);
          return (
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between py-1.5 border-b border-[var(--line-soft)]">
                <span className="text-[var(--muted)]">Business Date</span>
                <strong className="text-[var(--ink)] tabular-nums">{activeDate}</strong>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--line-soft)]">
                <span className="text-[var(--muted)]">Opened At</span>
                <span className="font-semibold text-[var(--ink)] tabular-nums">
                  {fmtDateTime(state.businessDay.openedAt, state.settings.timezone)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[var(--line-soft)]">
                <span className="text-[var(--muted)]">Orders Recorded</span>
                <span className="font-bold text-[var(--ink)] tabular-nums">{activeSales.length}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-[var(--muted)]">Shift Sales Total</span>
                <strong className="text-[var(--accent)] tabular-nums">{rp(metrics.totalSales)}</strong>
              </div>
              <p className="text-xs text-[var(--muted)] pt-2 leading-relaxed">
                Any order or expense made now (even after midnight) counts under <b>{activeDate}</b> until you print the End of Day Report.
              </p>
            </div>
          );
        })()}
      </Modal>

      {/* Offline Mode Indicator */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-[90] flex items-center gap-2 rounded-xl bg-[var(--gold)] px-3.5 py-2 text-xs font-bold text-white shadow-lg">
          <span>Offline Mode — Orders &amp; expenses are saved locally</span>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`px-5 py-3 rounded-xl text-xs font-bold shadow-xl max-w-[90vw] text-center border border-[var(--line)] ${
              t.type === 'err'
                ? 'bg-[var(--danger)] text-white'
                : 'bg-[var(--eod-bg)] text-[var(--eod-ink)]'
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
