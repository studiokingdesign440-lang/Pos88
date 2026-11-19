const nf = new Intl.NumberFormat('id-ID');

export function fmt(n: number | undefined | null): string {
  return nf.format(Math.round(n || 0));
}

export function rp(n: number | undefined | null): string {
  return 'Rp ' + fmt(n);
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function pickRandom(arr: string[] | undefined, exclude?: string): string {
  if (!arr || !arr.length) return '';
  const candidate = arr[Math.floor(Math.random() * arr.length)];
  if (candidate === exclude && arr.length > 1) {
    return pickRandom(arr, exclude);
  }
  return candidate;
}

export function escHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] || c));
}
