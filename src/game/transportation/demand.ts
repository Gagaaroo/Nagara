import type { World } from '../world';
import { Building, Citizen, ID, Mode, RoadEdge, TILE_M } from '../types';
import { Route, findRoute, nearestNodeOf } from './pathfinding';
import { NV, VI } from '../roads/network';
import { bikeScore, capacityDir, walkScore, STRUCTURE_CAP } from '../roads/spec';
import { STRUCTURE_CAP as SC } from '../roads/spec';
import { TRANSIT, buildTransitNet, modeGroup, pathLines, stopCatchment, TransitNet } from './transit';
import { clamp, sat } from '../../utils/math';
import { DEFS } from '../../data/buildings';

/** Share of daily trips beginning in each hour (passenger traffic, two peaks). */
export const HOURLY = (() => {
  const raw = [0.008, 0.005, 0.004, 0.004, 0.01, 0.026, 0.055, 0.092, 0.098, 0.066, 0.05, 0.05, 0.056, 0.05, 0.046, 0.052, 0.064, 0.086, 0.092, 0.07, 0.044, 0.028, 0.016, 0.011];
  const s = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / s);
})();
export const HOURLY_FREIGHT = (() => {
  const raw = [0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.05, 0.05, 0.06, 0.06, 0.05, 0.04, 0.03, 0.04, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.04];
  const s = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / s);
})();

export function hourFactor(table: number[], hour: number): number {
  const h0 = Math.floor(hour) % 24, h1 = (h0 + 1) % 24, f = hour - Math.floor(hour);
  return table[h0] * (1 - f) + table[h1] * f;
}

export const PCE: Record<number, number> = { [VI.two]: 0.35, [VI.car]: 1, [VI.auto]: 0.8, [VI.bus]: 2.3, [VI.truck]: 2.8 };

export interface TripRec {
  cit: Citizen;
  purpose: 0 | 1 | 2; // work, school, leisure
  weight: number; // round trips per day
  from: ID; to: ID;
  fromB: Building; toB: Building;
  route: Route | null;
  p: Partial<Record<Mode, number>>;
  distKm: number;
  timeMin: number;
  transit?: { lines: ID[]; mode: 'bus' | 'metro' | 'rail'; access: string };
}

const VOT = [1.0, 2.6, 6.5];

function routeProps(world: World, r: Route) {
  let L = 0, walk = 0, bike = 0, grade = 0, vc = 0, park = 0;
  for (let i = 0; i < r.edges.length; i++) {
    const e = world.net.edges.get(r.edges[i]);
    if (!e) continue;
    L += e.len;
    walk += e.len * walkScore(e.spec);
    bike += e.len * bikeScore(e.spec);
    const dz = Math.abs((e.zs[e.zs.length - 1] ?? 0) - (e.zs[0] ?? 0));
    grade += dz;
    vc += e.len * Math.max(e.flowVc?.[r.dirs[i]] ?? 0, 0);
    park += e.len * (e.spec.parking === 'none' ? 0 : 1);
  }
  L = Math.max(L, 0.01);
  return { walk: walk / L, bike: bike / L, grade: grade / (L * TILE_M), vc: vc / L, park: park / L };
}

const hash = (id: number) => ((id * 2654435761) >>> 0) % 100;

export class Assigner {
  trips: TripRec[] = [];
  cursor = 0;
  built = false;
  private acc = new Map<ID, Float32Array>();
  private sums = this.freshSums();
  published = false;
  tn: TransitNet | null = null;
  passes = 0;
  lastPublish = { trips: 0 };

  private freshSums() {
    return { modal: {} as Record<string, number>, timeW: 0, w: 0, distW: 0, commT: 0, commW: 0, unreach: 0, lm: { walk: 0, auto: 0, bike: 0 } as Record<string, number>, lineRiders: new Map<ID, number>(), stopBoard: new Map<ID, number>(), heavy: 0 };
  }

