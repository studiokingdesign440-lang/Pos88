import { DailyRecord, Expense, PrintLine, Sale, Settings } from '../types';
import { escHtml, fmt } from './format';
import { getNetSaleBreakdown } from './sheets';
import { fmtDateTime, localDate } from './time';

type BluetoothServiceUUID = number | string;

interface BluetoothRemoteGATTCharacteristic {
  properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue: (value: BufferSource) => Promise<void>;
}

interface BluetoothRemoteGATTService {
  getCharacteristics: () => Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  connect: () => Promise<BluetoothRemoteGATTServer>;
  getPrimaryServices: () => Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothDevice {
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
  addEventListener: (type: string, listener: () => void) => void;
}

interface BluetoothNavigator extends Navigator {
  bluetooth?: {
    requestDevice: (options: {
      acceptAllDevices?: boolean;
      optionalServices?: BluetoothServiceUUID[];
    }) => Promise<BluetoothDevice>;
  };
}

const PRINTER_SERVICES: BluetoothServiceUUID[] = [
  0x18f0,
  0xff00,
  0xfee7,
  0xffe0,
  0xfff0,
  0x1101,
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

export interface PrinterHandle {
  device: BluetoothDevice | null;
  char: BluetoothRemoteGATTCharacteristic | null;
  connected: boolean;
  label: string;
}

export const printerState: PrinterHandle = {
  device: null,
  char: null,
  connected: false,
  label: 'Printer',
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function connectBluetoothPrinter(): Promise<{ ok: boolean; label: string; error?: string }> {
  const nav = navigator as BluetoothNavigator;
  if (!nav.bluetooth) {
    return { ok: false, label: 'Printer', error: 'Bluetooth is not supported in this browser' };
  }
  try {
    const device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICES,
    });
    const server = await device.gatt?.connect();
    if (!server) {
      return { ok: false, label: 'Printer', error: 'Failed to connect GATT server' };
    }
    const services = await server.getPrimaryServices();
    let writableChar: BluetoothRemoteGATTCharacteristic | null = null;
    for (const svc of services) {
      let chars: BluetoothRemoteGATTCharacteristic[] = [];
      try {
        chars = await svc.getCharacteristics();
      } catch {
        continue;
      }
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          writableChar = c;
          break;
        }
      }
      if (writableChar) break;
    }

    if (!writableChar) {
      return { ok: false, label: 'Printer', error: 'No writable Bluetooth characteristic found' };
    }

    printerState.device = device;
    printerState.char = writableChar;
    printerState.connected = true;
    printerState.label = device.name || 'Printer OK';

    device.addEventListener('gattserverdisconnected', () => {
      printerState.connected = false;
      printerState.char = null;
      printerState.label = 'Printer';
    });

    return { ok: true, label: printerState.label };
  } catch (err) {
    return { ok: false, label: 'Printer', error: err instanceof Error ? err.message : 'Connection cancelled' };
  }
}

export function buildEscPos(lines: PrintLine[], st: Settings): Uint8Array {
  const width = Number(st.paperWidth) === 80 ? 48 : 32;
  const out: number[] = [];
  const push = (...bytes: number[]) => out.push(...bytes);
  const enc = (str: string) => {
    const arr: number[] = [];
    for (const ch of String(str)) {
      const code = ch.codePointAt(0) ?? 63;
      arr.push(code < 128 ? code : 63);
    }
    return arr;
  };

  push(0x1b, 0x40);
  for (const l of lines) {
    if (l.divider) {
      push(0x1b, 0x61, 0x00, ...enc('-'.repeat(width)), 0x0a);
      continue;
    }
    push(0x1b, 0x61, l.align === 'center' ? 1 : l.align === 'right' ? 2 : 0);
    if (l.size === 3) {
      push(0x1b, 0x21, 0x38, 0x1d, 0x21, 0x22, 0x1b, 0x45, 1, 0x1b, 0x47, 1);
    } else if (l.bold) {
      push(0x1b, 0x21, 0x00, 0x1d, 0x21, 0x00, 0x1b, 0x45, 1, 0x1b, 0x47, 0);
    } else {
      push(0x1b, 0x21, 0x00, 0x1d, 0x21, 0x00, 0x1b, 0x45, 0, 0x1b, 0x47, 0);
    }
    push(...enc(l.t || ''), 0x0a);
    push(0x1b, 0x21, 0x00, 0x1d, 0x21, 0x00, 0x1b, 0x45, 0, 0x1b, 0x47, 0);
  }
  push(0x1b, 0x61, 0x00, 0x0a, 0x0a, 0x0a);
  if (st.cutPaper !== false) {
    push(0x1d, 0x56, 0x42, 0x00);
  }
  return new Uint8Array(out);
}

