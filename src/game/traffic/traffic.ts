import type { World } from '../world';
import { ID, RoadEdge, TILE_M, Vehicle, VehicleKind, RoadNode, Mode } from '../types';
import { findRoute, nearestNodeOf, Route } from '../transportation/pathfinding';
import { pointAt, leftNormal } from '../roads/geometry';
import { CATEGORY_RANK, LANE_W, laneOffset, SIDEWALK_W, carriageHalf } from '../roads/spec';
import { Assigner, TripRec, HOURLY, HOURLY_FREIGHT, hourFactor } from '../transportation/demand';
import { Freight } from '../transportation/freight';
import { TRANSIT, isRoadMode } from '../transportation/transit';
import { DEFS } from '../../data/buildings';
import { clamp } from '../../utils/math';
import { Rng } from '../../utils/rng';

/** Visual time compression: 1 km/h on the map moves this many tiles per real second ×. */
export const VIS = 4.2;
export const GAME_MIN_PER_SEC = 15;
export const SEC_PER_GAME_HOUR = 60 / GAME_MIN_PER_SEC;
const kph = (v: number) => (v / 3.6 / TILE_M) * VIS;

export interface KindSpec { len: number; vmax: number; width: number; heavy: boolean; accel: number }
export const KIND: Record<VehicleKind, KindSpec> = {
  car: { len: 0.3, vmax: 70, width: 0.12, heavy: false, accel: 1.0 },
  taxi: { len: 0.3, vmax: 65, width: 0.12, heavy: false, accel: 1.0 },
  motorcycle: { len: 0.2, vmax: 70, width: 0.06, heavy: false, accel: 1.6 },
  scooter: { len: 0.19, vmax: 55, width: 0.06, heavy: false, accel: 1.3 },
  auto: { len: 0.24, vmax: 45, width: 0.09, heavy: false, accel: 0.9 },
  bicycle: { len: 0.18, vmax: 15, width: 0.04, heavy: false, accel: 0.5 },
  bus: { len: 0.6, vmax: 55, width: 0.14, heavy: true, accel: 0.55 },
  ebus: { len: 0.6, vmax: 55, width: 0.14, heavy: true, accel: 0.7 },
  artibus: { len: 0.85, vmax: 50, width: 0.14, heavy: true, accel: 0.45 },
  minibus: { len: 0.42, vmax: 55, width: 0.11, heavy: false, accel: 0.8 },
  lorry: { len: 0.6, vmax: 55, width: 0.14, heavy: true, accel: 0.4 },
  container: { len: 0.78, vmax: 55, width: 0.14, heavy: true, accel: 0.35 },
  tanker: { len: 0.7, vmax: 50, width: 0.14, heavy: true, accel: 0.35 },
  construction: { len: 0.55, vmax: 45, width: 0.14, heavy: true, accel: 0.4 },
  minitruck: { len: 0.34, vmax: 55, width: 0.1, heavy: false, accel: 0.8 },
  van: { len: 0.36, vmax: 60, width: 0.11, heavy: false, accel: 0.9 },
  ambulance: { len: 0.38, vmax: 85, width: 0.12, heavy: false, accel: 1.2 },
  fire: { len: 0.56, vmax: 75, width: 0.14, heavy: true, accel: 0.8 },
  police: { len: 0.3, vmax: 85, width: 0.12, heavy: false, accel: 1.2 },
};
const isTwo = (k: VehicleKind) => k === 'motorcycle' || k === 'scooter' || k === 'bicycle';
export const isBusKind = (k: VehicleKind) => k === 'bus' || k === 'ebus' || k === 'artibus' || k === 'minibus';

interface SignalPhase { edges: Set<ID>; green: number }
interface SignalPlan { phases: SignalPhase[]; cycle: number; offset: number; yellow: number }

export interface Ped { id: ID; x: number; y: number; z: number; ang: number; route: number[]; dirs: number[]; ri: number; s: number; speed: number; side: number; color: number; kind: number; edgeAt: ID }
export interface Train { id: ID; line: ID; pos: number; v: number; dwell: number; stopIdx: number; x: number; y: number; z: number; ang: number; cars: number; color: number; mode: string; loopLen: number }

export class Traffic {
  vehicles: Vehicle[] = [];
  peds: Ped[] = [];
  trains: Train[] = [];
  assigner = new Assigner();
  freight = new Freight();
  boxes = new Map<ID, Vehicle[]>();
  plans = new Map<ID, SignalPlan>();
  planTopo = -1;
  planKey = '';
  time = 0;
  frame = 0;
  vid = 1;
  spawnAcc = 0; pedAcc = 0; frtAcc = 0; emgAcc = 0; busAcc = 0;
  maxVehicles = 520;
  maxPeds = 380;
  rng: Rng;
  approach = new Map<ID, { rank: number; n: number }>();
  debug = { spawned: 0, despawned: 0, blocked: 0, rerouted: 0, gridlock: 0, pathMs: 0, pathCalls: 0, spawnFail: 0, kScale: 1 };

  constructor(world: World) { this.rng = world.rng; }

  reset() { this.vehicles = []; this.peds = []; this.trains = []; this.boxes.clear(); }

  /** Advance the visual traffic. `dt` is physical seconds, `m` is the game speed multiplier. */
  step(world: World, dt: number, m: number) {
    this.frame++;
    this.time += dt;
    this.ensurePlans(world);
    this.purge(world);
    this.spawnPassenger(world, dt, m, Math.min(3, m));
    this.spawnFreight(world, dt, m);
    this.spawnBuses(world);
    this.spawnPeds(world, dt, m);
    this.spawnEmergency(world, dt, m);
    this.collectApproaches(world);
    this.moveVehicles(world, dt);
    this.moveBoxes(world, dt);
    this.movePeds(world, dt);
    this.moveTrains(world, dt);
  }

