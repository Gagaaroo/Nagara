import type { World } from '../world';
import { ID, RoadEdge, RoadSpec, Structure, StructureMode, Build, TILE_M } from '../types';
import { closestOnPolyline, cumLengths, limitGrade, pointAt, segIntersect, smoothArray } from './geometry';
import { costPerTile, roadWidth, STRUCTURE_COST } from './spec';
import { heightAt, refreshTiles, slopeAt, slopeCostFactor, waterAt, waterSurfaceAt, NO_WATER } from '../terrain/query';
import { clamp, lerp, smoothstep } from '../../utils/math';

export interface RoadPlanPiece { pts: number[]; zs: number[]; structure: Structure; cost: number; len: number }
export interface RoadPlan {
  pieces: RoadPlanPiece[];
  cost: number; // lakh, including compensation
  valid: boolean;
  issues: string[];
  warnings: string[];
  junctions: { x: number; y: number; kind: 'new' | 'existing' | 'cross' }[];
  demolish: ID[];
  length: number;
  bridgeLen: number;
  tunnelLen: number;
  maxGrade: number;
  compensation: number;
}

const SPACING = 0.5;
const MAX_LEN = 140;

function resample(path: number[]): number[] {
  const cum = cumLengths(path);
  const L = cum[cum.length - 1];
  if (L < 1e-6) return path.slice(0, 2);
  const steps = Math.max(1, Math.round(L / SPACING));
  const out: number[] = [];
  let seg = 0;
  for (let i = 0; i <= steps; i++) {
    const s = (L * i) / steps;
    while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
    const span = cum[seg + 1] - cum[seg] || 1e-6;
    const t = (s - cum[seg]) / span;
    out.push(path[seg * 2] + (path[seg * 2 + 2] - path[seg * 2]) * t, path[seg * 2 + 1] + (path[seg * 2 + 3] - path[seg * 2 + 1]) * t);
  }
  return out;
}