  rebuild(world: World) {
    const trips: TripRec[] = [];
    for (const c of world.citizens) {
      const hb = world.buildings.get(c.home);
      if (!hb || !hb.access) continue;
      const mk = (purpose: 0 | 1 | 2, toId: ID, weight: number) => {
        const tb = world.buildings.get(toId);
        if (!tb || !tb.access || weight <= 0) return;
        const he = world.net.edges.get(hb.access), te = world.net.edges.get(tb.access);
        if (!he || !te) return;
        trips.push({ cit: c, purpose, weight, from: nearestNodeOf(world.net, he, hb.accessS), to: nearestNodeOf(world.net, te, tb.accessS), fromB: hb, toB: tb, route: null, p: {}, distKm: 0, timeMin: 0 });
      };
      if (c.earners && c.work) mk(0, c.work, c.earners * 0.93);
      if (c.students && c.school) mk(1, c.school, c.students * 0.95);
      if (c.shop) mk(2, c.shop, c.members * 0.5);
    }
    this.trips = trips;
    this.cursor = 0;
    this.built = true;
    world.assignDirty = false;
  }

  /** Process up to `budget` trips; publishes volumes when a full pass completes. */
  step(world: World, budget: number) {
    if (world.assignDirty || !this.built) this.rebuild(world);
    if (!this.tn || this.tn.version !== world.stopVersion) { this.tn = buildTransitNet(world); world.transitNet = this.tn; }
    if (this.trips.length === 0) { this.publish(world); return; }
    const n = Math.min(budget, this.trips.length - this.cursor);
    for (let i = 0; i < n; i++) this.process(world, this.trips[this.cursor++]);
    if (this.cursor >= this.trips.length) { this.publish(world); this.cursor = 0; }
  }

