import { World } from '../world';
import { MapParams, Build, Zone, RoadSpec, TILE_M } from '../types';
import { generateTerrain } from '../terrain/generate';
import { PRESETS, finalizeSpec } from '../roads/spec';
import { planRoad, commitRoad } from '../roads/builder';
import { DEFS } from '../../data/buildings';
import { updateAccessibility, updateCoverage, updateDensity, updateLandValue } from './fields';
import { occupancyStep, tryGrow, recount, assignDestinations, constructionStep } from '../population/growth';
import { clamp } from '../../utils/math';
import { Terrain } from '../types';
import { slopeCostFactor } from '../terrain/query';

const spec = (name: string) => PRESETS.find((p) => p.name === name)!;
export const REGIONAL_ROAD: RoadSpec = finalizeSpec({
  ...spec('Arterial Road'), name: 'Regional Road', lanesFwd: 2, lanesBwd: 2, speed: 80, median: 'painted', sidewalk: 'none', bike: 'none', trees: false, benches: false, signs: true, drain: 'open', trucks: 'allowed',
});

const START_MONEY: Record<string, number> = { lean: 2600, standard: 4600, rich: 8000 };

/** Grid A* to lay out the regional road: avoids water & steep ground where possible. */
function gridPath(t: Terrain, from: { x: number; y: number }, to: { x: number; y: number }): number[] {
  const n = t.n;
  const idx = (x: number, y: number) => y * n + x;
  const sx = Math.round(clamp(from.x, 1, n - 2)), sy = Math.round(clamp(from.y, 1, n - 2));
  const tx = Math.round(to.x), ty = Math.round(to.y);
  const g = new Float32Array(n * n).fill(1e9);
  const par = new Int32Array(n * n).fill(-1);
  const heap: [number, number][] = [];
  const push = (f: number, k: number) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  g[idx(sx, sy)] = 0;
  push(0, idx(sx, sy));
  while (heap.length) {
    const [, k] = pop();
    const x = k % n, y = (k / n) | 0;
    if (x === tx && y === ty) break;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= n - 1 || ny >= n - 1) continue;
      const kk = idx(nx, ny);
      let c = Math.hypot(dx, dy) * (1 + (slopeCostFactor(t.slope[kk]) - 1) * 1.5);
      if (t.waterKind[kk]) c += 14;
      if (t.build[kk] === Build.No && !t.waterKind[kk]) c += 30;
      if (t.protectedLand[kk]) c += 10;
      const ng = g[k] + c;
      if (ng < g[kk]) { g[kk] = ng; par[kk] = k; push(ng + Math.hypot(nx - tx, ny - ty), kk); }
    }
  }
  const path: number[] = [];
  let k = idx(tx, ty);
  if (par[k] < 0 && !(sx === tx && sy === ty)) return [from.x, from.y, to.x, to.y];
  while (k >= 0) { path.push((k % n) + 0.5, ((k / n) | 0) + 0.5); k = par[k]; }
  path.reverse();
  return path;
}

function smoothPath(path: number[], every = 5): number[] {
  const out: number[] = [path[0], path[1]];
  for (let i = every * 2; i < path.length - 2; i += every * 2) out.push(path[i], path[i + 1]);
  out.push(path[path.length - 2], path[path.length - 1]);
  // gentle chaikin smoothing
  let pts = out;
  for (let it = 0; it < 2; it++) {
    const q: number[] = [pts[0], pts[1]];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      q.push(0.75 * pts[i] + 0.25 * pts[i + 2], 0.75 * pts[i + 1] + 0.25 * pts[i + 3], 0.25 * pts[i] + 0.75 * pts[i + 2], 0.25 * pts[i + 1] + 0.75 * pts[i + 3]);
    }
    q.push(pts[pts.length - 2], pts[pts.length - 1]);
    pts = q;
  }
  return pts;
}

function buildChunked(world: World, path: number[], sp: RoadSpec, mode: 'auto' | 'ground' = 'auto') {
  // build in ~50-tile stretches so each plan stays within limits
  let start = 0;
  const maxPts = 36;
  while (start < path.length / 2 - 1) {
    const end = Math.min(path.length / 2 - 1, start + maxPts);
    const seg = path.slice(start * 2, end * 2 + 2);
    const plan = planRoad(world, seg, sp, mode);
    if (plan.pieces.length) commitRoad(world, plan, sp);
    start = end;
  }
}

function findSpot(world: World, key: string, cx: number, cy: number, minD: number, maxD: number, opts: { edge?: boolean; roadNear?: boolean } = {}): { x: number; y: number } | null {
  const def = DEFS[key];
  const cands: { x: number; y: number; d: number }[] = [];
  for (let r = minD; r <= maxD; r += 1) {
    for (let a = 0; a < 40; a++) {
      const ang = (a / 40) * Math.PI * 2 + r * 0.3;
      const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(cy + Math.sin(ang) * r);
      if (!world.canPlace(def, x, y, 0).ok) continue;
      if (opts.roadNear) {
        const ne = world.net.nearestEdge(x + def.w / 2, y + def.h / 2, 3.2, (e) => e.structure === 'ground' && e.spec.category !== 'highway');
        if (!ne) continue;
      }
      // keep it away from the road corridor itself and flat
      let flat = true;
      for (let j = -1; j <= def.h; j++) for (let i = -1; i <= def.w; i++) { const xx = x + i, yy = y + j; if (world.inb(xx, yy) && world.terrain.build[yy * world.n + xx] >= Build.Expensive) flat = false; }
      if (!flat) continue;
      cands.push({ x, y, d: r });
      if (cands.length > 3) return cands[0];
    }
  }
  return cands[0] ?? null;
}

