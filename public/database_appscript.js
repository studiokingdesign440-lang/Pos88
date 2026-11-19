const PRODUCTS_SHEET = 'Products';
const SALES_SHEET = 'Sales';
const EXPENSES_SHEET = 'Expenses';
const DAILY_SHEET = 'DailyRecords';
const SETTINGS_SHEET = 'Settings';
const DEFAULT_TIMEZONE = 'Asia/Jakarta';

const PRODUCT_HEADERS = ['id', 'main', 'name', 'price', 'desc', 'active'];
const SALE_HEADERS = ['id', 'ts', 'date', 'orderNo', 'orderName', 'cashier', 'items', 'subtotal', 'tax', 'service', 'total', 'payments', 'change', 'thanks', 'quote'];
const EXPENSE_HEADERS = ['id', 'date', 'name', 'amount', 'type', 'ts', 'updatedAt'];
const DAILY_HEADERS = ['date', 'kas', 'actualCash', 'expectedCash', 'totalSales', 'cashSales', 'qrisSales', 'totalExpenses', 'cashExpenses', 'creditExpenses', 'netProfit', 'updatedAt'];
const SETTING_HEADERS = ['key', 'value', 'updatedAt'];

function getTz(ss, requestedTz) {
  if (requestedTz && typeof requestedTz === 'string' && requestedTz !== 'local') {
    return requestedTz;
  }
  return (ss && ss.getSpreadsheetTimeZone()) || DEFAULT_TIMEZONE;
}

function safeFormatDate(dateObj, tz, pattern) {
  try {
    return Utilities.formatDate(dateObj, tz || DEFAULT_TIMEZONE, pattern);
  } catch (e) {
    try {
      return Utilities.formatDate(dateObj, DEFAULT_TIMEZONE, pattern);
    } catch (e2) {
      return Utilities.formatDate(dateObj, 'UTC', pattern);
    }
  }
}

function normalizeDateStr(val, tz) {
  if (val === null || val === undefined || val === '') return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return safeFormatDate(val, tz, 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return safeFormatDate(d, tz, 'yyyy-MM-dd');
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return safeFormatDate(parsed, tz, 'yyyy-MM-dd');
  }
  return s;
}

function formatCellValue(header, rawVal, tz) {
  if (header === 'items' || header === 'payments') {
    return JSON.stringify(rawVal || []);
  }
  if (header === 'date') {
    return normalizeDateStr(rawVal, tz);
  }
  return rawVal === undefined || rawVal === null ? '' : rawVal;
}

function ensureSheetHeaders(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const existingLen = Math.max(sheet.getLastColumn(), headers.length);
    const existingHeaders = sheet.getRange(1, 1, 1, existingLen).getValues()[0];
    let changed = false;
    headers.forEach((h, idx) => {
      if (existingHeaders[idx] !== h) {
        existingHeaders[idx] = h;
        changed = true;
      }
    });
    if (changed) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function writeRowValues(sheet, rowIndex, headers, rowValues) {
  const dateCol = headers.indexOf('date');
  if (dateCol !== -1) {
    sheet.getRange(rowIndex, dateCol + 1, 1, 1).setNumberFormat('@');
  }
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([rowValues]);
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || '';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return jsonResponse({ ok: false, error: 'Apps Script must be opened from Google Sheets (Extensions > Apps Script).' });
    }
    const tz = getTz(ss, params.tz);

    if (action === 'all') {
      return jsonResponse({
        ok: true,
        timezone: tz,
        spreadsheetTimezone: ss.getSpreadsheetTimeZone(),
        products: getSheetData(ss, PRODUCTS_SHEET, tz),
        sales: getSheetData(ss, SALES_SHEET, tz),
        expenses: getSheetData(ss, EXPENSES_SHEET, tz),
        daily: getDailyData(ss, tz),
        settings: getSettingsData(ss)
      });
    }

    return jsonResponse({
      ok: true,
      timezone: tz,
      spreadsheetTimezone: ss.getSpreadsheetTimeZone(),
      serverTime: safeFormatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX")
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return jsonResponse({ ok: false, error: 'Apps Script must be opened from Google Sheets (Extensions > Apps Script).' });
    }
    const tz = getTz(ss, data.timezone);
    const action = data.action;
    const payload = data.payload;

    if (action === 'saveProducts') {
      saveAll(ss, PRODUCTS_SHEET, payload, PRODUCT_HEADERS, tz);
      return jsonResponse({ ok: true, timezone: tz, count: (payload || []).length });
    }

    if (action === 'saveSettings') {
      const count = saveSettingsData(ss, payload);
      return jsonResponse({ ok: true, timezone: tz, count: count });
    }

    if (action === 'addSale' || action === 'upsertSale') {
      upsertRowByKey(ss, SALES_SHEET, payload, SALE_HEADERS, 'id', tz);
      return jsonResponse({ ok: true, timezone: tz });
    }

    if (action === 'deleteSale') {
      const id = payload && payload.id ? payload.id : payload;
      const deleted = deleteRowByKey(ss, SALES_SHEET, 'id', id, tz);
      return jsonResponse({ ok: true, deleted: deleted, timezone: tz });
    }

    if (action === 'addExpense' || action === 'upsertExpense') {
      upsertRowByKey(ss, EXPENSES_SHEET, payload, EXPENSE_HEADERS, 'id', tz);
      return jsonResponse({ ok: true, timezone: tz });
    }

    if (action === 'deleteExpense') {
      const id = payload && payload.id ? payload.id : payload;
      const deleted = deleteRowByKey(ss, EXPENSES_SHEET, 'id', id, tz);
      return jsonResponse({ ok: true, deleted: deleted, timezone: tz });
    }

    if (action === 'saveDaily') {
      upsertRowByKey(ss, DAILY_SHEET, payload, DAILY_HEADERS, 'date', tz);
      return jsonResponse({ ok: true, timezone: tz, date: normalizeDateStr(payload && payload.date, tz) });
    }

    if (action === 'pushAll') {
      const counts = pushAllData(ss, payload || {}, tz);
      return jsonResponse({ ok: true, timezone: tz, counts: counts });
    }

    return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheetData(ss, sheetName, tz) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        if (!h) return;
        let val = row[i];
        if (h === 'items' || h === 'payments') {
          if (typeof val === 'string') {
            try { val = JSON.parse(val || '[]'); } catch (e) { val = []; }
          } else if (!Array.isArray(val)) {
            val = [];
          }
        } else if (h === 'date') {
          val = normalizeDateStr(val, tz);
        } else if (h === 'ts' || h === 'price' || h === 'amount' || h === 'subtotal' || h === 'tax' || h === 'service' || h === 'total' || h === 'change') {
          val = val === '' ? 0 : Number(val) || 0;
        } else if (h === 'active') {
          val = val === '' ? true : (val === true || val === 'true' || val === 'TRUE' || val === 1);
        }
        obj[h] = val;
      });
      return obj;
    });
}

