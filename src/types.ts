export type ViewTab = 'pos' | 'summary' | 'expenses' | 'products' | 'sales' | 'settings';

export interface Product {
  id: string;
  main: string;
  name: string;
  price: number;
  desc?: string;
  active?: boolean;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  note?: string;
}

export interface Order {
  id: string;
  name: string;
  items: OrderItem[];
  createdAt: number;
}

export interface PaymentSplit {
  method: 'Cash' | 'QRIS' | 'Transfer';
  amount: number;
}

export interface Sale {
  id: string;
  ts: number;
  date: string;
  orderNo: string;
  orderName: string;
  cashier: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  service: number;
  total: number;
  payments: PaymentSplit[];
  change: number;
  thanks?: string;
  quote?: string;
}

export interface Expense {
  id: string;
  date: string;
  name: string;
  amount: number;
  type: 'Cash' | 'Credit';
  ts?: number;
  updatedAt?: string;
}

export interface DailyRecord {
  kas: number;
  actualCash: number;
  expectedCash: number;
  totalSales?: number;
  cashSales?: number;
  qrisSales?: number;
  totalExpenses?: number;
  cashExpenses?: number;
  creditExpenses?: number;
  netProfit?: number;
  updatedAt?: string;
}

export type ThemeId = 'original' | 'hacker' | 'retro' | 'terminal';

export interface Settings {
  storeName: string;
  tagline: string;
  address: string;
  phone: string;
  footerText: string;
  cashierNames: string[];
  thanks: string[];
  quotes: string[];
  taxPercent: number;
  servicePercent: number;
  paperWidth: 58 | 80;
  printMethod: 'bluetooth' | 'browser';
  cutPaper: boolean;
  gasUrl: string;
  lastCashier: string;
  timezone: string;
  theme: ThemeId;
}

export interface PendingDeletes {
  expenses: string[];
  sales: string[];
}

export interface SyncMeta {
  lastSyncedAt: string | null;
  lastAction: string | null;
  lastError: string | null;
  pendingCount: number;
}

export interface BusinessDaySession {
  id: string;
  date: string;
  openedAt: number;
}

export interface PosState {
  products: Product[];
  sales: Sale[];
  orders: Order[];
  expenses: Expense[];
  daily: Record<string, DailyRecord>;
  settings: Settings;
  pendingDeletes: PendingDeletes;
  businessDay: BusinessDaySession | null;
}

export interface PrintLine {
  t?: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  size?: 1 | 2 | 3;
  divider?: boolean;
}

export interface OrderTotals {
  subtotal: number;
  tax: number;
  svc: number;
  total: number;
}

export interface ToastItem {
  id: string;
  msg: string;
  type?: 'ok' | 'err';
}