export async function sendToPrinter(bytes: Uint8Array): Promise<void> {
  if (!printerState.char) throw new Error('Printer not connected');
  for (let i = 0; i < bytes.length; i += 100) {
    await printerState.char.writeValue(bytes.slice(i, i + 100));
    await sleep(14);
  }
}

export function buildReceipt(sale: Sale, st: Settings): PrintLine[] {
  const width = Number(st.paperWidth) === 80 ? 48 : 32;
  const lines: PrintLine[] = [];
  const add = (t = '', opts: Omit<PrintLine, 't'> = {}) => lines.push({ t, ...opts });
  const center = (t: string, opts: Omit<PrintLine, 't' | 'align'> = {}) => add(t, { align: 'center', ...opts });
  const hr = () => lines.push({ divider: true });
  const col2 = (l: string, r: string) => {
    const left = String(l);
    const right = String(r);
    const sp = width - left.length - right.length;
    return sp >= 1 ? left + ' '.repeat(sp) + right : left.slice(0, Math.max(0, width - right.length - 1)) + ' ' + right;
  };

  center(st.storeName, { size: 3, bold: true });
  if (st.tagline) center(st.tagline);
  if (st.address) center(st.address);
  if (st.phone) center('Tel: ' + st.phone);
  hr();
  add(col2(fmtDateTime(sale.ts, st.timezone), '#' + sale.orderNo));
  add('Name: ' + sale.orderName);
  add('Cashier: ' + sale.cashier);
  hr();
  sale.items.forEach(it => {
    add(it.name);
    if (it.note) add('  * ' + it.note, { bold: true });
    add(col2('  ' + it.qty + ' x ' + fmt(it.price), fmt(it.price * it.qty)));
  });
  hr();
  add(col2('Subtotal', fmt(sale.subtotal)));
  if (sale.tax > 0) add(col2('Tax', fmt(sale.tax)));
  if (sale.service > 0) add(col2('Service', fmt(sale.service)));
  add(col2('TOTAL', 'Rp ' + fmt(sale.total)), { bold: true });
  hr();
  (sale.payments || []).forEach(p => add(col2('Paid (' + p.method + ')', fmt(p.amount))));
  add(col2('Change', fmt(sale.change)));
  hr();
  if (sale.thanks) center(sale.thanks, { bold: true });
  if (sale.quote) center(sale.quote);
  if (st.footerText) center(st.footerText);
  add('');
  return lines;
}