/** Analyse a hand-drawn path: structures, grades, junctions, cost, validity. Pure — does not mutate. */
export function planRoad(world: World, rawPath: number[], spec: RoadSpec, mode: StructureMode): RoadPlan {
  const plan: RoadPlan = { pieces: [], cost: 0, valid: false, issues: [], warnings: [], junctions: [], demolish: [], length: 0, bridgeLen: 0, tunnelLen: 0, maxGrade: 0, compensation: 0 };
  const t = world.terrain;
  const net = world.net;
  if (rawPath.length < 4) { plan.issues.push('Draw a longer road'); return plan; }
  let P = resample(rawPath);
  let N = P.length / 2;
  if (N < 2) { plan.issues.push('Draw a longer road'); return plan; }
  const totalLen = (N - 1) * SPACING;
  if (totalLen > MAX_LEN) { plan.issues.push('Segment too long — build in shorter stretches'); }

  // ── endpoint snapping ──
  const snapEnd = (idx: number) => {
    const x = P[idx * 2], y = P[idx * 2 + 1];
    const nd = net.nearestNode(x, y, 1.0);
    if (nd) { P[idx * 2] = nd.x; P[idx * 2 + 1] = nd.y; return nd; }
    if (mode === 'auto' || mode === 'ground') {
      const ne = net.nearestEdge(x, y, 0.7, (e) => e.structure === 'ground' || e.structure === 'depressed');
      if (ne && ne.s > 0.2 && ne.s < ne.e.len - 0.2) { P[idx * 2] = ne.x; P[idx * 2 + 1] = ne.y; return ne.e; }
    }
    return null;
  };
  const s0 = snapEnd(0), s1 = snapEnd(N - 1);
  // drop duplicate points created by snapping
  {
    const Q: number[] = [P[0], P[1]];
    for (let i = 1; i < N; i++) if (Math.hypot(P[i * 2] - Q[Q.length - 2], P[i * 2 + 1] - Q[Q.length - 1]) > 0.08) Q.push(P[i * 2], P[i * 2 + 1]);
    P = Q; N = P.length / 2;
  }
  if (N < 2) { plan.issues.push('Draw a longer road'); return plan; }
  if (Math.hypot(P[0] - P[N * 2 - 2], P[1] - P[N * 2 - 1]) < 0.5 && N < 5) { plan.issues.push('Draw a longer road'); return plan; }

  // ── terrain sampling ──
  const h: number[] = [], wet: boolean[] = [], blocked: boolean[] = [];
  const stepM = SPACING * TILE_M;
  for (let i = 0; i < N; i++) {
    const x = P[i * 2], y = P[i * 2 + 1];
    if (x < 0.6 || y < 0.6 || x > t.n - 0.6 || y > t.n - 0.6) { plan.issues.push('Outside the map'); break; }
    h.push(heightAt(t, x, y));
    const wk = waterAt(t, x, y);
    const ws = waterSurfaceAt(t, x, y);
    wet.push(wk > 0 || (ws > NO_WATER / 2 && heightAt(t, x, y) < ws + 0.2));
    const tx = Math.floor(x), ty = Math.floor(y);
    blocked.push(!wk && t.build[ty * t.n + tx] === Build.No);
  }
  if (plan.issues.includes('Outside the map')) return plan;

  let zg = limitGrade(smoothArray(h, 4), stepM, 0.085);
  // endpoints that join an existing node share its elevation
  const nodeZ = (s: unknown) => (s && typeof s === 'object' && 'z' in (s as object) ? (s as { z: number }).z : null);
  const z0 = nodeZ(s0), z1 = nodeZ(s1);
  if (z0 !== null) { const d = z0 - zg[0]; for (let i = 0; i < Math.min(N, 12); i++) zg[i] += d * (1 - i / 12); }
  if (z1 !== null) { const d = z1 - zg[N - 1]; for (let i = 0; i < Math.min(N, 12); i++) zg[N - 1 - i] += d * (1 - i / 12); }

  // ── structure per sample ──
  const st: Structure[] = new Array(N);
  const bump: number[] = h.map((v, i) => v - lerp(h[0], h[N - 1], i / (N - 1)));
  for (let i = 0; i < N; i++) {
    if (mode === 'auto') st[i] = wet[i] ? 'bridge' : bump[i] > 16 ? 'tunnel' : 'ground';
    else if (mode === 'ground') st[i] = wet[i] ? 'bridge' : 'ground';
    else if (mode === 'bridge') st[i] = 'bridge';
    else if (mode === 'tunnel') st[i] = wet[i] ? 'tunnel' : 'tunnel';
    else st[i] = mode === 'elevated' ? 'elevated' : 'depressed';
  }
  if (mode === 'auto') {
    // runs: tunnels must be at least 4 samples, otherwise stay on the ground
    let i = 0;
    while (i < N) {
      let j = i;
      while (j + 1 < N && st[j + 1] === st[i]) j++;
      if (st[i] === 'tunnel' && j - i + 1 < 5) for (let k = i; k <= j; k++) st[k] = 'ground';
      i = j + 1;
    }
    // bridges start and end on dry land: extend by one sample
    const copy = st.slice();
    for (let k = 0; k < N; k++) if (copy[k] === 'bridge') { if (k > 0 && st[k - 1] === 'ground') st[k - 1] = 'bridge'; if (k < N - 1 && st[k + 1] === 'ground') st[k + 1] = 'bridge'; }
  }
  // snapped T-junction endpoints must be ground level
  if (s0 && mode !== 'bridge' && mode !== 'tunnel') { if (st[0] === 'bridge' || st[0] === 'tunnel') st[0] = 'ground'; }
  if (s1 && mode !== 'bridge' && mode !== 'tunnel') { if (st[N - 1] === 'bridge' || st[N - 1] === 'tunnel') st[N - 1] = 'ground'; }

  // ── elevation profile ──
  const z = zg.slice();
  for (let i = 0; i < N; i++) {
    if (st[i] === 'elevated') z[i] = zg[i] + 6;
    if (st[i] === 'depressed') z[i] = zg[i] - 4;
  }
  {
    let i = 0;
    while (i < N) {
      let j = i;
      while (j + 1 < N && st[j + 1] === st[i]) j++;
      if (st[i] === 'bridge' || st[i] === 'tunnel') {
        const a = Math.max(0, i - 1), b = Math.min(N - 1, j + 1);
        const za = zg[a], zb = zg[b];
        for (let k = i; k <= j; k++) {
          const u = (k - a) / Math.max(1, b - a);
          let v = lerp(za, zb, u);
          if (st[i] === 'bridge') {
            const ws = waterSurfaceAt(t, P[k * 2], P[k * 2 + 1]);
            if (ws > NO_WATER / 2) v = Math.max(v, ws + 4.5);
            else v = Math.max(v, h[k] + 4);
            // gentle arch for long spans
            v += Math.sin(u * Math.PI) * Math.min(3, (b - a) * 0.12);
          }
          z[k] = v;
        }
      }
      i = j + 1;
    }
  }

  // ── breakpoints: structure changes, crossings, snapping to nodes ──
  interface BP { pos: number; x: number; y: number; kind: 'new' | 'existing' | 'cross' }
  const bps: BP[] = [{ pos: 0, x: P[0], y: P[1], kind: s0 ? 'existing' : 'new' }];
  const isGround = (s: Structure) => s === 'ground' || s === 'depressed';
  for (let i = 1; i < N; i++) if (st[i] !== st[i - 1]) bps.push({ pos: i, x: P[i * 2], y: P[i * 2 + 1], kind: 'new' });
  let overlap = 0;
  const demolish = new Set<ID>();
  for (let k = 0; k < N - 1; k++) {
    if (!isGround(st[k]) || !isGround(st[k + 1])) continue;
    const ax = P[k * 2], ay = P[k * 2 + 1], bx = P[k * 2 + 2], by = P[k * 2 + 3];
    const cand = net.edgesNear((ax + bx) / 2, (ay + by) / 2, 1.2);
    for (const e of cand) {
      if (!isGround(e.structure)) continue;
      let hit: { t: number; x: number; y: number } | null = null;
      for (let j = 0; j + 3 < e.pts.length; j += 2) {
        const r = segIntersect(ax, ay, bx, by, e.pts[j], e.pts[j + 1], e.pts[j + 2], e.pts[j + 3]);
        if (r) { hit = { t: r[0], x: ax + (bx - ax) * r[0], y: ay + (by - ay) * r[0] }; break; }
      }
      if (hit) {
        const pos = k + hit.t;
        if (pos > 0.55 && pos < N - 1.55 || (pos > 0.01 && pos < N - 1.01 && Math.min(pos, N - 1 - pos) > 0.3))
          bps.push({ pos, x: hit.x, y: hit.y, kind: 'cross' });
      }
    }
    // near existing nodes mid-way: connect to them
    if (k > 0) {
      const nd = net.nearestNode(ax, ay, 0.42);
      if (nd && isGround(st[k]) && !bps.some((b) => Math.abs(b.pos - k) < 1.2)) { P[k * 2] = nd.x; P[k * 2 + 1] = nd.y; bps.push({ pos: k, x: nd.x, y: nd.y, kind: 'existing' }); }
    }
  }
  bps.push({ pos: N - 1, x: P[N * 2 - 2], y: P[N * 2 - 1], kind: s1 ? 'existing' : 'new' });
  bps.sort((a, b) => a.pos - b.pos);
  // dedupe breakpoints too close to each other
  const keep: BP[] = [];
  for (const b of bps) {
    const prev = keep[keep.length - 1];
    if (prev && Math.hypot(prev.x - b.x, prev.y - b.y) < 0.5) {
      if (b.kind === 'cross' && prev.kind !== 'cross' && prev.pos !== 0) { keep[keep.length - 1] = b; }
      continue;
    }
    keep.push(b);
  }
  // overlap detection against existing roads
  for (let i = 3; i < N - 3; i++) {
    if (!isGround(st[i])) continue;
    const ne = net.nearestEdge(P[i * 2], P[i * 2 + 1], 0.16, (e) => isGround(e.structure));
    if (ne) overlap++;
  }
  if (overlap > 4) plan.issues.push('Overlaps an existing road — use Upgrade to change its type');

  // ── build pieces ──
  const zOf = (pos: number) => { const i = Math.min(N - 2, Math.floor(pos)); return lerp(z[i], z[i + 1], pos - i); };
  const slopeSum = (a: number, b: number) => {
    let s = 0, c = 0;
    for (let i = Math.floor(a); i <= Math.min(N - 1, Math.ceil(b)); i++) { s += slopeCostFactor(slopeAt(t, P[i * 2], P[i * 2 + 1])) + t.forest[Math.floor(P[i * 2 + 1]) * t.n + Math.floor(P[i * 2])] / 255 * 0.35; c++; }
    return s / Math.max(1, c);
  };
  const perTile = costPerTile(spec);
  const hw = roadWidth(spec) / 2;
  for (let b = 0; b + 1 < keep.length; b++) {
    const A = keep[b], B = keep[b + 1];
    const pts: number[] = [A.x, A.y];
    for (let i = Math.floor(A.pos) + 1; i <= Math.ceil(B.pos) - 1; i++) if (i > A.pos + 1e-6 && i < B.pos - 1e-6) pts.push(P[i * 2], P[i * 2 + 1]);
    pts.push(B.x, B.y);
    const cum = cumLengths(pts);
    const len = cum[cum.length - 1];
    if (len < 0.3) continue;
    const midIdx = Math.min(N - 1, Math.max(0, Math.round((A.pos + B.pos) / 2)));
    const structure = st[midIdx];
    const zs: number[] = [zOf(A.pos)];
    for (let i = Math.floor(A.pos) + 1; i <= Math.ceil(B.pos) - 1; i++) if (i > A.pos + 1e-6 && i < B.pos - 1e-6) zs.push(z[i]);
    zs.push(zOf(B.pos));
    let g = 0;
    for (let i = 1; i < zs.length; i++) g = Math.max(g, Math.abs(zs[i] - zs[i - 1]) / (Math.max(0.05, cum[i] - cum[i - 1]) * TILE_M));
    plan.maxGrade = Math.max(plan.maxGrade, g);
    const terrainK = isGround(structure) ? slopeSum(A.pos, B.pos) : 1.2;
    const cost = len * perTile * STRUCTURE_COST[structure] * terrainK * (structure === 'bridge' ? 1 + hw * 1.2 : 1) * world.costMultiplier();
    plan.pieces.push({ pts, zs, structure, cost, len });
    plan.cost += cost;
    plan.length += len;
    if (structure === 'bridge') plan.bridgeLen += len;
    if (structure === 'tunnel') plan.tunnelLen += len;
    if (isGround(structure)) {
      // demolition + terrain legality along the piece
      for (let k = 0; k + 1 < cum.length; k++) {
        const steps = Math.max(1, Math.ceil((cum[k + 1] - cum[k]) / 0.35));
        for (let q = 0; q <= steps; q++) {
          const x = pts[k * 2] + ((pts[k * 2 + 2] - pts[k * 2]) * q) / steps, y = pts[k * 2 + 1] + ((pts[k * 2 + 3] - pts[k * 2 + 1]) * q) / steps;
          for (let ty = Math.floor(y - hw); ty <= Math.floor(y + hw); ty++)
            for (let tx = Math.floor(x - hw); tx <= Math.floor(x + hw); tx++) {
              if (tx < 0 || ty < 0 || tx >= t.n || ty >= t.n) continue;
              const cx = clamp(x, tx, tx + 1), cy = clamp(y, ty, ty + 1);
              if (Math.hypot(cx - x, cy - y) > hw) continue;
              const bid = world.buildGrid[ty * t.n + tx];
              if (bid) demolish.add(bid);
            }
        }
      }
    }
  }
  if (plan.pieces.length === 0) { plan.issues.push('Draw a longer road'); return plan; }

  // ── validity ──
  for (let i = 0; i < N; i++) {
    if (isGround(st[i]) && wet[i]) { plan.issues.push('Water ahead — switch to Bridge or Auto'); break; }
  }
  for (let i = 0; i < N; i++) {
    if (isGround(st[i]) && blocked[i]) {
      plan.issues.push(t.protectedLand[Math.floor(P[i * 2 + 1]) * t.n + Math.floor(P[i * 2])] ? 'Protected land — use a bridge, tunnel or elevated road' : 'Terrain too steep — try a tunnel or a gentler line');
      break;
    }
  }
  if (plan.maxGrade > 0.14) plan.issues.push(`Grade ${(plan.maxGrade * 100).toFixed(0)}% is too steep for vehicles`);
  else if (plan.maxGrade > 0.09) plan.warnings.push(`Steep grade ${(plan.maxGrade * 100).toFixed(0)}% slows traffic and raises cost`);
  if (plan.tunnelLen > 0) plan.warnings.push(`Tunnel ${(plan.tunnelLen * TILE_M).toFixed(0)} m — limited capacity, expensive`);
  if (plan.bridgeLen > 0) plan.warnings.push(`Bridge ${(plan.bridgeLen * TILE_M).toFixed(0)} m`);
  if (spec.speed >= 80 && !isGround(st[0])) plan.warnings.push('High-speed roads are noisy');

  // demolition
  for (const id of demolish) {
    const b = world.buildings.get(id);
    if (!b) continue;
    if (b.def === 'landmark' || world.isLandmark(b)) { plan.issues.push(`Cannot demolish ${b.name}`); continue; }
    plan.demolish.push(id);
    plan.compensation += world.demolishCost(b);
  }
  if (plan.demolish.length) plan.warnings.push(`Demolishes ${plan.demolish.length} building${plan.demolish.length > 1 ? 's' : ''}`);
  plan.cost += plan.compensation;

  for (const b of keep) plan.junctions.push({ x: b.x, y: b.y, kind: b.kind });
  plan.valid = plan.issues.length === 0;
  if (plan.length > MAX_LEN) plan.valid = false;
  return plan;
}

