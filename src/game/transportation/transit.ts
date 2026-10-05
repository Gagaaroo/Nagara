import type { World } from '../world';
import { Alignment, ID, TransitLine, TransitMode, TransitStop, TILE_M } from '../types';
import { RoadGraph, findRoute, nearestNodeOf } from './pathfinding';
import { edgeAllows } from '../roads/network';
import { cumLengths, pointAt, smoothArray } from '../roads/geometry';
import { heightAt, waterAt } from '../terrain/query';
import { DEFS } from '../../data/buildings';
import { clamp } from '../../utils/math';

export interface ModeSpec {
  name: string; capacity: number; speedKph: number; vehicleCost: number; opCost: number; color: number; catchment: number; road: boolean; rank: number; dwell: number;
}

export const TRANSIT: Record<TransitMode, ModeSpec> = {
  bus: { name: 'Standard bus', capacity: 70, speedKph: 40, vehicleCost: 32, opCost: 1.3, color: 0xe8743b, catchment: 7, road: true, rank: 1, dwell: 22 },
  ebus: { name: 'Electric bus', capacity: 70, speedKph: 40, vehicleCost: 58, opCost: 0.8, color: 0x2fa89a, catchment: 7, road: true, rank: 1, dwell: 22 },
  artibus: { name: 'Articulated bus', capacity: 125, speedKph: 38, vehicleCost: 64, opCost: 1.9, color: 0xd9a21b, catchment: 7, road: true, rank: 1, dwell: 28 },
  minibus: { name: 'Mini bus', capacity: 28, speedKph: 42, vehicleCost: 16, opCost: 0.6, color: 0x8b6fcf, catchment: 6, road: true, rank: 1, dwell: 18 },
  metro: { name: 'Metro', capacity: 1100, speedKph: 38, vehicleCost: 900, opCost: 11, color: 0x3e8fd4, catchment: 14, road: false, rank: 3, dwell: 30 },
  suburban: { name: 'Suburban rail', capacity: 1400, speedKph: 50, vehicleCost: 1000, opCost: 12, color: 0xc4483f, catchment: 16, road: false, rank: 2, dwell: 35 },
  regional: { name: 'Regional rail', capacity: 900, speedKph: 75, vehicleCost: 1300, opCost: 14, color: 0x8a5a44, catchment: 18, road: false, rank: 2, dwell: 45 },
  freightrail: { name: 'Freight rail', capacity: 0, speedKph: 45, vehicleCost: 900, opCost: 8, color: 0x666666, catchment: 0, road: false, rank: 0, dwell: 30 },
};

export const LINE_COLORS = [0xe8743b, 0x2fa89a, 0x3e8fd4, 0xd9a21b, 0x8b6fcf, 0xc4483f, 0x58a65c, 0xd46a9f, 0x5f6caf];
export const isRoadMode = (m: TransitMode) => TRANSIT[m].road;
export const modeGroup = (m: TransitMode): 'bus' | 'metro' | 'rail' => (m === 'metro' ? 'metro' : TRANSIT[m].road ? 'bus' : 'rail');

export interface Mark { ri: number; s: number; stop: ID }
export interface LineRuntime {
  route: number[]; // edge ids for a full loop (out then back), road lines
  routeDir: number[];
  marks: Mark[];
  polyF: number[]; // polyline of the forward leg for display
  polyZ: number[];
  stopTimes: number[]; // seconds from first stop to each stop (forward)
  backTimes: number[]; // seconds from last stop to each stop (reverse)
  cycleSec: number;
  lengthTiles: number;
  loop: number[]; // full-loop polyline for rail vehicle motion (out and back)
  loopZ: number[];
  loopCum: number[];
  loopStopS: number[]; // distance of stop events along loop
  trainPos: number[];
}

export const STOP_COST = { bus: 1.5, shelter: 3 };
export const STOP_MIN_GAP = 1.8;

// ───────── stops ─────────
export function canPlaceBusStop(world: World, edgeId: ID, s: number): string | null {
  const e = world.net.edges.get(edgeId);
  if (!e) return 'Place the stop on a road';
  if (e.structure !== 'ground' && e.structure !== 'bridge' && e.structure !== 'elevated') return 'Stops need an open road';
  if (e.spec.category === 'highway') return 'No bus stops on highways';
  if (e.spec.lanesFwd + e.spec.lanesBwd === 0) return 'Invalid road';
  if (e.len < 1.5) return 'Road segment too short';
  for (const st of world.stops.values()) if (st.edge === edgeId && Math.abs(st.s - s) < STOP_MIN_GAP && (st.kind === 'bus' || st.kind === 'terminal')) return 'Too close to another stop';
  return null;
}