  private process(world: World, t: TripRec) {
    const S = this.sums;
    const c = t.cit;
    const F = world.fields;
    const r = findRoute(world.graph, t.from, t.to, 'car');
    t.route = r;
    if (!r) {
      S.unreach += t.weight;
      if (t.purpose === 0) c.reach = false;
      t.p = {}; t.distKm = 0; t.timeMin = 0;
      return;
    }
    if (t.purpose === 0) c.reach = true;
    const eu = Math.hypot(t.fromB.ax - t.toB.ax, t.fromB.ay - t.toB.ay);
    const lenTiles = Math.max(r.length, eu, 0.4);
    const distM = lenTiles * TILE_M * 1.04 + 40;
    const km = distM / 1000;
    const props = routeProps(world, r);
    const wealth = c.wealth;
    const vot = VOT[wealth] ?? 2.6;
    const rain = world.rain;
    const gradeF = clamp(1 - props.grade * 3.2, 0.4, 1);
    const U: Partial<Record<Mode, number>> = {};
    const tmin: Partial<Record<Mode, number>> = {};
    // walking
    {
      const q = clamp(props.walk, 0.05, 1);
      const tt = distM / (1.3 * gradeF * (0.5 + 0.5 * q)) / 60;
      tmin.walk = tt;
      U.walk = tt * (1.1 + (1 - q) * 0.5 + rain * 0.9) + Math.max(0, tt - 18) * 2.5 + rain * 5;
    }
    // cycling
    if (hash(c.id) < [30, 24, 12][wealth] && km < 10) {
      const q = clamp(props.bike, 0.05, 1);
      const tt = distM / (4.1 * gradeF) / 60;
      tmin.cycle = tt;
      U.cycle = tt * (1.15 + (1 - q) * 0.7 + rain * 1.1) + 4 + rain * 6 + Math.max(0, tt - 30) * 2;
    }
    // two-wheeler
    if (c.hasTwo) {
      const tt = r.time * 0.88 / 60 + 1.4;
      tmin.two = tt;
      U.two = tt + (1.5 * km) / vot + 1 + rain * 3;
    }
    // car
    if (c.hasCar) {
      const kd = world.idx(t.toB.ax, t.toB.ay);
      const pk = 1.2 + 6 * sat(F.popDen[kd] * 0.7 + F.jobDen[kd] * 0.8) * (1 - 0.25 * props.park);
      const tt = r.time / 60 + pk;
      tmin.car = tt;
      U.car = tt + (6 * km + (F.jobDen[kd] > 0.7 ? 18 : 0)) / vot - 1.5;
    }
    // auto-rickshaw
    {
      const ko = world.idx(t.fromB.ax, t.fromB.ay);
      const stand = F.standCov[ko];
      const wait = (5 - 3.2 * stand) / (1 + F.autoDen[ko] * 0.9);
      const tt = r.time * 1.04 / 60 + wait;
      tmin.auto = tt;
      U.auto = tt + (26 + 13 * km) / vot + 1.5 - rain * 3;
    }
    // transit
    const tr = this.transitOption(world, t);
    if (tr) { U[tr.mode as Mode] = tr.minutes + tr.fare / vot + tr.transfers * 3 - rain * 4 + 1; tmin[tr.mode as Mode] = tr.minutes; }
    // logit
    let tot = 0;
    const P: Partial<Record<Mode, number>> = {};
    for (const m of Object.keys(U) as Mode[]) { const v = Math.exp(-(U[m]!) / 6); P[m] = v; tot += v; }
    let tAvg = 0;
    for (const m of Object.keys(P) as Mode[]) { P[m] = P[m]! / tot; tAvg += P[m]! * (tmin[m] ?? 0); }
    t.p = P;
    t.distKm = km;
    t.timeMin = tAvg;
    if (t.purpose === 0) { c.commuteMin = tAvg; c.commuteKm = km; }
    else if (t.purpose === 1) { /* school */ }
    // choose a dominant mode per purpose for the citizen record
    let top: Mode = 'walk', tp = -1;
    for (const m of Object.keys(P) as Mode[]) if (P[m]! > tp) { tp = P[m]!; top = m; }
    if (t.purpose === 0) c.commuteMode = top; else if (t.purpose === 1) c.schoolMode = top; else c.leisureMode = top;
    // accumulate flows
    const w = t.weight;
    S.w += w * 2;
    S.timeW += w * 2 * tAvg;
    S.distW += w * 2 * km;
    if (t.purpose === 0) { S.commT += w * tAvg; S.commW += w; }
    for (const m of Object.keys(P) as Mode[]) {
      const share = P[m]! * w;
      S.modal[m] = (S.modal[m] ?? 0) + share * 2;
    }
    const addFlow = (idx: number, share: number) => {
      if (share <= 0) return;
      for (let i = 0; i < r.edges.length; i++) {
        let a = this.acc.get(r.edges[i]);
        if (!a) this.acc.set(r.edges[i], (a = new Float32Array(NV * 2)));
        a[r.dirs[i] * NV + idx] += share; // outbound
        a[(1 - r.dirs[i]) * NV + idx] += share; // return trip
      }
    };
    addFlow(VI.walk, (P.walk ?? 0) * w);
    addFlow(VI.bike, (P.cycle ?? 0) * w);
    addFlow(VI.two, (P.two ?? 0) * w);
    addFlow(VI.car, (P.car ?? 0) * w);
    addFlow(VI.auto, (P.auto ?? 0) * w);
    if (tr) {
      t.transit = { lines: tr.lines.map((l) => l.line), mode: tr.mode, access: tr.access };
      const share = (P[tr.mode as Mode] ?? 0) * w * 2; // boardings/day
      for (const l of tr.lines) S.lineRiders.set(l.line, (S.lineRiders.get(l.line) ?? 0) + share);
      if (tr.lines.length) S.stopBoard.set(tr.lines[0].from, (S.stopBoard.get(tr.lines[0].from) ?? 0) + share);
      S.lm[tr.access] = (S.lm[tr.access] ?? 0) + share;
    } else t.transit = undefined;
  }