export function buildSummaryReceipt(
  st: Settings,
  salesList: Sale[],
  expensesList: Expense[],
  dailyMap: Record<string, DailyRecord>,
  targetDate?: string
): PrintLine[] {
  const width = Number(st.paperWidth) === 80 ? 48 : 32;
  const lines: PrintLine[] = [];
  const add = (t = '', opts: Omit<PrintLine, 't'> = {}) => lines.push({ t, ...opts });
  const center = (t: string, opts: Omit<PrintLine, 't' | 'align'> = {}) => add(t, { align: 'center', ...opts });
  const hr = () => lines.push({ divider: true });
  const col2 = (l: string, r: string) => {
    const left = String(l);
    const right = String(r);
    const sp = width - left.length - right.length;
    return sp >= 1 ? left + ' '.repeat(sp) + right : left.slice(0, Math.max(0, width - right.length - 1)) + ' ' + right;
  };

  const today = targetDate || localDate(new Date(), st.timezone);
  const dayData = dailyMap[today] || { kas: 0, actualCash: 0, expectedCash: 0 };
  const sales = salesList.filter(s => s.date === today);
  const exps = expensesList.filter(e => e.date === today);

  let cashSales = 0;
  let qrisSales = 0;
  sales.forEach(s => {
    const breakdown = getNetSaleBreakdown(s);
    cashSales += breakdown.cash;
    qrisSales += breakdown.qris;
  });

  let cashExp = 0;
  let creditExp = 0;
  exps.forEach(e => {
    if (e.type === 'Cash') cashExp += Number(e.amount) || 0;
    else creditExp += Number(e.amount) || 0;
  });

  const expectedCash = (Number(dayData.kas) || 0) + cashSales - cashExp;

  center('END OF DAY REPORT', { size: 2, bold: true });
  center(today + ' · ' + fmtDateTime(new Date(), st.timezone));
  hr();

  add('SALES', { bold: true });
  add(col2('Cash Sales', fmt(cashSales)));
  add(col2('QRIS/Transfer', fmt(qrisSales)));
  add(col2('Total Sales', fmt(cashSales + qrisSales)), { bold: true });
  hr();

  if (exps.length) {
    add('EXPENSES', { bold: true });
    const cashExps = exps.filter(e => e.type === 'Cash');
    const credExps = exps.filter(e => e.type === 'Credit');
    if (cashExps.length) {
      add('-- PAID CASH --', { align: 'center' });
      cashExps.forEach(e => add(col2(' ' + e.name, fmt(e.amount))));
      add(col2('Total Cash Exp', fmt(cashExp)), { bold: true });
    }
    if (credExps.length) {
      add('-- CREDIT / PAY LATER --', { align: 'center' });
      credExps.forEach(e => add(col2(' ' + e.name, fmt(e.amount))));
      add(col2('Total Credit Exp', fmt(creditExp)), { bold: true });
    }
    hr();
  }

  add(col2('Start Kas', fmt(dayData.kas)));
  add(col2('Net Profit', 'Rp ' + fmt(cashSales + qrisSales - cashExp - creditExp)), { bold: true });
  hr();

  add(col2('EXPECTED CASH', 'Rp ' + fmt(expectedCash)), { bold: true, size: 2 });
  if (dayData.actualCash > 0) {
    add(col2('ACTUAL CASH', 'Rp ' + fmt(dayData.actualCash)));
    add(col2('VARIANCE', 'Rp ' + fmt(dayData.actualCash - expectedCash)));
  }
  center('(Kas + Cash Sales - Cash Exp)');
  hr();

  center('M9M VERIFICATION', { bold: true });
  add('');
  center('Signature: _______________');
  add('');
  center('Thank you for your hard work!');
  return lines;
}

export function linesToPreviewText(lines: PrintLine[], paperWidth: 58 | 80): string {
  const width = Number(paperWidth) === 80 ? 48 : 32;
  return lines
    .map(l => {
      if (l.divider) return '-'.repeat(width);
      const txt = l.t || '';
      if (l.align === 'center' && txt.length < width) {
        const pad = Math.floor((width - txt.length) / 2);
        return ' '.repeat(pad) + txt;
      }
      return txt;
    })
    .join('\n');
}

export function printViaBrowser(lines: PrintLine[], paperWidth: 58 | 80): void {
  const w = Number(paperWidth) === 80 ? '80mm' : '58mm';
  const body = lines
    .map(l =>
      l.divider
        ? '<div class="hr"></div>'
        : `<div class="${l.align || ''} ${l.bold ? 'b' : ''} ${l.size === 3 ? 'huge' : l.size === 2 ? 'big' : ''}">${escHtml(l.t) || '&nbsp;'}</div>`
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w} auto;margin:0}body{width:${w};margin:0;padding:4px 6px;font-family:"Courier New",monospace;font-size:11px;line-height:1.35;color:#000}.center{text-align:center}.right{text-align:right}.b{font-weight:700}.big{font-size:15px;font-weight:700;letter-spacing:.5px}.huge{font-size:18px;font-weight:800;letter-spacing:1px;margin:4px 0}.hr{border-top:1px dashed #000;margin:3px 0}div{white-space:pre-wrap;word-break:break-word}</style></head><body>${body}</body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  frame.contentDocument?.open();
  frame.contentDocument?.write(html);
  frame.contentDocument?.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 4000);
  }, 250);
}
