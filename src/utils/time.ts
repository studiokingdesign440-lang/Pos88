export interface TimezoneOption {
  value: string;
  label: string;
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: 'Asia/Jakarta', label: 'WIB · Asia/Jakarta (UTC+7)' },
  { value: 'Asia/Makassar', label: 'WITA · Asia/Makassar (UTC+8)' },
  { value: 'Asia/Jayapura', label: 'WIT · Asia/Jayapura (UTC+9)' },
  { value: 'Asia/Singapore', label: 'SGT · Asia/Singapore (UTC+8)' },
  { value: 'Asia/Kuala_Lumpur', label: 'MYT · Asia/Kuala Lumpur (UTC+8)' },
  { value: 'Asia/Bangkok', label: 'ICT · Asia/Bangkok (UTC+7)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'local', label: 'Device Local Timezone' },
];

export function getEffectiveTimezone(tzSetting?: string): string {
  if (!tzSetting || tzSetting === 'local') {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
    } catch {
      return 'Asia/Jakarta';
    }
  }
  return tzSetting;
}

export function localDate(d: Date | number = new Date(), tzSetting?: string): string {
  const dateObj = typeof d === 'number' ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) return '';
  const tz = getEffectiveTimezone(tzSetting);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dateObj);
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
  }
}

export function fmtDateTime(d: Date | number, tzSetting?: string): string {
  const dateObj = typeof d === 'number' ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) return '';
  const tz = getEffectiveTimezone(tzSetting);
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(dateObj);
    const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
  } catch {
    return dateObj.toLocaleString('en-GB');
  }
}

export function fmtTime(ts: number, tzSetting?: string): string {
  const dateObj = new Date(ts);
  if (isNaN(dateObj.getTime())) return '';
  const tz = getEffectiveTimezone(tzSetting);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(dateObj);
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
  }
}

export function fmtClockWithSeconds(d: Date | number, tzSetting?: string): string {
  const dateObj = typeof d === 'number' ? new Date(d) : d;
  const tz = getEffectiveTimezone(tzSetting);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(dateObj);
  } catch {
    return dateObj.toLocaleString();
  }
}

export function fmtLongDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function shiftDays(dateStr: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + deltaDays));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function monthStart(dateStr: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return `${dateStr.slice(0, 7)}-01`;
  }
  return dateStr;
}

export function normalizeDateFromSheet(val: unknown, tzSetting?: string): string {
  if (val === null || val === undefined || val === '') return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return localDate(parsed, tzSetting);
  }
  return s;
}