  private transitOption(world: World, t: TripRec) {
    const tn = this.tn;
    if (!tn || tn.n === 0) return null;
    const F = world.fields;
    const ko = world.idx(t.fromB.ax, t.fromB.ay), kd = world.idx(t.toB.ax, t.toB.ay);
    const access = (x: number, y: number, k: number, stopId: ID) => {
      const s = world.stops.get(stopId)!;
      const d = Math.hypot(s.x - x, s.y - y);
      const cat = stopCatchment(world, s);
      const sw = clamp(F.sidewalk[k] * 0.7 + 0.3, 0.25, 1);
      const slope = world.terrain.slope[k];
      const walkT = (d * TILE_M * 1.2) / (1.3 * clamp(1 - slope / 0.12, 0.35, 1) * sw) / 60 * (1 + world.rain * 0.4);
      let best = walkT, how = 'walk';
      const standNear = Math.max(F.standCov[k], F.autoDen[k] > 0.45 ? 0.25 : 0);
      if (d > 3) {
        const autoT = 2 + (1 - standNear) * 5 + (d * TILE_M * 1.2) / 5.5 / 60;
        if (autoT + 0.5 < best) { best = autoT; how = 'auto'; }
        if (F.bike[k] > 0.3) { const bT = 2.5 + (d * TILE_M * 1.2) / 4 / 60; if (bT < best) { best = bT; how = 'bike'; } }
      }
      const maxD = cat * 1.9;
      if (d > maxD || best > 30) return null;
      return { t: best, how, cost: how === 'auto' ? 18 + 6 * d * TILE_M / 1000 : 0 };
    };
    const cand = (x: number, y: number, k: number) => {
      const list: { state: number; acc: NonNullable<ReturnType<typeof access>>; stop: ID }[] = [];
      for (const [sid, states] of tn.stopStates) {
        const a = access(x, y, k, sid);
        if (!a) continue;
        for (const st of states) list.push({ state: st, acc: a, stop: sid });
      }
      list.sort((p, q) => p.acc.t - q.acc.t);
      return list.slice(0, 8);
    };
    const A = cand(t.fromB.ax, t.fromB.ay, ko);
    if (!A.length) return null;
    const B = cand(t.toB.ax, t.toB.ay, kd);
    if (!B.length) return null;
    let best: { total: number; a: typeof A[0]; b: typeof B[0] } | null = null;
    for (const a of A) for (const b of B) {
      if (a.stop === b.stop) continue;
      const T = tn.T[a.state * tn.n + b.state];
      if (T >= 1e8) continue;
      const lineA = world.lines.get(tn.states[a.state].line);
      const crowd = lineA ? 1 + Math.max(0, lineA.loadFactor - 0.75) * 1.6 : 1;
      const total = a.acc.t + tn.headway[a.state] / 120 + (T / 60) * crowd + b.acc.t;
      if (!best || total < best.total) best = { total, a, b };
    }
    if (!best) return null;
    const lines = pathLines(tn, best.a.state, best.b.state);
    if (!lines.length) return null;
    const rank = tn.M[best.a.state * tn.n + best.b.state];
    const mainLine = lines.reduce((p, q) => ((world.lines.get(q.line)?.mode === 'metro') ? q : p), lines[0]);
    const ml = world.lines.get(mainLine.line);
    const mode = ml ? modeGroup(ml.mode) : 'bus';
    void rank;
    const km = t.distKm || 3;
    const fare = mode === 'bus' ? world.policies.fare : mode === 'metro' ? world.policies.fare * 1.2 + 6 + km * 2 : world.policies.fare * 1.2 + 5 + km * 1.6;
    const lastLegs = best.b.acc.how;
    void lastLegs;
    return { minutes: best.total, fare: fare + best.a.acc.cost + best.b.acc.cost, transfers: Math.max(0, lines.length - 1), mode, lines, access: best.a.acc.how };
  }