function getDailyData(ss, tz) {
  const sheet = ss.getSheetByName(DAILY_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return {};
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const obj = {};
  data.slice(1).forEach(row => {
    const dateKey = normalizeDateStr(row[0], tz);
    if (!dateKey) return;
    const record = {};
    headers.forEach((h, i) => {
      if (!h || h === 'date') return;
      const val = row[i];
      if (h === 'updatedAt') {
        record[h] = val ? String(val) : '';
      } else {
        record[h] = Number(val) || 0;
      }
    });
    obj[dateKey] = {
      kas: record.kas !== undefined ? record.kas : (Number(row[1]) || 0),
      actualCash: record.actualCash !== undefined ? record.actualCash : (Number(row[2]) || 0),
      expectedCash: record.expectedCash !== undefined ? record.expectedCash : (Number(row[3]) || 0),
      totalSales: record.totalSales || 0,
      cashSales: record.cashSales || 0,
      qrisSales: record.qrisSales || 0,
      totalExpenses: record.totalExpenses || 0,
      cashExpenses: record.cashExpenses || 0,
      creditExpenses: record.creditExpenses || 0,
      netProfit: record.netProfit || 0,
      updatedAt: record.updatedAt || ''
    };
  });
  return obj;
}

function getSettingsData(ss) {
  const sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return null;
  const data = sheet.getDataRange().getValues();
  const out = {};
  data.slice(1).forEach(row => {
    const key = String(row[0] || '').trim();
    if (!key) return;
    const raw = row[1];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          out[key] = JSON.parse(trimmed);
          return;
        } catch (e) {}
      }
      if (trimmed === 'true') { out[key] = true; return; }
      if (trimmed === 'false') { out[key] = false; return; }
    }
    out[key] = raw;
  });
  return out;
}

function saveSettingsData(ss, settingsObj) {
  if (!settingsObj || typeof settingsObj !== 'object') return 0;
  const sheet = ensureSheetHeaders(ss, SETTINGS_SHEET, SETTING_HEADERS);
  const nowStr = new Date().toISOString();
  const keys = Object.keys(settingsObj).filter(k => k !== 'gasUrl');
  const rows = keys.map(k => {
    const val = settingsObj[k];
    const serialized = (Array.isArray(val) || (typeof val === 'object' && val !== null))
      ? JSON.stringify(val)
      : (val === undefined || val === null ? '' : val);
    return [k, serialized, nowStr];
  });
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), SETTING_HEADERS.length)).clearContent();
  }
  if (rows.length) {
    sheet.getRange(2, 2, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 1, rows.length, SETTING_HEADERS.length).setValues(rows);
  }
  return rows.length;
}