export function addBusStop(world: World, edgeId: ID, s: number, shelter = true, name?: string): TransitStop | string {
  const err = canPlaceBusStop(world, edgeId, s);
  if (err) return err;
  const e = world.net.edges.get(edgeId)!;
  const cost = (STOP_COST.bus + (shelter ? STOP_COST.shelter : 0)) * world.costMultiplier();
  if (!world.spend(cost)) return 'Not enough funds';
  const p = pointAt(e.pts, e.cum, s);
  const stop: TransitStop = {
    id: world.newId(), kind: 'bus', x: p.x, y: p.y, edge: edgeId, s, name: name ?? `${world.areaName(p.x, p.y)} Stop ${world.stops.size + 1}`,
    shelter, alignment: 'surface', waiting: 0, boarded: 0, building: 0,
  };
  world.stops.set(stop.id, stop);
  world.stopVersion++;
  return stop;
}

/** Registers a station stop for a station/terminal building. */
export function addStationStop(world: World, buildingId: ID, kind: TransitStop['kind'], alignment: Alignment): TransitStop | null {
  const b = world.buildings.get(buildingId);
  if (!b) return null;
  const stop: TransitStop = {
    id: world.newId(), kind, x: b.x + b.w / 2, y: b.y + b.h / 2, edge: b.access, s: b.accessS, name: `${world.areaName(b.x, b.y)} ${kind === 'metro' ? 'Metro' : kind === 'terminal' ? 'Bus Terminal' : kind === 'suburban' ? 'Rail' : 'Junction'}`,
    shelter: true, alignment, waiting: 0, boarded: 0, building: buildingId,
  };
  world.stops.set(stop.id, stop);
  world.stopVersion++;
  return stop;
}

// ───────── line creation ─────────
interface Leg { route: { edges: number[]; dirs: number[] } | null; time: number }

function stopDirOptions(world: World, st: TransitStop): number[] {
  const e = world.net.edges.get(st.edge);
  if (!e) return [];
  const o: number[] = [];
  for (const d of [0, 1]) if (edgeAllows(e, d) && !(e.spec.bus === 'none' && false)) o.push(d);
  return o;
}