  /** A full pass finished: publish smoothed volumes, mode split and line ridership. */
  publish(world: World) {
    const S = this.sums;
    const st = world.stats;
    const smooth = this.published ? 0.55 : 1;
    // edge volumes
    for (const e of world.net.edges.values()) {
      const a = this.acc.get(e.id);
      const v = e.vol!;
      for (let d = 0; d < 2; d++) for (const idx of [VI.walk, VI.bike, VI.two, VI.car, VI.auto]) {
        const nv = a ? a[d * NV + idx] : 0;
        v[d * NV + idx] = v[d * NV + idx] * (1 - smooth) + nv * smooth;
      }
    }
    this.acc.clear();
    // buses per day from active road lines
    for (const e of world.net.edges.values()) { e.vol![VI.bus] = 0; e.vol![NV + VI.bus] = 0; e.stat!.busLines = 0; }
    for (const l of world.lines.values()) {
      if (!l.active || !l.rt || !TRANSIT[l.mode].road) continue;
      const perDay = (20 * 60) / Math.max(2, l.headwayMin);
      const rt = l.rt;
      const touched = new Set<ID>();
      for (let i = 0; i < rt.route.length; i++) {
        const e = world.net.edges.get(rt.route[i]);
        if (!e) continue;
        e.vol![rt.routeDir[i] * NV + VI.bus] += perDay;
        touched.add(e.id);
      }
      for (const id of touched) { const e = world.net.edges.get(id); if (e) e.stat!.busLines++; }
    }
    // stats
    const modal = S.modal;
    const total = Object.values(modal).reduce((a, b) => a + b, 0) || 1;
    st.modal = {};
    for (const m of ['walk', 'cycle', 'two', 'car', 'auto', 'bus', 'metro', 'rail']) st.modal[m] = (modal[m] ?? 0) / total;
    st.trips = S.w;
    st.avgDistKm = S.w > 0 ? S.distW / S.w : 0;
    st.avgCommuteMin = S.commW > 0 ? S.commT / S.commW : 0;
    st.unreachable = S.unreach;
    // line ridership & loads (daily → keep as per-day numbers, smoothed)
    for (const l of world.lines.values()) {
      const daily = S.lineRiders.get(l.id) ?? 0;
      l.ridersToday = l.ridersToday * (1 - smooth) + daily * smooth;
      const spec = TRANSIT[l.mode];
      const tripsPerDay = (20 * 60) / Math.max(2, l.headwayMin);
      const capacity = tripsPerDay * 2 * spec.capacity * 0.5;
      l.loadFactor = capacity > 0 ? clamp(l.ridersToday / capacity * 1.6, 0, 2.5) : 0;
      l.revenue = l.ridersToday * (l.mode === 'metro' ? world.policies.fare * 1.5 : world.policies.fare) * 30 / 1e5;
    }
    for (const [id, v] of S.stopBoard) { const s = world.stops.get(id); if (s) s.waiting = s.waiting * 0.5 + v * 0.5; }
    st.ridership = [...world.lines.values()].reduce((a, l) => a + l.ridersToday, 0);
    this.sums = this.freshSums();
    this.published = true;
    this.passes++;
  }
}

