import React, { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import {
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
import { pickRandom, uid } from './utils/format';
import { fmtTime, getEffectiveTimezone, localDate, normalizeDateFromSheet } from './utils/time';
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
  }>({ open: false, title: '', lines: [] });

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

  const handleCompleteSale = async (payments: PaymentSplit[]) => {
    const order = state.orders.find(o => o.id === currentOrderId);
    if (!order) return;

    const totals = computeOrderTotals(order.items, state.settings);
    const nowMs = Date.now();
    const saleDate = localDate(nowMs, state.settings.timezone);
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
    }));
    setCurrentOrderId(nextOrders[0]?.id || null);

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
      date
    );
    setPreviewModal({
      open: true,
      title: `Preview: End of Day Report (${date})`,
      subtitle: 'Tip: If you spot a mistake, close this window, edit your Expenses or Kas, and print again.',
      lines,
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
      const sep = state.settings.gasUrl.includes('?') ? '&' : '?';
      const url = `${state.settings.gasUrl.trim()}${sep}action=ping&tz=${encodeURIComponent(tz)}&_=${Date.now()}`;
      const res = await fetch(url, { method: 'GET', redirect: 'follow' });
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Web App returned HTML — deploy with "Who has access: Anyone".');
      }
      const data = JSON.parse(text) as {
        ok?: boolean;
        timezone?: string;
        spreadsheetTimezone?: string;
      };
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
      const msg = err instanceof Error ? err.message : 'Connection test failed';
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
          <div className="w-9 h-9 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] flex items-center justify-center font-display font-bold text-base shadow-sm">
            88
          </div>
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

        {/* Zone 3: Primary action (Printer) */}
        <div className="shrink-0">
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
            syncing={syncing}
            onSaveDaily={handleSaveDaily}
            onPrintSummary={handlePrintSummary}
            onPushAll={handlePushAll}
          />
        )}

        {activeTab === 'expenses' && (
          <ExpensesView
            expenses={state.expenses}
            settings={state.settings}
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
                setPreviewModal(prev => ({ ...prev, open: false }));
                printViaBrowser(lines, state.settings.paperWidth);
              }}
              className="px-4 py-2 rounded-xl text-sm font-bold border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--bg)] cursor-pointer"
            >
              Browser Print
            </button>
            <button
              type="button"
              onClick={async () => {
                const lines = previewModal.lines;
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
        <pre className="font-mono-num text-[11.5px] leading-snug bg-[var(--receipt-bg)] border border-dashed border-[var(--line)] rounded-xl p-4 whitespace-pre overflow-x-auto max-h-[55vh] text-[var(--receipt-ink)]">
          {linesToPreviewText(previewModal.lines, state.settings.paperWidth)}
        </pre>
      </Modal>

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
