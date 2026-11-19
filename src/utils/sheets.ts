import { DailyRecord, Expense, PendingDeletes, Product, Sale, Settings } from '../types';
import { getEffectiveTimezone, normalizeDateFromSheet } from './time';
import { uid } from './format';

export interface DailyMetrics {
  date: string;
  kas: number;
  actualCash: number;
  expectedCash: number;
  totalSales: number;
  cashSales: number;
  qrisSales: number;
  totalExpenses: number;
  cashExpenses: number;
  creditExpenses: number;
  netProfit: number;
  updatedAt: string;
}

export function computeDailyMetrics(
  date: string,
  salesList: Sale[],
  expensesList: Expense[],
  existing?: DailyRecord
): DailyMetrics {
  const kas = Number(existing?.kas) || 0;
  const actualCash = Number(existing?.actualCash) || 0;

  let cashSales = 0;
  let qrisSales = 0;
  salesList
    .filter(s => s.date === date)
    .forEach(s => {
      (s.payments || []).forEach(p => {
        if (p.method === 'Cash') cashSales += Number(p.amount) || 0;
        else qrisSales += Number(p.amount) || 0;
      });
    });
  const totalSales = cashSales + qrisSales;

  let cashExpenses = 0;
  let creditExpenses = 0;
  expensesList
    .filter(e => e.date === date)
    .forEach(e => {
      if (e.type === 'Cash') cashExpenses += Number(e.amount) || 0;
      else creditExpenses += Number(e.amount) || 0;
    });
  const totalExpenses = cashExpenses + creditExpenses;

  const netProfit = totalSales - totalExpenses;
  const expectedCash = kas + cashSales - cashExpenses;

  return {
    date,
    kas,
    actualCash,
    expectedCash,
    totalSales,
    cashSales,
    qrisSales,
    totalExpenses,
    cashExpenses,
    creditExpenses,
    netProfit,
    updatedAt: new Date().toISOString(),
  };
}

async function parseGasResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) {
    throw new Error(
      'Apps Script returned an HTML page instead of JSON. Deploy the Web App as "Execute as: Me" and "Who has access: Anyone".'
    );
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(trimmed || '{}') as Record<string, unknown>;
  } catch {
    throw new Error('Invalid JSON response from Google Apps Script.');
  }
  if (json.ok === false || json.error) {
    throw new Error(String(json.error || 'Apps Script returned an error.'));
  }
  return json;
}