/** Apply a validated plan to the world. Returns created edges. */
export function commitRoad(world: World, plan: RoadPlan, spec: RoadSpec): RoadEdge[] {
  const net = world.net;
  const t = world.terrain;
  for (const id of plan.demolish) world.demolish(id, true);
  const created: RoadEdge[] = [];
  for (const piece of plan.pieces) {
    const pa = piece.pts, nPts = pa.length;
    const a = net.getOrCreateNodeAt(pa[0], pa[1], piece.zs[0]);
    const b = net.getOrCreateNodeAt(pa[nPts - 2], pa[nPts - 1], piece.zs[piece.zs.length - 1]);
    if (a.id === b.id) continue;
    // make the polyline start/end exactly on the nodes
    const pts = pa.slice();
    pts[0] = a.x; pts[1] = a.y; pts[nPts - 2] = b.x; pts[nPts - 1] = b.y;
    const e = net.addEdge(a.id, b.id, { ...spec }, piece.structure, pts, piece.zs, piece.cost, world.day);
    created.push(e);
    a.z = piece.zs[0]; b.z = piece.zs[piece.zs.length - 1];
    if (piece.structure === 'ground' || piece.structure === 'depressed') terraform(world, e);
  }
  for (const e of created) world.afterRoadAdded(e);
  net.touch(true);
  return created;
}