/** Plans a loop (out and back) of road steps passing the stops in order. */
function planRoadLeg(world: World, graph: RoadGraph, stops: TransitStop[]): { steps: { edge: number; dir: number }[]; marks: { step: number; s: number; stop: ID }[]; time: number[] } | null {
  const net = world.net;
  const n = stops.length;
  const opts = stops.map((s) => stopDirOptions(world, s));
  if (opts.some((o) => o.length === 0)) return null;
  // DP over direction choice per stop
  const INF = 1e12;
  const cost: number[][] = stops.map((_, i) => opts[i].map(() => (i === 0 ? 0 : INF)));
  const from: number[][] = stops.map((_, i) => opts[i].map(() => -1));
  const legs: Map<string, Leg> = new Map();
  const legKey = (i: number, a: number, b: number) => `${i}:${a}:${b}`;
  for (let i = 0; i + 1 < n; i++) {
    for (let a = 0; a < opts[i].length; a++) {
      if (cost[i][a] >= INF) continue;
      const si = stops[i], ei = net.edges.get(si.edge)!;
      const da = opts[i][a];
      const ahead = da === 0 ? ei.b : ei.a;
      const rem = da === 0 ? ei.len - si.s : si.s;
      for (let b = 0; b < opts[i + 1].length; b++) {
        const sj = stops[i + 1], ej = net.edges.get(sj.edge)!;
        const db = opts[i + 1][b];
        let leg: Leg;
        if (ei.id === ej.id && da === db && ((da === 0 && sj.s > si.s) || (da === 1 && sj.s < si.s))) {
          leg = { route: { edges: [], dirs: [] }, time: (Math.abs(sj.s - si.s) * TILE_M) / 8 };
        } else {
          const entry = db === 0 ? ej.a : ej.b;
          const r = findRoute(graph, ahead, entry, 'bus');
          if (!r) { leg = { route: null, time: INF }; }
          else leg = { route: r, time: r.time + (rem * TILE_M) / 8 + ((db === 0 ? sj.s : ej.len - sj.s) * TILE_M) / 8 };
        }
        legs.set(legKey(i, a, b), leg);
        if (cost[i][a] + leg.time < cost[i + 1][b]) { cost[i + 1][b] = cost[i][a] + leg.time; from[i + 1][b] = a; }
      }
    }
  }
  let bi = 0, bc = INF;
  cost[n - 1].forEach((c, k) => { if (c < bc) { bc = c; bi = k; } });
  if (bc >= INF) return null;
  const choice: number[] = new Array(n);
  choice[n - 1] = bi;
  for (let i = n - 1; i > 0; i--) choice[i - 1] = from[i][choice[i]];
  const steps: { edge: number; dir: number }[] = [];
  const marks: { step: number; s: number; stop: ID }[] = [];
  const times: number[] = [0];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = opts[i][choice[i]];
    if (i === 0) {
      steps.push({ edge: stops[0].edge, dir: d });
      marks.push({ step: 0, s: stops[0].s, stop: stops[0].id });
    } else {
      const leg = legs.get(legKey(i - 1, choice[i - 1], choice[i]))!;
      acc += leg.time + TRANSIT.bus.dwell;
      times.push(acc);
      const prev = steps[steps.length - 1];
      const r = leg.route!;
      for (let k = 0; k < r.edges.length; k++) steps.push({ edge: r.edges[k], dir: r.dirs[k] });
      const last = steps[steps.length - 1];
      // stop edge is entered next: if it's the same step as the previous stop's edge/dir (same-edge hop) reuse it
      if (!(r.edges.length === 0 && prev.edge === stops[i].edge && prev.dir === d)) steps.push({ edge: stops[i].edge, dir: d });
      void last;
      marks.push({ step: steps.length - 1, s: stops[i].s, stop: stops[i].id });
    }
  }
  return { steps, marks, time: times };
}

/** Build a line (path, timing, vehicles) without registering it or charging money. */
export function draftLine(world: World, p: { name: string; mode: TransitMode; stops: ID[]; headwayMin: number; color: number; depot: ID; segAlign?: Alignment[]; alignment?: Alignment }): TransitLine | string {
  const stops = p.stops.map((id) => world.stops.get(id)).filter(Boolean) as TransitStop[];
  if (stops.length < 2) return 'A line needs at least two stops';
  const line: TransitLine = {
    id: 0, name: p.name, mode: p.mode, color: p.color, stops: p.stops.slice(), active: true, headwayMin: p.headwayMin, vehicles: 1, depot: p.depot,
    path: [], pathZ: [], edges: [], edgeDir: [], stopPos: [], alignment: p.alignment ?? 'elevated', lengthTiles: 0, riders: 0, ridersToday: 0, revenue: 0, cost: 0, loadFactor: 0,
    segAlign: p.segAlign ?? new Array(stops.length - 1).fill(p.alignment ?? 'elevated'),
  };
  const err = buildLineRuntime(world, line);
  if (err) return err;
  line.vehicles = clamp(Math.ceil(line.rt!.cycleSec / 60 / Math.max(2, p.headwayMin)), 1, 40);
  return line;
}

export function lineBuildCost(world: World, line: TransitLine): number {
  return line.vehicles * TRANSIT[line.mode].vehicleCost * world.costMultiplier() + trackCost(world, line);
}

export function createLine(world: World, p: { name: string; mode: TransitMode; stops: ID[]; headwayMin: number; color: number; depot: ID; segAlign?: Alignment[]; alignment?: Alignment }): TransitLine | string {
  const line = draftLine(world, p);
  if (typeof line === 'string') return line;
  line.id = world.newId();
  const cost = lineBuildCost(world, line);
  if (!world.spend(cost)) return `Not enough funds (need ${cost.toFixed(0)} L)`;
  world.lines.set(line.id, line);
  world.stopVersion++;
  return line;
}

export function trackCost(world: World, line: TransitLine): number {
  if (isRoadMode(line.mode)) return 0;
  const rt = line.rt;
  if (!rt) return 0;
  let c = 0;
  // per-leg length
  for (let i = 0; i + 1 < line.stops.length; i++) {
    const a = world.stops.get(line.stops[i])!, b = world.stops.get(line.stops[i + 1])!;
    const L = Math.hypot(a.x - b.x, a.y - b.y) * 1.1;
    const al = line.segAlign[i] ?? line.alignment;
    const per = line.mode === 'metro' ? (al === 'underground' ? 38 : al === 'elevated' ? 15 : 7) : (al === 'underground' ? 42 : al === 'elevated' ? 12 : 5);
    c += L * per;
  }
  return c * world.costMultiplier();
}