/** Refresh hourly flow, capacity, congestion and travel times of every edge. */
export function updateEdgeTimes(world: World) {
  const hour = world.hour;
  const hp = hourFactor(HOURLY, hour);
  const hf = hourFactor(HOURLY_FREIGHT, hour);
  const rain = world.rain;
  const F = world.fields, n = world.n;
  const weather = 1 - 0.3 * rain;
  let flowSum = 0, delaySum = 0, speedSum = 0, lenSum = 0;
  const nodeVc = new Map<ID, number>();
  for (const e of world.net.edges.values()) {
    const v = e.vol!;
    const st = e.stat!;
    const mx = Math.floor((e.pts[0] + e.pts[e.pts.length - 2]) / 2), my = Math.floor((e.pts[1] + e.pts[e.pts.length - 1]) / 2);
    const k = Math.max(0, Math.min(n * n - 1, my * n + mx));
    const flood = world.floodDepth[k];
    const aN = world.nodes_get(e.a), bN = world.nodes_get(e.b);
    let junc = 1;
    for (const nd of [aN, bN]) {
      if (!nd) continue;
      const c = world.net.resolveControl(nd);
      junc *= c === 'signal' ? 0.92 : c === 'priority' && nd.edges.length >= 3 ? 0.95 : c === 'roundabout' ? 0.97 : 1;
      if (nd.turnLanes && c !== 'none') junc *= 1.06;
    }
    if (e.len < 2.2 && (aN?.edges.length ?? 0) >= 3 && (bN?.edges.length ?? 0) >= 3 && e.spec.category !== 'local') junc *= 0.88;
    const friction = 1 - 0.2 * sat(F.autoDen[k] * (1 - F.standCov[k]) * (e.spec.category === 'local' || e.spec.category === 'collector' ? 1 : 0.4));
    const dz = Math.abs((e.zs[e.zs.length - 1] ?? 0) - (e.zs[0] ?? 0)) / Math.max(1, e.len * TILE_M);
    const free = e.spec.speed * clamp(1 - dz * 2.4, 0.6, 1) * (e.structure === 'tunnel' ? 0.92 : 1) * weather * (flood > 0.15 ? 0.55 : 1);
    const tot: number[] = [0, 0];
    for (let d = 0; d < 2; d++) {
      const cap = capacityDir(e.spec, d) * SC[e.structure] * junc * friction;
      let pce = 0;
      for (const idx of [VI.two, VI.car, VI.auto, VI.bus]) pce += v[d * NV + idx] * hp * PCE[idx];
      pce += v[d * NV + VI.truck] * hf * PCE[VI.truck];
      const vc = cap > 1 ? pce / cap : 0;
      e.flowVc![d] = vc;
      const bpr = 1 / (1 + 0.8 * Math.pow(Math.max(vc, 0), 3.2));
      const sp = Math.max(4, free * Math.max(0.12, bpr));
      e.speedNow![d] = sp;
      e.tt![d] = (e.len * TILE_M) / (sp / 3.6);
      tot[d] = pce;
      if (cap > 0) {
        const f = pce;
        flowSum += f * e.len; delaySum += f * e.len * (1 - Math.max(0.12, bpr)); speedSum += f * e.len * sp; lenSum += f * e.len;
        for (const nid of [e.a, e.b]) nodeVc.set(nid, Math.max(nodeVc.get(nid) ?? 0, vc));
      }
    }
    e.cap = capacityDir(e.spec, 0) * SC[e.structure] * junc * friction;
    st.car = (v[VI.car] + v[NV + VI.car]) * hp;
    st.two = (v[VI.two] + v[NV + VI.two]) * hp;
    st.auto = (v[VI.auto] + v[NV + VI.auto]) * hp;
    st.bus = (v[VI.bus] + v[NV + VI.bus]) / 20 / 2;
    st.truck = (v[VI.truck] + v[NV + VI.truck]) * hf;
    st.ped = (v[VI.walk] + v[NV + VI.walk]) * hp * 1.1;
    st.bike = (v[VI.bike] + v[NV + VI.bike]) * hp;
    st.total = st.car + st.two + st.auto + st.bus + st.truck;
  }
  for (const nd of world.net.nodes.values()) {
    const vc = nodeVc.get(nd.id) ?? 0;
    const c = world.net.resolveControl(nd);
    const q = Math.max(0, vc - 0.65);
    nd.delay = c === 'signal' ? 0.25 * nd.cycle * (1 + 3 * q) * (nd.turnLanes ? 0.9 : 1) : c === 'priority' ? 3 + 25 * Math.pow(q, 1.2) : c === 'roundabout' ? 2.5 + 15 * Math.max(0, vc - 0.85) : 0;
    nd.queue = Math.round(vc * 8);
  }
  const s = world.stats;
  s.congestion = lenSum > 0 ? delaySum / lenSum : 0;
  s.avgSpeed = lenSum > 0 ? speedSum / lenSum : 0;
  void flowSum; void STRUCTURE_CAP;
}

export { SC };
