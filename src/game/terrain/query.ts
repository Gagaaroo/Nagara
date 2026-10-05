import { Terrain, TILE_M, Build } from '../types';

export const NO_WATER = -1e9;

export function inBounds(t: Terrain, x: number, y: number) {
  return x >= 0 && y >= 0 && x < t.n && y < t.n;
}

/** Bilinear terrain elevation in metres at fractional tile coordinates. */
export function heightAt(t: Terrain, x: number, y: number): number {
  const n = t.n;
  const fx = Math.min(Math.max(x, 0), n - 0.0001);
  const fy = Math.min(Math.max(y, 0), n - 0.0001);
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const V = n + 1;
  const h = t.heights;
  const a = h[iy * V + ix], b = h[iy * V + ix + 1], c = h[(iy + 1) * V + ix], d = h[(iy + 1) * V + ix + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function waterAt(t: Terrain, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= t.n || iy >= t.n) return 0;
  return t.waterKind[iy * t.n + ix];
}

/** Water surface elevation near a point (NO_WATER if dry). */
export function waterSurfaceAt(t: Terrain, x: number, y: number): number {
  const V = t.n + 1;
  const ix = Math.min(t.n, Math.max(0, Math.round(x))), iy = Math.min(t.n, Math.max(0, Math.round(y)));
  return t.waterLevel[iy * V + ix];
}

export function slopeAt(t: Terrain, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= t.n || iy >= t.n) return 1;
  return t.slope[iy * t.n + ix];
}

export function buildAt(t: Terrain, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= t.n || iy >= t.n) return Build.No;
  return t.build[iy * t.n + ix];
}

export function classifyTile(t: Terrain, i: number, j: number) {
  const n = t.n, V = n + 1, k = j * n + i;
  const h = t.heights;
  const h00 = h[j * V + i], h10 = h[j * V + i + 1], h01 = h[(j + 1) * V + i], h11 = h[(j + 1) * V + i + 1];
  const dx = (h10 + h11 - h00 - h01) / 2 / TILE_M;
  const dy = (h01 + h11 - h00 - h10) / 2 / TILE_M;
  const s = Math.hypot(dx, dy);
  t.slope[k] = s;
  let c = Build.Ok;
  if (s > 0.09) c = Build.Difficult;
  if (s > 0.17) c = Build.Expensive;
  if (s > 0.3) c = Build.No;
  if (t.waterKind[k]) c = Build.No;
  if (t.protectedLand[k]) c = Build.No;
  t.build[k] = c;
}

/** Recompute slope/buildability for a tile rectangle (after terraforming). */
export function refreshTiles(t: Terrain, x0: number, y0: number, x1: number, y1: number) {
  for (let j = Math.max(0, y0); j <= Math.min(t.n - 1, y1); j++)
    for (let i = Math.max(0, x0); i <= Math.min(t.n - 1, x1); i++) classifyTile(t, i, j);
}

/** Cost multiplier for building on a tile of this slope. */
export function slopeCostFactor(slope: number): number {
  return 1 + Math.min(6, Math.pow(slope / 0.06, 1.6));
}