export function recomputeLine(world: World, line: TransitLine): boolean {
  const err = buildLineRuntime(world, line);
  line.active = !err && line.active;
  return !err;
}

function buildLineRuntime(world: World, line: TransitLine): string | null {
  const stops = line.stops.map((id) => world.stops.get(id)).filter(Boolean) as TransitStop[];
  if (stops.length < 2) return 'Stops missing';
  if (isRoadMode(line.mode)) return buildRoadLine(world, line, stops);
  return buildRailLine(world, line, stops);
}

function buildRoadLine(world: World, line: TransitLine, stops: TransitStop[]): string | null {
  const graph = world.graph;
  const fwd = planRoadLeg(world, graph, stops);
  if (!fwd) return 'No road connection between the stops (check one-way streets)';
  const rev = planRoadLeg(world, graph, stops.slice().reverse());
  if (!rev) return 'No return path — check one-way streets and turn restrictions';
  const route: number[] = [], routeDir: number[] = [];
  const marks: Mark[] = [];
  for (const s of fwd.steps) { route.push(s.edge); routeDir.push(s.dir); }
  for (const m of fwd.marks) marks.push({ ri: m.step, s: m.s, stop: m.stop });
  const off = route.length;
  for (const s of rev.steps) { route.push(s.edge); routeDir.push(s.dir); }
  for (const m of rev.marks) marks.push({ ri: off + m.step, s: m.s, stop: m.stop });
  // display polyline: forward leg
  const poly: number[] = [], polyZ: number[] = [];
  let length = 0;
  for (let k = 0; k < fwd.steps.length; k++) {
    const e = world.net.edges.get(fwd.steps[k].edge)!;
    const dir = fwd.steps[k].dir;
    const n = e.pts.length / 2;
    let a = 0, b = e.len;
    const mk = fwd.marks.filter((m) => m.step === k);
    if (k === 0) { a = dir === 0 ? fwd.marks[0].s : 0; b = dir === 0 ? e.len : fwd.marks[0].s; }
    if (k === fwd.steps.length - 1) { const last = fwd.marks[fwd.marks.length - 1]; if (dir === 0) b = last.s; else a = last.s; }
    void mk; void n;
    const idxs: number[] = [];
    for (let i = 0; i < e.cum.length; i++) if (e.cum[i] >= a - 1e-6 && e.cum[i] <= b + 1e-6) idxs.push(i);
    const seq = dir === 0 ? idxs : idxs.reverse();
    for (const i of seq) { poly.push(e.pts[i * 2], e.pts[i * 2 + 1]); polyZ.push(e.zs[i]); }
    length += Math.max(0, b - a);
  }
  line.rt = {
    route, routeDir, marks, polyF: poly, polyZ, stopTimes: fwd.time, backTimes: rev.time,
    cycleSec: fwd.time[fwd.time.length - 1] + rev.time[rev.time.length - 1] + 60, lengthTiles: length, loop: [], loopZ: [], loopCum: [], loopStopS: [], trainPos: [],
  };
  line.path = poly; line.pathZ = polyZ; line.lengthTiles = length;
  return null;
}

