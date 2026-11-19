const PRODUCTS_SHEET = 'Products';
const SALES_SHEET = 'Sales';
const EXPENSES_SHEET = 'Expenses';
const DAILY_SHEET = 'DailyRecords';

function doGet(e) {
  const action = e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action === 'all') {
    return ContentService.createTextOutput(JSON.stringify({
      products: getSheetData(ss, PRODUCTS_SHEET),
      sales: getSheetData(ss, SALES_SHEET),
      expenses: getSheetData(ss, EXPENSES_SHEET),
      daily: getDailyData(ss)
    })).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (data.action === 'saveProducts') saveAll(ss, PRODUCTS_SHEET, data.payload, ['id', 'main', 'name', 'price', 'desc', 'active']);
    else if (data.action === 'addSale') appendRow(ss, SALES_SHEET, data.payload, ['id', 'ts', 'date', 'orderNo', 'orderName', 'cashier', 'items', 'subtotal', 'tax', 'service', 'total', 'payments', 'change', 'thanks', 'quote']);
    else if (data.action === 'addExpense') appendRow(ss, EXPENSES_SHEET, data.payload, ['id', 'date', 'name', 'amount', 'type']);
    else if (data.action === 'saveDaily') appendRow(ss, DAILY_SHEET, data.payload, ['date', 'kas', 'actualCash', 'expectedCash']);
    
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function getSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    let obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      if (h === 'items' || h === 'payments') { try { val = JSON.parse(val); } catch(e) { val = []; } }
      obj[h] = val;
    });
    return obj;
  });
}

function getDailyData(ss) {
  const sheet = ss.getSheetByName(DAILY_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return {};
  const data = sheet.getDataRange().getValues();
  let obj = {};
  data.slice(1).forEach(row => { obj[row[0]] = { kas: row[1], actualCash: row[2], expectedCash: row[3] }; });
  return obj;
}

function saveAll(ss, sheetName, arr, headers) {
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clear();
  sheet.appendRow(headers);
  if (arr && arr.length) {
    const rows = arr.map(o => headers.map(h => {
      if (h === 'items' || h === 'payments') return JSON.stringify(o[h] || []);
      return o[h] === undefined ? '' : o[h];
    }));
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function appendRow(ss, sheetName, data, headers) {
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  
  // Prevent duplicate daily records by updating if date exists
  if (sheetName === DAILY_SHEET) {
    const dates = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1).getValues().flat();
    const rowIndex = dates.indexOf(data.date);
    if (rowIndex !== -1) {
      sheet.getRange(rowIndex + 2, 1, 1, headers.length).setValues([headers.map(h => data[h])]);
      return;
    }
  }
  
  sheet.appendRow(headers.map(h => {
    if (h === 'items' || h === 'payments') return JSON.stringify(data[h] || []);
    return data[h] === undefined ? '' : data[h];
  }));
}