// Display helpers. Keep all user-facing number formatting here.
export function money(n: number, cents = false): string {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (!cents && v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`;
  if (!cents && v >= 100_000) return `${sign}$${Math.round(v / 1000)}k`;
  return sign + '$' + v.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}
export function clock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}
export function duration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
export function pct(x: number, digits = 0): string { return `${(x * 100).toFixed(digits)}%`; }
export function stars(r: number): string { return r.toFixed(1); }
export function signedMoney(n: number): string { return (n >= 0 ? '+' : '') + money(n); }
export function weekday(i: number): string { return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][((i % 5) + 5) % 5]; }