/** Catmull-Rom through station positions, with the terrain-following elevation per alignment. */
function buildRailLine(world: World, line: TransitLine, stops: TransitStop[]): string | null {
  const spec = TRANSIT[line.mode];
  const pts: number[] = [];
  const zs: number[] = [];
  const stopS: number[] = [];
  const P = stops.map((s) => [s.x, s.y]);
  const n = P.length;
  let dist = 0;
  const segSamples: number[][] = [];
  for (let i = 0; i + 1 < n; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(3, Math.ceil(L / 0.6));
    const seg: number[] = [];
    for (let k = (i === 0 ? 0 : 1); k <= steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      seg.push(x, y);
    }
    segSamples.push(seg);
  }
  const segIdx: number[] = []; // per sample, leg index
  for (let i = 0; i < segSamples.length; i++) {
    const seg = segSamples[i];
    for (let k = 0; k < seg.length; k += 2) { pts.push(seg[k], seg[k + 1]); segIdx.push(i); }
  }
  const raw = pts.length / 2;
  const ground: number[] = [];
  for (let i = 0; i < raw; i++) ground.push(heightAt(world.terrain, pts[i * 2], pts[i * 2 + 1]));
  const sm = smoothArray(ground, 5);
  for (let i = 0; i < raw; i++) {
    const al = line.segAlign[segIdx[i]] ?? line.alignment;
    const over = waterAt(world.terrain, pts[i * 2], pts[i * 2 + 1]);
    zs.push(al === 'elevated' ? sm[i] + 9 : al === 'underground' ? sm[i] - 11 : sm[i] + (over ? 4 : 0.4));
  }
  const cum = cumLengths(pts);
  // station positions along path = nearest sample to each station
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    let best = cursor, bd = 1e9;
    for (let k = cursor; k < raw; k++) {
      const d = Math.hypot(pts[k * 2] - P[i][0], pts[k * 2 + 1] - P[i][1]);
      if (d < bd) { bd = d; best = k; }
      if (k > cursor + 6 && d > bd + 6) break;
    }
    cursor = best;
    stopS.push(cum[best]);
  }
  void dist;
  const total = cum[cum.length - 1];
  const loop = pts.slice(), loopZ = zs.slice();
  for (let i = raw - 2; i >= 0; i--) { loop.push(pts[i * 2], pts[i * 2 + 1]); loopZ.push(zs[i]); }
  const loopCum = cumLengths(loop);
  const loopStopS: number[] = [...stopS];
  for (let i = n - 2; i >= 0; i--) loopStopS.push(total + (total - stopS[i]));
  const speed = (spec.speedKph / 3.6) / TILE_M; // tiles/s real
  const times: number[] = [0];
  for (let i = 1; i < n; i++) times.push((stopS[i] - stopS[i - 1]) / speed + spec.dwell + times[i - 1] - (i > 1 ? 0 : 0));
  const back: number[] = [0];
  for (let i = n - 2; i >= 0; i--) back.push(back[back.length - 1] + (stopS[i + 1] - stopS[i]) / speed + spec.dwell);
  line.rt = {
    route: [], routeDir: [], marks: [], polyF: pts, polyZ: zs, stopTimes: times, backTimes: back, cycleSec: times[n - 1] + back[n - 1] + 90,
    lengthTiles: total, loop, loopZ, loopCum, loopStopS, trainPos: [],
  };
  line.path = pts; line.pathZ = zs; line.lengthTiles = total; line.stopPos = stopS;
  return null;
}

export function lineAlignmentAt(line: TransitLine, i: number): Alignment { return line.segAlign[i] ?? line.alignment; }

export function setLineFrequency(world: World, line: TransitLine, headwayMin: number) {
  line.headwayMin = clamp(headwayMin, 2, 40);
  if (line.rt) line.vehicles = clamp(Math.ceil(line.rt.cycleSec / 60 / line.headwayMin), 1, 40);
}

export function lineMonthlyCost(line: TransitLine): number { return line.vehicles * TRANSIT[line.mode].opCost; }

export function deleteLine(world: World, id: ID) {
  world.lines.delete(id);
  world.stopVersion++;
}

// ───────── transit network: transfer-aware time matrix ─────────
export interface TransitNet {
  version: number;
  states: { line: ID; stop: ID; idx: number }[];
  T: Float32Array; // n×n seconds
  next: Int32Array;
  M: Uint8Array; // max mode rank along path
  n: number;
  stateOf: Map<string, number>;
  stopStates: Map<ID, number[]>;
  headway: Float32Array;
}