  // ───────── signals ─────────
  private ensurePlans(world: World) {
    const key = `${world.net.topoVersion}|${[...world.net.nodes.values()].reduce((a, n) => a + (n.control === 'auto' ? 0 : n.control.length) + n.cycle + n.mainShare * 10, 0).toFixed(1)}`;
    if (key === this.planKey) return;
    this.planKey = key;
    this.plans.clear();
    for (const nd of world.net.nodes.values()) {
      if (world.net.resolveControl(nd) !== 'signal') continue;
      this.plans.set(nd.id, this.makePlan(world, nd));
    }
  }

  private makePlan(world: World, nd: RoadNode): SignalPlan {
    const arms = nd.edges.map((id) => world.net.edges.get(id)!).filter(Boolean).map((e) => {
      const ang = e.a === nd.id ? Math.atan2(e.pts[3] - e.pts[1], e.pts[2] - e.pts[0]) : Math.atan2(e.pts[e.pts.length - 3] - e.pts[e.pts.length - 1], e.pts[e.pts.length - 4] - e.pts[e.pts.length - 2]);
      return { e, ang };
    });
    const used = new Set<number>();
    const groups: { edges: ID[]; rank: number }[] = [];
    for (let i = 0; i < arms.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      const g = { edges: [arms[i].e.id], rank: CATEGORY_RANK[arms[i].e.spec.category] };
      for (let j = i + 1; j < arms.length; j++) {
        if (used.has(j)) continue;
        let d = Math.abs(arms[i].ang - arms[j].ang) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d > Math.PI * 0.72) { used.add(j); g.edges.push(arms[j].e.id); g.rank = Math.max(g.rank, CATEGORY_RANK[arms[j].e.spec.category]); }
      }
      groups.push(g);
    }
    groups.sort((a, b) => b.rank - a.rank);
    const P = groups.length;
    const yellow = 3, allRed = 1;
    const green = Math.max(8, nd.cycle - P * (yellow + allRed));
    const phases: SignalPhase[] = groups.map((g, i) => {
      let share = 1 / P;
      if (P === 2) share = i === 0 ? nd.mainShare : 1 - nd.mainShare;
      return { edges: new Set(g.edges), green: green * share };
    });
    return { phases, cycle: phases.reduce((a, p) => a + p.green + yellow + allRed, 0), offset: ((nd.x * 7.3 + nd.y * 3.1) % 1) * nd.cycle, yellow };
  }

  /** 0 red, 1 green, 2 yellow */
  signal(plan: SignalPlan, edgeId: ID): number {
    let t = (this.time + plan.offset) % plan.cycle;
    for (const ph of plan.phases) {
      const span = ph.green + plan.yellow + 1;
      if (t < span) {
        if (!ph.edges.has(edgeId)) return 0;
        return t < ph.green ? 1 : t < ph.green + plan.yellow ? 2 : 0;
      }
      t -= span;
    }
    return 0;
  }

  // ───────── spawning ─────────
  private purge(world: World) {
    const edges = world.net.edges;
    let w = 0;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      let ok = true;
      if (v.state === 'drive' || v.state === 'dwell' || v.state === 'wait') {
        const e = edges.get(v.route[v.ri]);
        if (!e) ok = false;
        else if (!e.lanes![v.lane] || e.lanes![v.lane].indexOf(v) < 0) ok = false;
      } else if (!world.net.nodes.has(v.boxNode)) ok = false;
      if (ok) this.vehicles[w++] = v;
      else { this.debug.despawned++; const e = edges.get(v.route[v.ri]); if (e?.lanes) for (const l of e.lanes) { const k = l.indexOf(v); if (k >= 0) l.splice(k, 1); } const bx = this.boxes.get(v.boxNode); if (bx) { const k = bx.indexOf(v); if (k >= 0) bx.splice(k, 1); } }
    }
    this.vehicles.length = w;
  }

  private purposeRate(purpose: number, hour: number, outbound: boolean): number {
    const g = (c: number, w: number) => Math.exp(-Math.pow((hour - c) / w, 2));
    if (purpose === 0) return outbound ? g(8.4, 1.6) + 0.05 : g(18, 2) + 0.05;
    if (purpose === 1) return outbound ? g(7.8, 1.1) + 0.02 : g(14.8, 1.8) + 0.04;
    return outbound ? g(11, 3) * 0.7 + g(17.5, 2.2) * 0.8 + 0.03 : g(13, 3) * 0.5 + g(19.5, 2.2) * 0.9 + 0.03;
  }

  private pickTrip(world: World, hour: number, want: (t: TripRec) => number): { t: TripRec; outbound: boolean } | null {
    const trips = this.assigner.trips;
    if (!trips.length) return null;
    const rng = this.rng;
    let best: TripRec | null = null, bs = 0, bo = true;
    for (let i = 0; i < 12; i++) {
      const t = trips[Math.floor(rng() * trips.length)];
      if (!t.route) continue;
      const outbound = rng() < 0.5;
      const s = want(t) * this.purposeRate(t.purpose, hour, outbound) * (0.4 + rng());
      if (s > bs) { bs = s; best = t; bo = outbound; }
    }
    return best ? { t: best, outbound: bo } : null;
  }

  private newVehicle(kind: VehicleKind, route: number[], dirs: number[]): Vehicle {
    const k = KIND[kind];
    const rng = this.rng;
    return {
      id: this.vid++, kind, route, routeDir: dirs, ri: 0, s: 0, v: 0, lane: 0, sub: 0, vmax: k.vmax * (0.88 + rng() * 0.22), len: k.len, color: 0, state: 'drive', dwell: 0, heavy: k.heavy,
      lineId: 0, stopIdx: 0, age: 0, x: 0, y: 0, z: 0, ang: 0, waitTime: 0, purpose: 0, stamp: 0, variant: Math.floor(rng() * 3), lat: 0, boxNode: 0, boxLeft: 0, emergency: false, stopS: -1, trip: 0,
    };
  }

  private route(world: World, from: ID, to: ID, kind: 'car' | 'heavy' | 'bus' | 'bike' | 'walk'): Route | null {
    const t0 = performance.now();
    const r = findRoute(world.graph, from, to, kind);
    this.debug.pathMs = this.debug.pathMs * 0.95 + (performance.now() - t0) * 0.05;
    this.debug.pathCalls++;
    return r;
  }

  /** Put a vehicle on its first edge if there's room. */
  private place(world: World, v: Vehicle, startS = 0.05): boolean {
    const e = world.net.edges.get(v.route[0]);
    if (!e) return false;
    const dir = v.routeDir[0];
    const lane = this.chooseLane(world, v, e, dir, v.route[1], v.routeDir[1]);
    if (lane < 0) return false;
    const arr = e.lanes![lane];
    if (arr.length && arr[0].s < startS + arr[0].len + v.len + 0.05) { this.debug.spawnFail++; return false; }
    v.ri = 0; v.lane = lane; v.s = startS; v.v = Math.min(0.4, kph(e.spec.speed) * 0.3); v.state = 'drive'; v.stamp = this.frame;
    arr.unshift(v);
    this.vehicles.push(v);
    this.debug.spawned++;
    return true;
  }

  private spawnPassenger(world: World, dt: number, m: number, f: number) {
    const A = this.assigner;
    if (!A.trips.length) return;
    const hour = world.hour;
    let dv = 0;
    for (let i = 0; i < A.trips.length; i += 7) { const t = A.trips[i]; dv += t.weight * 2 * ((t.p.two ?? 0) + (t.p.car ?? 0) + (t.p.auto ?? 0) + (t.p.cycle ?? 0)) * 7; }
    const full = (dv * hourFactor(HOURLY, hour) * m) / SEC_PER_GAME_HOUR;
    const avgDur = 24 / f;
    const cap = this.maxVehicles - this.countKinds(true);
    const rate = Math.min(full, Math.max(0, cap) / avgDur * 1.3);
    this.debug.kScale = Math.max(1, full / Math.max(0.01, rate));
    this.spawnAcc += rate * dt;
    let guard = 0;
    while (this.spawnAcc >= 1 && guard++ < 8) {
      this.spawnAcc -= 1;
      if (this.vehicles.length >= this.maxVehicles) break;
      const pick = this.pickTrip(world, hour, (t) => (t.p.two ?? 0) + (t.p.car ?? 0) + (t.p.auto ?? 0) + (t.p.cycle ?? 0));
      if (!pick) continue;
      const { t, outbound } = pick;
      const a = outbound ? t.from : t.to, b = outbound ? t.to : t.from;
      if (a === b) continue;
      const rng = this.rng;
      const P = t.p;
      const wts: [Mode, number][] = [['two', P.two ?? 0], ['car', P.car ?? 0], ['auto', P.auto ?? 0], ['cycle', P.cycle ?? 0]];
      let tot = 0; for (const w of wts) tot += w[1];
      if (tot <= 0) continue;
      let x = rng() * tot, mode: Mode = 'car';
      for (const [mm, w] of wts) { x -= w; if (x <= 0) { mode = mm; break; } }
      const r = this.route(world, a, b, mode === 'cycle' ? 'bike' : 'car');
      if (!r || r.edges.length === 0) continue;
      const kind: VehicleKind = mode === 'two' ? (rng() < 0.55 ? 'scooter' : 'motorcycle') : mode === 'auto' ? 'auto' : mode === 'cycle' ? 'bicycle' : rng() < 0.07 ? 'taxi' : 'car';
      const v = this.newVehicle(kind, r.edges, r.dirs);
      v.purpose = t.purpose;
      v.color = Math.floor(rng() * 8);
      v.sub = rng() < 0.5 ? -1 : 1;
      this.place(world, v);
    }
  }

  private countKinds(light: boolean) { let c = 0; for (const v of this.vehicles) if (light ? !v.heavy || v.kind === 'bus' : v.heavy) c++; return light ? c - 0 : c; }

  private spawnFreight(world: World, dt: number, m: number) {
    const F = this.freight;
    if (!F.flows.length) return;
    const hf = hourFactor(HOURLY_FREIGHT, world.hour);
    let daily = 0;
    for (const f of F.flows) if (f.route) daily += f.perDay * 2;
    const full = (daily * hf * m) / SEC_PER_GAME_HOUR;
    const rate = Math.min(full, 5);
    this.frtAcc += rate * dt;
    while (this.frtAcc >= 1) {
      this.frtAcc -= 1;
      if (this.vehicles.length >= this.maxVehicles + 80) break;
      let x = this.rng() * daily;
      let flow = F.flows[0];
      for (const f of F.flows) { if (!f.route) continue; x -= f.perDay * 2; if (x <= 0) { flow = f; break; } }
      const outbound = this.rng() < 0.5;
      const r = this.route(world, outbound ? flow.from : flow.to, outbound ? flow.to : flow.from, 'heavy');
      if (!r || !r.edges.length) continue;
      const v = this.newVehicle(flow.kind, r.edges, r.dirs);
      v.color = Math.floor(this.rng() * 8);
      v.purpose = 9;
      this.place(world, v);
    }
  }

  private spawnBuses(world: World) {
    this.busAcc += 1;
    if (this.busAcc < 12) return;
    this.busAcc = 0;
    for (const l of world.lines.values()) {
      if (!l.active || !l.rt || !isRoadMode(l.mode)) continue;
      const have = this.vehicles.filter((v) => v.lineId === l.id);
      if (have.length >= l.vehicles) {
        // retire extras
        if (have.length > l.vehicles) { const v = have[have.length - 1]; this.remove(world, v); }
        continue;
      }
      const rt = l.rt;
      const kind: VehicleKind = l.mode === 'ebus' ? 'ebus' : l.mode === 'artibus' ? 'artibus' : l.mode === 'minibus' ? 'minibus' : 'bus';
      const v = this.newVehicle(kind, rt.route, rt.routeDir);
      v.lineId = l.id; v.color = l.color; v.stopIdx = 0; v.purpose = 8;
      // spread buses along the loop
      const startMark = rt.marks[(have.length * 3) % rt.marks.length];
      const e = world.net.edges.get(rt.route[startMark.ri]);
      if (!e) continue;
      const dir = rt.routeDir[startMark.ri];
      const lane = this.chooseLane(world, v, e, dir, rt.route[startMark.ri + 1], rt.routeDir[startMark.ri + 1]);
      if (lane < 0) continue;
      const s = dir === 0 ? startMark.s : e.len - startMark.s;
      const arr = e.lanes![lane];
      let clear = true;
      for (const o of arr) if (Math.abs(o.s - s) < 0.8) clear = false;
      if (!clear) continue;
      v.ri = startMark.ri; v.s = clamp(s - 0.1, 0.02, e.len - 0.1); v.lane = lane; v.v = 0.2;
      v.stopIdx = rt.marks.findIndex((mk) => mk.ri >= v.ri);
      if (v.stopIdx < 0) v.stopIdx = 0;
      arr.push(v); arr.sort((p, q) => p.s - q.s);
      this.vehicles.push(v);
      this.debug.spawned++;
    }
  }

  private spawnEmergency(world: World, dt: number, m: number) {
    this.emgAcc += dt * m;
    if (this.emgAcc < 70) return;
    this.emgAcc = 0;
    const picks: { kind: VehicleKind; from: Building | undefined }[] = [];
    type Building = import('../types').Building;
    const list: Record<string, Building[]> = { health: [], fire: [], police: [] };
    for (const b of world.buildings.values()) {
      if (b.progress < 1 || !b.access) continue;
      const s = DEFS[b.def].service;
      if (s === 'health' && b.def !== 'clinic') list.health.push(b);
      if (s === 'fire') list.fire.push(b);
      if (s === 'police') list.police.push(b);
    }
    const kinds: [VehicleKind, Building[]][] = [['ambulance', list.health], ['fire', list.fire], ['police', list.police]];
    for (const [k, l] of kinds) if (l.length) picks.push({ kind: k, from: l[Math.floor(this.rng() * l.length)] });
    if (!picks.length) return;
    const p = picks[Math.floor(this.rng() * picks.length)];
    const homes = [...world.buildings.values()].filter((b) => b.residents > 0 && b.access);
    if (!homes.length || !p.from) return;
    const dest = homes[Math.floor(this.rng() * homes.length)];
    const fe = world.net.edges.get(p.from.access), de = world.net.edges.get(dest.access);
    if (!fe || !de) return;
    const r = this.route(world, nearestNodeOf(world.net, fe, p.from.accessS), nearestNodeOf(world.net, de, dest.accessS), 'car');
    if (!r || !r.edges.length) return;
    const v = this.newVehicle(p.kind, r.edges, r.dirs);
    v.emergency = true; v.purpose = 7;
    this.place(world, v);
  }

  private remove(world: World, v: Vehicle) {
    const e = world.net.edges.get(v.route[v.ri]);
    if (e?.lanes) for (const l of e.lanes) { const k = l.indexOf(v); if (k >= 0) l.splice(k, 1); }
    const bi = this.vehicles.indexOf(v);
    if (bi >= 0) this.vehicles.splice(bi, 1);
    const bx = this.boxes.get(v.boxNode);
    if (bx) { const k = bx.indexOf(v); if (k >= 0) bx.splice(k, 1); }
    this.debug.despawned++;
  }

  // ───────── lane choice ─────────
  private laneRange(e: RoadEdge, dir: number): [number, number] {
    const F = e.spec.lanesFwd, B = e.spec.lanesBwd;
    return dir === 0 ? [0, F] : [F, F + B];
  }

  private chooseLane(world: World, v: Vehicle, e: RoadEdge, dir: number, nextEdge?: number, nextDir?: number): number {
    const [a, b] = this.laneRange(e, dir);
    if (b <= a) return -1;
    const bus = isBusKind(v.kind) || v.emergency;
    const sp = e.spec;
    let lo = a, hi = b - 1;
    if (sp.bus === 'busonly') { if (!bus) return -1; }
    else if (sp.bus === 'dedicated' && b - a > 1) { if (bus) hi = lo; else lo = a + 1; }
    // turn preference (left-hand traffic: kerb lane is index a)
    let pref = 0;
    if (nextEdge !== undefined && nextDir !== undefined) {
      const ne = world.net.edges.get(nextEdge);
      if (ne) {
        const node = dir === 0 ? e.b : e.a;
        pref = this.turnSide(e, dir, ne, nextDir, node);
      }
    }
    const slow = v.heavy || v.kind === 'auto' || v.kind === 'bicycle';
    let best = -1, bs = 1e9;
    for (let l = lo; l <= hi; l++) {
      const arr = e.lanes![l];
      let load = arr.length * 1.0;
      const tail = arr[0];
      if (tail && tail.s < 0.3) load += 6;
      const j = l - a; // 0 = kerb
      const frac = hi > lo ? (l - lo) / (hi - lo) : 0; // 0 kerb … 1 median
      if (slow) load += frac * 2.2;
      if (pref < 0) load += frac * 3; else if (pref > 0) load += (1 - frac) * 3;
      load += this.rng() * 0.4 + j * 0.001;
      if (load < bs) { bs = load; best = l; }
    }
    return best;
  }

  /** -1 for a left turn, 1 for right, 0 straight (left-hand traffic uses kerb lane for left turns). */
  private turnSide(e: RoadEdge, dir: number, ne: RoadEdge, nd: number, _node: ID): number {
    const inA = dir === 0 ? Math.atan2(e.pts[e.pts.length - 1] - e.pts[e.pts.length - 3], e.pts[e.pts.length - 2] - e.pts[e.pts.length - 4]) : Math.atan2(e.pts[1] - e.pts[3], e.pts[0] - e.pts[2]);
    const outA = nd === 0 ? Math.atan2(ne.pts[3] - ne.pts[1], ne.pts[2] - ne.pts[0]) : Math.atan2(ne.pts[ne.pts.length - 3] - ne.pts[ne.pts.length - 1], ne.pts[ne.pts.length - 4] - ne.pts[ne.pts.length - 2]);
    let d = outA - inA;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d < -0.5 ? -1 : d > 0.5 ? 1 : 0;
  }

  // ───────── movement ─────────
  private collectApproaches(world: World) {
    this.approach.clear();
    for (const e of world.net.edges.values()) {
      const rank = CATEGORY_RANK[e.spec.category];
      for (let li = 0; li < e.lanes!.length; li++) {
        const arr = e.lanes![li];
        const v = arr[arr.length - 1];
        if (!v) continue;
        if (e.len - v.s > 0.9 || v.v < 0.12) continue;
        const dir = li < e.spec.lanesFwd ? 0 : 1;
        const node = dir === 0 ? e.b : e.a;
        const cur = this.approach.get(node);
        if (!cur) this.approach.set(node, { rank, n: 1 }); else { cur.rank = Math.max(cur.rank, rank); cur.n++; }
      }
    }
  }

  private canEnter(world: World, v: Vehicle, e: RoadEdge, dir: number, nodeId: ID): boolean {
    const node = world.net.nodes.get(nodeId);
    if (!node) return true;
    const ctrl = world.net.resolveControl(node);
    const box = this.boxes.get(nodeId);
    const occ = box ? box.length : 0;
    const limit = ctrl === 'signal' ? 55 : 14;
    if (v.waitTime > limit) { if (occ >= 3) this.debug.gridlock++; return occ < 8; }
    if (ctrl === 'none') return occ < 3;
    if (ctrl === 'signal') {
      const plan = this.plans.get(nodeId);
      if (!plan) return occ < 2;
      const st = this.signal(plan, e.id);
      if (v.emergency) return occ < 4;
      if (isBusKind(v.kind) && node.busPriority && st !== 1 && e.len - v.s < 0.5 && v.v > 0.4) return occ < 3;
      if (st === 1) return occ < 5;
      if (st === 2) return v.v > 0.5 && e.len - v.s < 0.2 && occ < 4;
      return false;
    }
    if (ctrl === 'roundabout') return occ < 3;
    // priority: yield to higher-ranked approaches
    const myRank = CATEGORY_RANK[e.spec.category];
    const ap = this.approach.get(nodeId);
    if (ap && ap.rank > myRank && !v.emergency) return false;
    return occ < 2;
  }

  private moveVehicles(world: World, dt: number) {
    const net = world.net;
    const frame = this.frame;
    const rain = world.rain;
    const rng = this.rng;
    for (const e of net.edges.values()) {
      const L = e.len;
      const lanes = e.lanes!;
      const F = e.spec.lanesFwd;
      for (let li = 0; li < lanes.length; li++) {
        const arr = lanes[li];
        if (arr.length === 0) continue;
        const dir = li < F ? 0 : 1;
        // keep ordered (insertion sort; nearly sorted)
        for (let i = 1; i < arr.length; i++) { const x = arr[i]; let j = i - 1; while (j >= 0 && arr[j].s > x.s) { arr[j + 1] = arr[j]; j--; } arr[j + 1] = x; }
        const edgeKph = Math.max(6, e.speedNow![dir]);
        for (let i = arr.length - 1; i >= 0; i--) {
          const v = arr[i];
          if (v.stamp === frame) continue;
          v.stamp = frame;
          const ks = KIND[v.kind];
          let vfree = Math.min(kph(edgeKph), kph(v.vmax)) * (v.emergency ? 1.25 : 1);
          if (e.spec.category === 'local' || e.spec.category === 'service') vfree *= 0.9;
          if (v.kind === 'bicycle') vfree = kph(14) * (1 - rain * 0.2);
          // ─ obstacle ahead
          let gap = 1e9, lv = 0;
          const leader = i < arr.length - 1 ? arr[i + 1] : null;
          const filtering = isTwo(v.kind) && v.kind !== 'bicycle';
          if (leader) {
            const lTwo = isTwo(leader.kind);
            if (filtering && !lTwo && leader.v < vfree * 0.3 && (leader.s - v.s) < 1.2) {
              // slip alongside slow or stopped four-wheelers
              v.lat += ((v.sub * 0.5 * LANE_W - v.lat)) * Math.min(1, dt * 5);
              const g = leader.s - leader.len * 0.5 - v.s - 0.02;
              if (g < 0.02 && leader.v < 0.12) { /* squeeze past */ } else { gap = Math.max(0.08, g); lv = Math.max(leader.v, kph(10)); }
              if (leader.v < vfree * 0.3) { gap = 1e9; lv = 0; v.vmax = Math.max(v.vmax, 20); }
            } else {
              if (!(filtering && lTwo && Math.abs(leader.lat - v.lat) > 0.04)) { gap = leader.s - leader.len * 0.5 - v.len * 0.5 - v.s; lv = leader.v; }
            }
          } else {
            const nextId = v.route[v.ri + 1];
            if (nextId !== undefined) {
              const ne = net.edges.get(nextId);
              if (ne) {
                const nd = v.routeDir[v.ri + 1];
                const [a, b] = this.laneRange(ne, nd);
                const nl = Math.min(b - 1, Math.max(a, a + (v.lane - (dir === 0 ? 0 : F)))); 
                const tail = ne.lanes![nl]?.[0];
                if (tail) { const g = (L - v.s) + tail.s - tail.len * 0.5 - v.len * 0.5; if (g < gap) { gap = g; lv = tail.v; } }
              }
            }
          }
          // ─ node control
          const rem = L - v.s;
          const hasNext = v.ri < v.route.length - 1;
          if (hasNext && rem < 2.4) {
            const nodeId = dir === 0 ? e.b : e.a;
            if (!this.canEnter(world, v, e, dir, nodeId)) {
              const g = rem - 0.06 - v.len * 0.5;
              if (g < gap) { gap = g; lv = 0; }
            }
          }
          // ─ bus stop approach
          if (v.lineId && v.state === 'drive') {
            const l = world.lines.get(v.lineId);
            const mk = l?.rt?.marks[v.stopIdx];
            if (mk && mk.ri === v.ri) {
              const target = dir === 0 ? mk.s : e.len - mk.s;
              const g = target - v.s - v.len * 0.4;
              if (g < gap) { gap = g; lv = 0; }
              if (g < 0.1 && v.v < 0.2) { v.state = 'dwell'; v.dwell = 3.2 + rng() * 2.5; this.board(world, v, mk.stop); }
            }
          }
          // ─ random roadside auto pickups where no stand organises them
          if (v.kind === 'auto' && v.state === 'drive' && rem > 1 && v.s > 0.8) {
            const k = world.idx((e.pts[0] + e.pts[e.pts.length - 2]) / 2, (e.pts[1] + e.pts[e.pts.length - 1]) / 2);
            const need = world.fields.autoDen[k] * (1 - world.fields.standCov[k]);
            if (need > 0.25 && rng() < 0.02 * need * dt) { v.state = 'dwell'; v.dwell = 1.5 + rng() * 2; }
          }
          if (v.state === 'dwell') {
            v.v = 0; v.dwell -= dt;
            if (v.dwell <= 0) { v.state = 'drive'; if (v.lineId) { const l = world.lines.get(v.lineId); if (l?.rt) v.stopIdx = (v.stopIdx + 1) % l.rt.marks.length; } }
            this.pose(world, v, e, dir);
            continue;
          }
          // ─ Krauss-style safe speed
          const bdec = 3.4 * (v.heavy ? 0.8 : 1), tau = 0.45;
          const vsafe = -bdec * tau + Math.sqrt((bdec * tau) ** 2 + lv * lv + 2 * bdec * Math.max(0, gap - 0.05));
          const vt = Math.max(0, Math.min(vfree, vsafe));
          const acc = (1.5 * ks.accel + 0.3) ;
          if (vt > v.v) v.v = Math.min(vt, v.v + acc * dt); else v.v = Math.max(vt, v.v - bdec * 2.2 * dt);
          if (v.v < 0.05) v.waitTime += dt; else v.waitTime = Math.max(0, v.waitTime - dt * 2);
          if (v.waitTime > 150) { this.remove(world, v); continue; }
          v.s += v.v * dt;
          // ─ lane changes: overtake slow leaders where lanes allow
          if (leader && !filtering && v.state === 'drive' && gap < 0.45 && lv < vfree * 0.7 && rng() < 4 * dt) this.tryLaneChange(world, e, dir, v, i);
          if (!filtering) v.lat *= 1 - Math.min(1, dt * 4);
          else if (!leader || leader.v > vfree * 0.3) v.lat *= 1 - Math.min(1, dt * 4);
          // ─ reached end of edge
          if (v.s >= L) {
            if (!hasNext) {
              if (v.lineId) {
                v.ri = 0; v.s = 0; v.stopIdx = 0; arr.splice(i, 1);
                const ne0 = net.edges.get(v.route[0]);
                if (ne0) { const dd = v.routeDir[0]; const ln = this.chooseLane(world, v, ne0, dd, v.route[1], v.routeDir[1]); if (ln >= 0) { v.lane = ln; ne0.lanes![ln].unshift(v); const l = world.lines.get(v.lineId); const mk = l?.rt?.marks[0]; v.s = mk ? (dd === 0 ? mk.s : ne0.len - mk.s) - 0.15 : 0; v.s = Math.max(0, v.s); } else this.remove(world, v); }
                else this.remove(world, v);
              } else { arr.splice(i, 1); const bi = this.vehicles.indexOf(v); if (bi >= 0) this.vehicles.splice(bi, 1); this.debug.despawned++; }
              continue;
            }
            // enter junction box
            const nodeId = dir === 0 ? e.b : e.a;
            arr.splice(i, 1);
            v.state = 'wait'; v.boxNode = nodeId; v.boxLeft = 0.3;
            let bx = this.boxes.get(nodeId);
            if (!bx) this.boxes.set(nodeId, (bx = []));
            bx.push(v);
            // occasionally re-plan around congestion
            if (!v.lineId && !v.emergency && rng() < 0.18) this.maybeReroute(world, v);
            continue;
          }
          this.pose(world, v, e, dir);
        }
      }
    }
  }

  private maybeReroute(world: World, v: Vehicle) {
    const nextId = v.route[v.ri + 1];
    const ne = world.net.edges.get(nextId);
    if (!ne) return;
    const nd = v.routeDir[v.ri + 1];
    if ((ne.flowVc?.[nd] ?? 0) < 1.1) return;
    const lastId = v.route[v.route.length - 1];
    const le = world.net.edges.get(lastId);
    if (!le) return;
    const dest = v.routeDir[v.route.length - 1] === 0 ? le.b : le.a;
    const cur = world.net.edges.get(v.route[v.ri]);
    if (!cur) return;
    const node = v.boxNode;
    const r = this.route(world, node, dest, v.heavy ? 'heavy' : 'car', );
    if (!r || r.edges.length === 0) return;
    // accept only if it differs from the current plan
    if (r.edges[0] === nextId) return;
    v.route = [...v.route.slice(0, v.ri + 1), ...r.edges];
    v.routeDir = [...v.routeDir.slice(0, v.ri + 1), ...r.dirs];
    this.debug.rerouted++;
  }

  private board(world: World, v: Vehicle, stopId: ID) {
    const s = world.stops.get(stopId);
    if (s) s.boarded += 1 + Math.floor(this.rng() * 6);
  }

  private tryLaneChange(world: World, e: RoadEdge, dir: number, v: Vehicle, idx: number) {
    const [a, b] = this.laneRange(e, dir);
    const opts = [v.lane - 1, v.lane + 1].filter((l) => l >= a && l < b);
    if (!opts.length) return;
    const bus = isBusKind(v.kind) || v.emergency;
    for (const l of opts.sort(() => this.rng() - 0.5)) {
      if (e.spec.bus === 'busonly' && !bus) continue;
      if (e.spec.bus === 'dedicated' && b - a > 1 && !bus && l === a) continue;
      if (e.spec.bus === 'dedicated' && b - a > 1 && bus && l !== a && !v.emergency) continue;
      const arr = e.lanes![l];
      let ok = true;
      for (const o of arr) { if (o.s > v.s - o.len - 0.12 && o.s < v.s + v.len + 0.35) { ok = false; break; } }
      if (!ok) continue;
      const cur = e.lanes![v.lane];
      const k = cur.indexOf(v);
      if (k >= 0) cur.splice(k, 1);
      arr.push(v); arr.sort((p, q) => p.s - q.s);
      v.lane = l;
      return;
    }
    void idx;
  }

  private moveBoxes(world: World, dt: number) {
    const net = world.net;
    for (const [nid, arr] of this.boxes) {
      const node = net.nodes.get(nid);
      if (!node) { this.boxes.delete(nid); continue; }
      for (let i = arr.length - 1; i >= 0; i--) {
        const v = arr[i];
        const e1 = net.edges.get(v.route[v.ri]);
        const e2 = net.edges.get(v.route[v.ri + 1]);
        if (!e1 || !e2) { arr.splice(i, 1); const bi = this.vehicles.indexOf(v); if (bi >= 0) this.vehicles.splice(bi, 1); continue; }
        const ctrl = net.resolveControl(node);
        const speed = Math.max(0.35, v.v) * (ctrl === 'roundabout' ? 0.6 : 1);
        if (v.boxLeft > 0) { v.boxLeft -= speed * dt; v.v = Math.max(v.v, 0.3); }
        else {
          const nd = v.routeDir[v.ri + 1];
          const lane = this.chooseLane(world, v, e2, nd, v.route[v.ri + 2], v.routeDir[v.ri + 2]);
          v.waitTime += dt;
          if (lane < 0) { if (v.waitTime > 6) { arr.splice(i, 1); const bi = this.vehicles.indexOf(v); if (bi >= 0) this.vehicles.splice(bi, 1); } continue; }
          const dst = e2.lanes![lane];
          const tail = dst[0];
          if (tail && tail.s < tail.len + v.len * 0.6 && v.waitTime < 8) { v.v = 0; this.poseBox(world, v, e1, e2, node, 1); continue; }
          arr.splice(i, 1);
          v.ri++; v.lane = lane; v.s = 0.02; v.state = 'drive'; v.stamp = this.frame; v.waitTime = 0; v.lat = 0;
          dst.unshift(v);
          if (v.lineId) { const l = world.lines.get(v.lineId); const mk = l?.rt?.marks[v.stopIdx]; if (mk && mk.ri < v.ri) { v.stopIdx = l!.rt!.marks.findIndex((q) => q.ri >= v.ri); if (v.stopIdx < 0) v.stopIdx = 0; } }
          continue;
        }
        this.poseBox(world, v, e1, e2, node, clamp(1 - v.boxLeft / 0.3, 0, 1));
      }
    }
  }

  private poseBox(world: World, v: Vehicle, e1: RoadEdge, e2: RoadEdge, node: RoadNode, t: number) {
    const d1 = v.routeDir[v.ri], d2 = v.routeDir[v.ri + 1];
    const a = this.edgePose(e1, d1, v.lane, e1.len, v.lat, 0);
    const lane2 = Math.max(0, Math.min(e2.lanes!.length - 1, d2 === 0 ? 0 : e2.spec.lanesFwd));
    const b = this.edgePose(e2, d2, lane2, 0, 0, 0);
    v.x = a.x + (b.x - a.x) * t; v.y = a.y + (b.y - a.y) * t; v.z = a.z + (b.z - a.z) * t;
    let da = b.ang - a.ang;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    v.ang = a.ang + da * t;
    void node; void world;
  }

  /** World-space pose (tile coords, metres z, heading) at distance s of travel on an edge. */
  edgePose(e: RoadEdge, dir: number, lane: number, s: number, lat: number, extra: number) {
    const ss = dir === 0 ? s : e.len - s;
    const p = pointAt(e.pts, e.cum, ss);
    const ang = dir === 0 ? p.ang : p.ang + Math.PI;
    const j = lane - (dir === 0 ? 0 : e.spec.lanesFwd);
    const off = laneOffset(e.spec, dir, Math.max(0, j)) + lat + extra;
    const [nx, ny] = leftNormal(ang);
    const z0 = e.zs[p.i] ?? 0, z1 = e.zs[p.i + 1] ?? z0;
    return { x: p.x + nx * off, y: p.y + ny * off, z: z0 + (z1 - z0) * p.t, ang };
  }

  private pose(world: World, v: Vehicle, e: RoadEdge, dir: number) {
    const p = this.edgePose(e, dir, v.lane, Math.min(v.s, e.len), v.lat, 0);
    v.x = p.x; v.y = p.y; v.z = p.z; v.ang = p.ang;
  }

  // ───────── pedestrians ─────────
  private spawnPeds(world: World, dt: number, m: number) {
    const A = this.assigner;
    const hour = world.hour;
    if (!A.trips.length) return;
    let dw = 0;
    for (let i = 0; i < A.trips.length; i += 7) dw += A.trips[i].weight * 2 * ((A.trips[i].p.walk ?? 0) + 0.35 * (A.trips[i].p.bus ?? 0) + 0.5 * (A.trips[i].p.metro ?? 0)) * 7;
    const full = (dw * hourFactor(HOURLY, hour) * m * (1 - world.rain * 0.5)) / SEC_PER_GAME_HOUR;
    const rate = Math.min(full, Math.max(0, this.maxPeds - this.peds.length) / 40);
    this.pedAcc += rate * dt;
    while (this.pedAcc >= 1) {
      this.pedAcc -= 1;
      if (this.peds.length >= this.maxPeds) break;
      const pick = this.pickTrip(world, hour, (t) => (t.p.walk ?? 0) + 0.35 * (t.p.bus ?? 0) + 0.5 * (t.p.metro ?? 0) + 0.02);
      if (!pick || !pick.t.route) continue;
      const { t, outbound } = pick;
      const rr = outbound ? t.route! : null;
      let r = rr;
      if (!r) r = this.route(world, t.to, t.from, 'walk');
      if (!r || !r.edges.length) continue;
      // pedestrians cover one to three blocks of the route (transit users walk to stops)
      const k = Math.min(r.edges.length, 1 + Math.floor(this.rng() * 3));
      const start = Math.floor(this.rng() * Math.max(1, r.edges.length - k + 1));
      this.addPed(world, r.edges.slice(start, start + k), r.dirs.slice(start, start + k));
    }
    // street life: loiter near high-activity edges (markets, stations, schools)
    if (this.peds.length < this.maxPeds * 0.6 && this.rng() < dt * 3) {
      const edges = [...world.net.edges.values()];
      if (edges.length) {
        let best: RoadEdge | null = null, bs = 0;
        for (let i = 0; i < 6; i++) {
          const e = edges[Math.floor(this.rng() * edges.length)];
          const sc = (e.stat?.ped ?? 0) * (SIDEWALK_W[e.spec.sidewalk] > 0 ? 1 : 0.3) * (0.5 + this.rng());
          if (sc > bs) { bs = sc; best = e; }
        }
        if (best && bs > 2 && best.structure !== 'tunnel') this.addPed(world, [best.id], [this.rng() < 0.5 ? 0 : 1]);
      }
    }
  }

  private addPed(world: World, edges: number[], dirs: number[]) {
    const rng = this.rng;
    const e0 = world.net.edges.get(edges[0]);
    if (!e0 || e0.structure === 'tunnel') return;
    this.peds.push({ id: this.vid++, x: 0, y: 0, z: 0, ang: 0, route: edges, dirs, ri: 0, s: 0, speed: 0.1 + rng() * 0.05, side: rng() < 0.5 ? 1 : -1, color: Math.floor(rng() * 10), kind: rng() < 0.12 ? 1 : 0, edgeAt: edges[0] });
  }

  private movePeds(world: World, dt: number) {
    const net = world.net;
    const pm = 1 - world.rain * 0.4;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const e = net.edges.get(p.route[p.ri]);
      if (!e) { this.peds.splice(i, 1); continue; }
      p.s += p.speed * VIS * 0.55 * pm * dt * (e.spec.sidewalk === 'none' ? 0.8 : 1);
      if (p.s >= e.len) {
        p.s = 0; p.ri++;
        if (p.ri >= p.route.length) { this.peds.splice(i, 1); continue; }
      }
      const e2 = net.edges.get(p.route[p.ri]);
      if (!e2) { this.peds.splice(i, 1); continue; }
      const dir = p.dirs[p.ri];
      const pt = pointAt(e2.pts, e2.cum, dir === 0 ? p.s : e2.len - p.s);
      const ang = dir === 0 ? pt.ang : pt.ang + Math.PI;
      const half = carriageHalf(e2.spec);
      const sw = SIDEWALK_W[e2.spec.sidewalk];
      const off = (half + (sw > 0 ? sw * 0.5 + (e2.spec.bike === 'protected' || e2.spec.bike === 'track' ? 0.12 : 0.02) : 0.03)) * p.side;
      const [nx, ny] = leftNormal(ang);
      p.x = pt.x + nx * off; p.y = pt.y + ny * off; p.ang = ang;
      const z0 = e2.zs[pt.i] ?? 0, z1 = e2.zs[pt.i + 1] ?? z0;
      p.z = z0 + (z1 - z0) * pt.t;
      p.edgeAt = e2.id;
    }
  }

  // ───────── trains ─────────
  private moveTrains(world: World, dt: number) {
    // maintain train counts per line
    const byLine = new Map<ID, Train[]>();
    for (const t of this.trains) { const a = byLine.get(t.line) ?? []; a.push(t); byLine.set(t.line, a); }
    for (const l of world.lines.values()) {
      if (isRoadMode(l.mode) || !l.rt || !l.active) continue;
      const have = byLine.get(l.id)?.length ?? 0;
      const loopLen = l.rt.loopCum[l.rt.loopCum.length - 1] ?? 0;
      if (loopLen <= 0) continue;
      for (let i = have; i < l.vehicles; i++) {
        this.trains.push({ id: this.vid++, line: l.id, pos: (loopLen * i) / Math.max(1, l.vehicles), v: 0, dwell: 0, stopIdx: 0, x: 0, y: 0, z: 0, ang: 0, cars: l.mode === 'metro' ? 4 : 6, color: l.color, mode: l.mode, loopLen });
      }
      if (have > l.vehicles) { let k = have - l.vehicles; for (let i = this.trains.length - 1; i >= 0 && k > 0; i--) if (this.trains[i].line === l.id) { this.trains.splice(i, 1); k--; } }
    }
    this.trains = this.trains.filter((t) => { const l = world.lines.get(t.line); return l && l.active && l.rt && !isRoadMode(l.mode); });
    for (const t of this.trains) {
      const l = world.lines.get(t.line)!;
      const rt = l.rt!;
      const spec = TRANSIT[l.mode];
      const vmax = kph(spec.speedKph) * 1.15;
      const stops = rt.loopStopS;
      t.loopLen = rt.loopCum[rt.loopCum.length - 1];
      // nearest upcoming stop distance
      let next = Infinity;
      for (const s of stops) { let d = s - t.pos; if (d < -0.05) d += t.loopLen; if (d < next) next = d; }
      if (t.dwell > 0) { t.dwell -= dt; t.v = 0; }
      else {
        const brake = (t.v * t.v) / (2 * 0.9);
        const target = next < brake + 0.1 ? Math.max(0.12, Math.min(vmax, Math.sqrt(2 * 0.9 * Math.max(0, next)))) : vmax;
        t.v += clamp(target - t.v, -1.4 * dt, 0.6 * dt);
        if (next < 0.06 && t.v < 0.2) { t.dwell = spec.dwell / 6 + 1.5; t.pos += 0.07; t.v = 0; }
      }
      t.pos = (t.pos + t.v * dt) % t.loopLen;
      const p = pointAt(rt.loop, rt.loopCum, t.pos);
      t.x = p.x; t.y = p.y; t.ang = p.ang;
      const z0 = rt.loopZ[p.i] ?? 0, z1 = rt.loopZ[p.i + 1] ?? z0;
      t.z = z0 + (z1 - z0) * p.t;
    }
  }

  // ───────── debug ─────────
  counts() {
    const heavy = this.vehicles.filter((v) => v.heavy).length;
    return { vehicles: this.vehicles.length, peds: this.peds.length, trains: this.trains.length, heavy };
  }
}

export { findRoute, DEFS };
