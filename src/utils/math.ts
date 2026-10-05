export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const sat = (v: number) => clamp(v, 0, 1);
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
export const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

export function fmtNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(1) + 'Cr';
  if (a >= 1e5) return (n / 1e5).toFixed(1) + 'L';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toLocaleString('en-IN');
}
/** Money is stored in ₹ lakh (1 L = 100,000). */
export function fmtMoney(lakh: number): string {
  const sign = lakh < 0 ? '-' : '';
  const a = Math.abs(lakh);
  if (a >= 100) return `${sign}₹${(a / 100).toFixed(a >= 1000 ? 0 : 1)} Cr`;
  return `${sign}₹${a.toFixed(a >= 10 ? 0 : 1)} L`;
}
export const pct = (v: number) => `${Math.round(v * 100)}%`;