export function buildTransitNet(world: World): TransitNet {
  const states: TransitNet['states'] = [];
  const stateOf = new Map<string, number>();
  const stopStates = new Map<ID, number[]>();
  const lines = [...world.lines.values()].filter((l) => l.active && l.rt);
  for (const l of lines) l.stops.forEach((sid, idx) => {
    if (!world.stops.has(sid)) return;
    const k = states.length;
    states.push({ line: l.id, stop: sid, idx });
    stateOf.set(`${l.id}:${idx}`, k);
    let arr = stopStates.get(sid);
    if (!arr) stopStates.set(sid, (arr = []));
    arr.push(k);
  });
  const n = states.length;
  const T = new Float32Array(n * n).fill(1e9);
  const next = new Int32Array(n * n).fill(-1);
  const M = new Uint8Array(n * n);
  const headway = new Float32Array(n);
  for (let i = 0; i < n; i++) { T[i * n + i] = 0; next[i * n + i] = i; }
  for (const l of lines) {
    const spec = TRANSIT[l.mode];
    const rt = l.rt!;
    const hw = Math.max(2, l.headwayMin) * 60;
    for (let i = 0; i + 1 < l.stops.length; i++) {
      const a = stateOf.get(`${l.id}:${i}`), b = stateOf.get(`${l.id}:${i + 1}`);
      if (a === undefined || b === undefined) continue;
      const tf = rt.stopTimes[i + 1] - rt.stopTimes[i];
      const m = l.stops.length - 1 - i; // reverse index
      const tb = (rt.backTimes[m] ?? 0) - (rt.backTimes[m - 1] ?? 0) || tf;
      T[a * n + b] = tf; next[a * n + b] = b; M[a * n + b] = spec.rank;
      T[b * n + a] = tb; next[b * n + a] = a; M[b * n + a] = spec.rank;
    }
    for (let i = 0; i < l.stops.length; i++) { const k = stateOf.get(`${l.id}:${i}`); if (k !== undefined) headway[k] = hw; }
  }
  // transfers: same stop, or stops within 3 tiles
  const stopList = [...stopStates.keys()];
  for (let ia = 0; ia < stopList.length; ia++) for (let ib = ia; ib < stopList.length; ib++) {
    const sa = world.stops.get(stopList[ia])!, sb = world.stops.get(stopList[ib])!;
    const d = Math.hypot(sa.x - sb.x, sa.y - sb.y);
    if (d > 3.2) continue;
    const walk = d * TILE_M / 1.2;
    for (const x of stopStates.get(sa.id)!) for (const y of stopStates.get(sb.id)!) {
      if (x === y) continue;
      if (states[x].line === states[y].line) continue;
      T[x * n + y] = Math.min(T[x * n + y], headway[y] / 2 + 90 + walk); next[x * n + y] = y;
      T[y * n + x] = Math.min(T[y * n + x], headway[x] / 2 + 90 + walk); next[y * n + x] = x;
    }
  }
  if (n <= 420) {
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
      const tik = T[i * n + k];
      if (tik >= 1e8) continue;
      for (let j = 0; j < n; j++) {
        const t = tik + T[k * n + j];
        if (t < T[i * n + j]) { T[i * n + j] = t; next[i * n + j] = next[i * n + k]; M[i * n + j] = Math.max(M[i * n + k], M[k * n + j]); }
      }
    }
  }
  return { version: world.stopVersion, states, T, next, M, n, stateOf, stopStates, headway };
}

/** Walk the next-pointer matrix to list line segments used by a path (line id + boarding/alighting stop). */
export function pathLines(tn: TransitNet, a: number, b: number): { line: ID; from: ID; to: ID }[] {
  const out: { line: ID; from: ID; to: ID }[] = [];
  let cur = a, guard = 0;
  let curLine = -1, boardStop = 0;
  while (cur !== b && guard++ < 80) {
    const nx = tn.next[cur * tn.n + b];
    if (nx < 0) break;
    const sa = tn.states[cur], sb = tn.states[nx];
    if (sa.line === sb.line) {
      if (curLine !== sa.line) { curLine = sa.line; boardStop = sa.stop; }
    } else {
      if (curLine === sa.line) out.push({ line: curLine, from: boardStop, to: sa.stop });
      curLine = -1;
    }
    cur = nx;
    if (cur === b && curLine !== -1) out.push({ line: curLine, from: boardStop, to: tn.states[cur].stop });
  }
  return out;
}

export function stopCatchment(world: World, s: TransitStop, tn?: TransitNet): number {
  if (s.kind === 'bus') return TRANSIT.bus.catchment;
  if (s.kind === 'terminal') return 9;
  if (s.kind === 'metro') return TRANSIT.metro.catchment;
  if (s.kind === 'suburban') return TRANSIT.suburban.catchment;
  return TRANSIT.regional.catchment;
}

export function nodeForStop(world: World, s: TransitStop): ID | 0 {
  const e = world.net.edges.get(s.edge);
  if (!e) return 0;
  return nearestNodeOf(world.net, e, s.s);
}
export { DEFS };