/** Cut-and-fill the terrain under a ground road so it follows the road profile. */
export function terraform(world: World, e: RoadEdge) {
  const t = world.terrain;
  const V = t.n + 1;
  const hw = (e.width ?? 0.6) / 2;
  const reach = hw + 1.7;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let k = 0; k < e.zs.length; k++) {
    const px = e.pts[k * 2], py = e.pts[k * 2 + 1], pz = e.zs[k];
    for (let j = Math.max(0, Math.floor(py - reach)); j <= Math.min(t.n, Math.ceil(py + reach)); j++)
      for (let i = Math.max(0, Math.floor(px - reach)); i <= Math.min(t.n, Math.ceil(px + reach)); i++) {
        const d = Math.hypot(i - px, j - py);
        if (d > reach) continue;
        const idx = j * V + i;
        if (t.waterLevel[idx] > NO_WATER / 2 && t.heights[idx] < t.waterLevel[idx] + 0.3) continue;
        const w = 1 - smoothstep(hw + 0.35, reach, d);
        t.heights[idx] = lerp(t.heights[idx], pz, w);
        x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i); y1 = Math.max(y1, j);
      }
  }
  if (x1 >= 0) {
    refreshTiles(t, x0 - 1, y0 - 1, x1, y1);
    world.terrainVersion++;
    world.terrainDirty = true;
    world.dirtyRects.push([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
  }
}