/** Create a new world with a believable starting settlement. */
export function createWorld(params: MapParams, terrainOverride?: Terrain): World {
  const terrain = terrainOverride ?? generateTerrain(params);
  const world = new World(params, terrain);
  world.free = true;
  const t = terrain;
  const n = t.n;
  const cx = t.start.x, cy = t.start.y;
  // axis points toward the regional connection
  let ax = t.entry.x - cx, ay = t.entry.y - cy;
  const al = Math.hypot(ax, ay) || 1;
  ax /= al; ay /= al;
  // snap axis to the nearer cardinal direction so blocks line up
  if (Math.abs(ax) > Math.abs(ay)) { ax = Math.sign(ax); ay = 0; } else { ax = 0; ay = Math.sign(ay) || 1; }
  const px = -ay, py = ax; // perpendicular
  const P = (u: number, v: number): [number, number] => [cx + ax * u + px * v, cy + ay * u + py * v];

  // 1) regional road from the map edge to the settlement
  const startPt = P(15, 0);
  const route = smoothPath(gridPath(t, { x: t.entry.x, y: t.entry.y }, { x: startPt[0], y: startPt[1] }), 4);
  buildChunked(world, route, REGIONAL_ROAD, 'ground');
  // 2) main street and cross streets
  const main = spec('Collector Road');
  const local = spec('Local Street');
  const s0 = P(15, 0), s1 = P(-15, 0);
  buildChunked(world, [s0[0], s0[1], s1[0], s1[1]], main, 'ground');
  for (const u of [10, 5, 0, -5, -10]) {
    const a = P(u, -11), b = P(u, 11);
    buildChunked(world, [a[0], a[1], b[0], b[1]], local, 'ground');
  }
  // 3) zoning around the streets
  const zone = (u0: number, u1: number, v0: number, v1: number, z: Zone) => {
    const a = P(u0, v0), b = P(u1, v1);
    world.paintZone(Math.floor(Math.min(a[0], b[0])), Math.floor(Math.min(a[1], b[1])), Math.floor(Math.max(a[0], b[0])), Math.floor(Math.max(a[1], b[1])), z);
  };
  zone(-14, 14, -12, 12, Zone.ResLow);
  zone(-3, 4, -6, 6, Zone.Commercial);
  zone(5, 10, -5, 5, Zone.ResMed);
  zone(-6, -3, -7, 7, Zone.Mixed);
  // 4) utilities & a depot (placed instantly, funded by the "city")
  const place = (key: string, u: number, v: number, opts: { roadNear?: boolean } = {}) => {
    const [x, y] = P(u, v);
    const sp = findSpot(world, key, x, y, 0, 9, opts) ?? findSpot(world, key, x, y, 9, 26, opts) ?? findSpot(world, key, cx, cy, 6, 30, {});
    if (!sp) return null;
    return world.placeBuilding(DEFS[key], sp.x, sp.y, 0, { free: true, instant: true, wealth: 1 });
  };
  place('power_small', -17, 13);
  place('substation', -2, 9);
  place('borewell', 4, -9);
  place('borewell', -6, -9);
  place('water_tower', -1, -8);
  place('bus_depot', 12, 14, { roadNear: true });
  place('market_local', 1, 7, { roadNear: true });
  place('park_small', 12, -9, { roadNear: true });
  place('auto_stand', 1, 4, { roadNear: true });
  // if a river is close, add a river intake too
  if (t.waterBodies.some((w) => w.kind === 1 || w.kind === 2)) place('water_pump', 0, 0);
  // 5) seed households by running growth instantly
  world.net.ensureMask();
  world.accessDirty = true;
  world.refreshAccess();
  const seedStep = () => { updateDensity(world); updateCoverage(world); updateLandValue(world); };
  seedStep();
  world.stats.demand = { r: 0.9, c: 0.7, i: 0.45, o: 0 };
  const zt = [
    { zone: Zone.ResLow, w: 1 }, { zone: Zone.ResMed, w: 0.7 }, { zone: Zone.Commercial, w: 0.8 }, { zone: Zone.Mixed, w: 0.7 }, { zone: Zone.Industrial, w: 0.5 },
  ];
  for (let i = 0; i < 220; i++) {
    tryGrow(world, zt);
    if (i % 8 === 0) { constructionStep(world, 10); updateDensity(world); updateCoverage(world); updateLandValue(world); }
  }
  constructionStep(world, 30);
  updateDensity(world); updateCoverage(world); updateLandValue(world);
  world.stats.happiness = 0.7;
  for (let i = 0; i < 14; i++) { occupancyStep(world); recount(world); if (world.stats.population >= 520) break; }
  recount(world);
  assignDestinations(world);
  updateAccessibility(world);
  world.free = false;
  world.money = START_MONEY[params.resources] * world.incomeMultiplier();
  world.maxPop = world.stats.population;
  world.notify(`Welcome to ${world.cityName}. Design how it moves.`, 'good');
  void TILE_M; void n;
  return world;
}