function saveAll(ss, sheetName, arr, headers, tz) {
  const sheet = ensureSheetHeaders(ss, sheetName, headers);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), headers.length)).clearContent();
  }
  if (arr && arr.length) {
    const rows = arr.map(o => headers.map(h => formatCellValue(h, o[h], tz)));
    const dateCol = headers.indexOf('date');
    if (dateCol !== -1) {
      sheet.getRange(2, dateCol + 1, rows.length, 1).setNumberFormat('@');
    }
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function upsertRowByKey(ss, sheetName, data, headers, keyHeader, tz) {
  if (!data) return;
  const sheet = ensureSheetHeaders(ss, sheetName, headers);
  const keyCol = headers.indexOf(keyHeader);
  const keyVal = keyHeader === 'date' ? normalizeDateStr(data[keyHeader], tz) : String(data[keyHeader] || '');
  const rowValues = headers.map(h => formatCellValue(h, data[h], tz));

  const lastRow = sheet.getLastRow();
  if (lastRow > 1 && keyCol !== -1 && keyVal) {
    const keys = sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues().flat();
    for (let i = 0; i < keys.length; i++) {
      const existing = keyHeader === 'date' ? normalizeDateStr(keys[i], tz) : String(keys[i] || '');
      if (existing === keyVal) {
        writeRowValues(sheet, i + 2, headers, rowValues);
        return;
      }
    }
  }
  writeRowValues(sheet, lastRow + 1, headers, rowValues);
}

function deleteRowByKey(ss, sheetName, keyHeader, keyVal, tz) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1 || !keyVal) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const keyCol = headers.indexOf(keyHeader);
  if (keyCol === -1) return false;
  const target = keyHeader === 'date' ? normalizeDateStr(keyVal, tz) : String(keyVal);
  const keys = sheet.getRange(2, keyCol + 1, sheet.getLastRow() - 1, 1).getValues().flat();
  let deleted = false;
  for (let i = keys.length - 1; i >= 0; i--) {
    const existing = keyHeader === 'date' ? normalizeDateStr(keys[i], tz) : String(keys[i] || '');
    if (existing === target) {
      sheet.deleteRow(i + 2);
      deleted = true;
    }
  }
  return deleted;
}

function upsertBatchByKey(ss, sheetName, items, headers, keyHeader, tz) {
  if (!items || !items.length) return 0;
  const sheet = ensureSheetHeaders(ss, sheetName, headers);
  const keyCol = headers.indexOf(keyHeader);
  const lastRow = sheet.getLastRow();
  const existingMap = {};

  if (lastRow > 1 && keyCol !== -1) {
    const keys = sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues().flat();
    keys.forEach((k, idx) => {
      const normalized = keyHeader === 'date' ? normalizeDateStr(k, tz) : String(k || '');
      if (normalized) existingMap[normalized] = idx + 2;
    });
  }

  let nextRow = lastRow + 1;
  const toAppend = [];

  items.forEach(item => {
    const rowValues = headers.map(h => formatCellValue(h, item[h], tz));
    const keyVal = keyHeader === 'date' ? normalizeDateStr(item[keyHeader], tz) : String(item[keyHeader] || '');
    if (keyVal && existingMap[keyVal]) {
      writeRowValues(sheet, existingMap[keyVal], headers, rowValues);
    } else {
      toAppend.push(rowValues);
      if (keyVal) existingMap[keyVal] = nextRow;
      nextRow++;
    }
  });

  if (toAppend.length) {
    const startRow = sheet.getLastRow() + 1;
    const dateCol = headers.indexOf('date');
    if (dateCol !== -1) {
      sheet.getRange(startRow, dateCol + 1, toAppend.length, 1).setNumberFormat('@');
    }
    sheet.getRange(startRow, 1, toAppend.length, headers.length).setValues(toAppend);
  }

  return items.length;
}

function pushAllData(ss, payload, tz) {
  let prodCount = 0;
  if (Array.isArray(payload.products)) {
    saveAll(ss, PRODUCTS_SHEET, payload.products, PRODUCT_HEADERS, tz);
    prodCount = payload.products.length;
  }

  if (Array.isArray(payload.deletedSaleIds)) {
    payload.deletedSaleIds.forEach(id => deleteRowByKey(ss, SALES_SHEET, 'id', id, tz));
  }
  if (Array.isArray(payload.deletedExpenseIds)) {
    payload.deletedExpenseIds.forEach(id => deleteRowByKey(ss, EXPENSES_SHEET, 'id', id, tz));
  }

  const salesCount = upsertBatchByKey(ss, SALES_SHEET, payload.sales || [], SALE_HEADERS, 'id', tz);
  const expCount = upsertBatchByKey(ss, EXPENSES_SHEET, payload.expenses || [], EXPENSE_HEADERS, 'id', tz);

  let dailyList = [];
  if (Array.isArray(payload.daily)) {
    dailyList = payload.daily;
  } else if (payload.daily && typeof payload.daily === 'object') {
    dailyList = Object.keys(payload.daily).map(dateKey => Object.assign({ date: dateKey }, payload.daily[dateKey]));
  }
  const dailyCount = upsertBatchByKey(ss, DAILY_SHEET, dailyList, DAILY_HEADERS, 'date', tz);

  let settingsCount = 0;
  if (payload.settings && typeof payload.settings === 'object') {
    settingsCount = saveSettingsData(ss, payload.settings);
  }

  return {
    products: prodCount,
    sales: salesCount,
    expenses: expCount,
    daily: dailyCount,
    settings: settingsCount
  };
}