export async function gasCall(
  gasUrl: string,
  action: string,
  payload: unknown,
  timezoneSetting?: string
): Promise<Record<string, unknown>> {
  if (!gasUrl || !gasUrl.trim()) {
    throw new Error('Apps Script Web App URL is not configured.');
  }
  const tz = getEffectiveTimezone(timezoneSetting);
  const res = await fetch(gasUrl.trim(), {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify({ action, timezone: tz, payload }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from Google Apps Script.`);
  }
  return parseGasResponse(res);
}

export interface PullAllResult {
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  daily: Record<string, DailyRecord>;
  settings?: Partial<Settings>;
  timezone?: string;
  spreadsheetTimezone?: string;
}

export async function pullAllFromSheets(
  gasUrl: string,
  timezoneSetting?: string
): Promise<PullAllResult> {
  if (!gasUrl || !gasUrl.trim()) {
    throw new Error('Apps Script Web App URL is not configured.');
  }
  const tz = getEffectiveTimezone(timezoneSetting);
  const sep = gasUrl.includes('?') ? '&' : '?';
  const url = `${gasUrl.trim()}${sep}action=all&tz=${encodeURIComponent(tz)}&_=${Date.now()}`;
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from Google Apps Script.`);
  }
  const raw = await parseGasResponse(res);

  const products: Product[] = Array.isArray(raw.products)
    ? raw.products.map((p: Record<string, unknown>) => ({
        id: String(p.id || uid()),
        main: String(p.main || 'Other'),
        name: String(p.name || ''),
        price: Number(p.price) || 0,
        desc: p.desc ? String(p.desc) : '',
        active: p.active === undefined || p.active === '' ? true : Boolean(p.active && p.active !== 'false'),
      }))
    : [];

  const sales: Sale[] = Array.isArray(raw.sales)
    ? raw.sales.map((s: Record<string, unknown>) => {
        const tsNum = Number(s.ts) || Date.now();
        const normalizedDate =
          normalizeDateFromSheet(s.date, tz) || normalizeDateFromSheet(new Date(tsNum).toISOString(), tz);
        return {
          id: String(s.id || uid()),
          ts: tsNum,
          date: normalizedDate,
          orderNo: String(s.orderNo || '0000'),
          orderName: String(s.orderName || 'Order'),
          cashier: String(s.cashier || ''),
          items: Array.isArray(s.items) ? s.items : [],
          subtotal: Number(s.subtotal) || 0,
          tax: Number(s.tax) || 0,
          service: Number(s.service) || 0,
          total: Number(s.total) || 0,
          payments: Array.isArray(s.payments) ? s.payments : [],
          change: Number(s.change) || 0,
          thanks: s.thanks ? String(s.thanks) : '',
          quote: s.quote ? String(s.quote) : '',
        };
      })
    : [];

  const expenses: Expense[] = Array.isArray(raw.expenses)
    ? raw.expenses.map((e: Record<string, unknown>) => ({
        id: String(e.id || uid()),
        date: normalizeDateFromSheet(e.date, tz),
        name: String(e.name || ''),
        amount: Number(e.amount) || 0,
        type: e.type === 'Credit' ? 'Credit' : 'Cash',
        ts: e.ts ? Number(e.ts) : undefined,
        updatedAt: e.updatedAt ? String(e.updatedAt) : undefined,
      }))
    : [];

  const daily: Record<string, DailyRecord> = {};
  if (raw.daily && typeof raw.daily === 'object' && !Array.isArray(raw.daily)) {
    Object.entries(raw.daily as Record<string, Record<string, unknown>>).forEach(([rawKey, val]) => {
      const normalizedKey = normalizeDateFromSheet(rawKey, tz);
      if (!normalizedKey || !val) return;
      daily[normalizedKey] = {
        kas: Number(val.kas) || 0,
        actualCash: Number(val.actualCash) || 0,
        expectedCash: Number(val.expectedCash) || 0,
        totalSales: val.totalSales !== undefined ? Number(val.totalSales) || 0 : undefined,
        cashSales: val.cashSales !== undefined ? Number(val.cashSales) || 0 : undefined,
        qrisSales: val.qrisSales !== undefined ? Number(val.qrisSales) || 0 : undefined,
        totalExpenses: val.totalExpenses !== undefined ? Number(val.totalExpenses) || 0 : undefined,
        cashExpenses: val.cashExpenses !== undefined ? Number(val.cashExpenses) || 0 : undefined,
        creditExpenses: val.creditExpenses !== undefined ? Number(val.creditExpenses) || 0 : undefined,
        netProfit: val.netProfit !== undefined ? Number(val.netProfit) || 0 : undefined,
        updatedAt: val.updatedAt ? String(val.updatedAt) : undefined,
      };
    });
  }

  let settings: Partial<Settings> | undefined;
  if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
    const rs = raw.settings as Record<string, unknown>;
    settings = {};
    if (typeof rs.storeName === 'string') settings.storeName = rs.storeName;
    if (typeof rs.tagline === 'string') settings.tagline = rs.tagline;
    if (typeof rs.address === 'string') settings.address = rs.address;
    if (typeof rs.phone === 'string') settings.phone = rs.phone;
    if (typeof rs.footerText === 'string') settings.footerText = rs.footerText;
    if (Array.isArray(rs.cashierNames)) settings.cashierNames = rs.cashierNames.map(String);
    if (Array.isArray(rs.thanks)) settings.thanks = rs.thanks.map(String);
    if (Array.isArray(rs.quotes)) settings.quotes = rs.quotes.map(String);
    if (rs.taxPercent !== undefined) settings.taxPercent = Number(rs.taxPercent) || 0;
    if (rs.servicePercent !== undefined) settings.servicePercent = Number(rs.servicePercent) || 0;
    if (rs.paperWidth !== undefined) settings.paperWidth = Number(rs.paperWidth) === 80 ? 80 : 58;
    if (rs.printMethod === 'bluetooth' || rs.printMethod === 'browser') settings.printMethod = rs.printMethod;
    if (rs.cutPaper !== undefined) settings.cutPaper = Boolean(rs.cutPaper);
    if (typeof rs.timezone === 'string' && rs.timezone) settings.timezone = rs.timezone;
    if (rs.theme === 'original' || rs.theme === 'hacker' || rs.theme === 'retro' || rs.theme === 'terminal') {
      settings.theme = rs.theme;
    }
  }

  return {
    products,
    sales,
    expenses,
    daily,
    settings,
    timezone: raw.timezone ? String(raw.timezone) : undefined,
    spreadsheetTimezone: raw.spreadsheetTimezone ? String(raw.spreadsheetTimezone) : undefined,
  };
}

export function sanitizeSettingsForPush(settings: Settings): Omit<Settings, 'gasUrl'> {
  const { gasUrl: _ignored, ...rest } = settings;
  return rest;
}

export async function pushAllToSheets(
  gasUrl: string,
  data: {
    products: Product[];
    sales: Sale[];
    expenses: Expense[];
    daily: Record<string, DailyRecord>;
    settings: Settings;
    pendingDeletes: PendingDeletes;
  },
  timezoneSetting?: string
): Promise<{ counts: { products: number; sales: number; expenses: number; daily: number; settings?: number } }> {
  const allDates = new Set<string>([
    ...Object.keys(data.daily),
    ...data.sales.map(s => s.date).filter(Boolean),
    ...data.expenses.map(e => e.date).filter(Boolean),
  ]);

  const enrichedDaily: Record<string, DailyMetrics> = {};
  allDates.forEach(dateKey => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    enrichedDaily[dateKey] = computeDailyMetrics(dateKey, data.sales, data.expenses, data.daily[dateKey]);
  });

  const cleanSettings = sanitizeSettingsForPush(data.settings);

  const res = await gasCall(
    gasUrl,
    'pushAll',
    {
      products: data.products,
      sales: data.sales,
      expenses: data.expenses,
      daily: enrichedDaily,
      settings: cleanSettings,
      deletedExpenseIds: data.pendingDeletes.expenses,
      deletedSaleIds: data.pendingDeletes.sales,
    },
    timezoneSetting
  );

  const counts = (res.counts as {
    products: number;
    sales: number;
    expenses: number;
    daily: number;
    settings?: number;
  }) || {
    products: data.products.length,
    sales: data.sales.length,
    expenses: data.expenses.length,
    daily: Object.keys(enrichedDaily).length,
    settings: Object.keys(cleanSettings).length,
  };

  return { counts };
}
