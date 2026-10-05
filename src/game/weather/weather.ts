import type { World } from '../world';
import { CATEGORY_RANK } from '../roads/spec';
import { clamp } from '../../utils/math';
import { pointAt } from '../roads/geometry';

type W = World['weather'];

/** 0..1 monsoon strength by month (Jun–Sep strongest; Oct–Nov northeast monsoon is weaker). */
export function monsoon(month: number): number {
  return [0.03, 0.03, 0.08, 0.15, 0.25, 0.75, 1, 1, 0.8, 0.45, 0.3, 0.1][month] ?? 0.1;
}

const TARGET: Record<W, number> = { clear: 0, cloudy: 0.02, rain: 0.5, heavy: 1 };

/** Hourly Markov weather with strong seasonality. */
export function weatherHour(world: World) {
  const m = monsoon(world.month);
  const r = world.rng();
  const cur = world.weather;
  const pRain = 0.04 + m * 0.5;
  const pHeavy = m * m * 0.32;
  let next: W = cur;
  if (cur === 'clear') next = r < pRain * 0.3 ? 'cloudy' : 'clear';
  else if (cur === 'cloudy') next = r < pRain ? 'rain' : r < pRain + 0.25 ? 'clear' : 'cloudy';
  else if (cur === 'rain') next = r < pHeavy ? 'heavy' : r < 0.35 - m * 0.2 ? 'cloudy' : 'rain';
  else next = r < 0.35 ? 'rain' : 'heavy';
  if (next !== cur) {
    world.weather = next;
    if (next === 'heavy') world.notify('Heavy rain — expect slow traffic and drainage stress', 'warn');
    if (next === 'rain' && cur === 'cloudy') world.notify('Rain begins', 'info');
  }
}

export function weatherTick(world: World, dtSec: number) {
  const target = TARGET[world.weather] * (world.weather === 'rain' ? 0.85 + 0.3 * Math.sin(world.day * 3.1) : 1);
  world.rain += (target - world.rain) * Math.min(1, dtSec * 0.4);
  const cloud = world.weather === 'clear' ? 0.15 : world.weather === 'cloudy' ? 0.55 : world.weather === 'rain' ? 0.8 : 1;
  world.cloud += (cloud - world.cloud) * Math.min(1, dtSec * 0.3);
}

let drainCache: { ver: number; cap: Float32Array } | null = null;

function drainCapacity(world: World): Float32Array {
  const n = world.n;
  if (drainCache && drainCache.ver === world.net.version && drainCache.cap.length === n * n) return drainCache.cap;
  const cap = new Float32Array(n * n).fill(0.012); // natural soak-away
  for (const e of world.net.edges.values()) {
    if (e.structure !== 'ground' && e.structure !== 'depressed') continue;
    const v = ({ none: 0, open: 0.035, covered: 0.06, storm: 0.11 } as const)[e.spec.drain];
    const steps = Math.max(1, Math.ceil(e.len / 0.8));
    for (let k = 0; k <= steps; k++) {
      const p = pointAt(e.pts, e.cum, (e.len * k) / steps);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const x = Math.floor(p.x) + i, y = Math.floor(p.y) + j;
        if (x >= 0 && y >= 0 && x < n && y < n) cap[y * n + x] = Math.max(cap[y * n + x], 0.012 + v * (CATEGORY_RANK[e.spec.category] >= 1 ? 1 : 0.8));
      }
    }
  }
  drainCache = { ver: world.net.version, cap };
  return cap;
}

/** Simplified flooding: rain fills tiles, drains empty them, excess runs downhill. */
export function floodStep(world: World, hours: number) {
  const n = world.n, d = world.floodDepth, t = world.terrain, V = n + 1;
  const rain = world.rain;
  let any = false;
  for (let i = 0; i < d.length; i++) if (d[i] > 0.002) { any = true; break; }
  if (rain < 0.05 && !any) return;
  const cap = drainCapacity(world);
  const F = world.fields;
  const inflow = Math.pow(rain, 1.4) * 0.17 * hours;
  const next = new Float32Array(d.length);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    if (t.waterKind[k]) { next[k] = 0; continue; }
    const h = t.heights[y * V + x];
    let cur = d[k] + next[k] + inflow;
    const drain = (cap[k] + F.drain[k] * 0.07) * hours * (1 + (rain < 0.05 ? 0.8 : 0));
    cur = Math.max(0, cur - drain);
    // flow to the lowest neighbour
    let low = -1, lh = h + d[k];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const kk = yy * n + xx;
      const hh = t.heights[yy * V + xx] + d[kk];
      if (hh < lh) { lh = hh; low = kk; }
    }
    if (low >= 0 && cur > 0.01) {
      const move = Math.min(cur, cur * 0.35 + 0.01);
      next[low] += move; cur -= move;
    }
    next[k] += cur;
  }
  let flooded = 0;
  for (let i = 0; i < d.length; i++) { d[i] = Math.min(1.5, next[i]); if (d[i] > 0.15 && world.buildGrid[i]) flooded++; }
  world.stats.floodedTiles = flooded;
}

export const weatherEffects = (world: World) => ({
  speed: 1 - 0.3 * world.rain,
  walk: 1 - 0.55 * world.rain,
  cycle: 1 - 0.8 * world.rain,
  visibility: clamp(1 - 0.5 * world.rain, 0.4, 1),
});
