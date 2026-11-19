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

export function getNetSaleBreakdown(sale: Sale): { cash: number; qris: number; total: number } {
  const saleTotal = Number(sale.total) || 0;
  const payments = sale.payments || [];
  if (!payments.length) {
    return { cash: saleTotal, qris: 0, total: saleTotal };
  }

  let rawCash = 0;
  let rawQris = 0;
  payments.forEach(p => {
    const amt = Number(p.amount) || 0;
    if (p.method === 'Cash') rawCash += amt;
    else rawQris += amt;
  });

  const rawPaid = rawCash + rawQris;
  const change = Math.max(0, Number(sale.change) || 0, rawPaid - saleTotal);

  const cashDeduction = Math.min(rawCash, change);
  const netCash = Math.max(0, rawCash - cashDeduction);
  const remainingChange = Math.max(0, change - cashDeduction);
  const netQris = Math.max(0, rawQris - remainingChange);

  return {
    cash: netCash,
    qris: netQris,
    total: netCash + netQris,
  };
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
      const breakdown = getNetSaleBreakdown(s);
      cashSales += breakdown.cash;
      qrisSales += breakdown.qris;
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

export function validateGasUrl(rawUrl: string): string {
  const url = (rawUrl || '').trim();
  if (!url) {
    throw new Error('Apps Script Web App URL is not configured.');
  }
  if (url.includes('docs.google.com/spreadsheets')) {
    throw new Error(
      'You pasted the Google Sheet URL. Open Extensions > Apps Script > Deploy and paste the Web App URL ending in /exec.'
    );
  }
  if (/\/dev(\?|$)/.test(url)) {
    throw new Error(
      'You pasted a /dev test URL. Deploy as a Web App and paste the production URL ending in /exec.'
    );
  }
  if (!url.startsWith('https://script.google.com/')) {
    throw new Error('Apps Script URL must start with https://script.google.com/macros/s/.../exec');
  }
  return url;
}

function formatFetchError(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error(
      'Blocked by CORS or network error. In Google Apps Script, deploy a New version with "Execute as: Me" and "Who has access: Anyone" (not "Only myself" or "Anyone with Google account"), and authorize permissions when prompted.'
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function gasCall(
  gasUrl: string,
  action: string,
  payload: unknown,
  timezoneSetting?: string
): Promise<Record<string, unknown>> {
  const url = validateGasUrl(gasUrl);
  const tz = getEffectiveTimezone(timezoneSetting);
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify({ action, timezone: tz, payload }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from Google Apps Script.`);
    }
    return parseGasResponse(res);
  } catch (err) {
    throw formatFetchError(err);
  }
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
  const baseUrl = validateGasUrl(gasUrl);
  const tz = getEffectiveTimezone(timezoneSetting);
  const sep = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${sep}action=all&tz=${encodeURIComponent(tz)}&_=${Date.now()}`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', redirect: 'follow' });
  } catch (err) {
    throw formatFetchError(err);
  }
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
