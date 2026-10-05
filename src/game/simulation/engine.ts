import { World } from '../world';
import { Traffic, GAME_MIN_PER_SEC } from '../traffic/traffic';
import { updateAccessibility, updateCoverage, updateDensity, updateLandValue, updatePollution } from './fields';
import { assignDestinations, constructionStep, growthStep, occupancyStep, recount, upgradeStep } from '../population/growth';
import { cityIdentity, dailyEconomy, sprawlIndex, updateHappiness } from '../economy/economy';
import { floodStep, weatherHour, weatherTick } from '../weather/weather';
import { updateEdgeTimes } from '../transportation/demand';
import { DEFS } from '../../data/buildings';
import { Vendor, ID } from '../types';
import { pointAt } from '../roads/geometry';
import { SIDEWALK_W, carriageHalf } from '../roads/spec';
import { recomputeLine } from '../transportation/transit';
import { clamp } from '../../utils/math';

export const SPEEDS = [0, 1, 4, 12];
export const MILESTONES = [
  { pop: 500, text: 'A small town: roads, houses, shops, autos and two-wheelers.' },
  { pop: 2500, text: 'Traffic is picking up. Collectors, signals and bus routes matter now.' },
  { pop: 10000, text: 'Traffic is significant. Arterials, bus terminals and traffic management unlocked.' },
  { pop: 25000, text: 'A dense city. Metro, IT districts and high-density towers unlock.' },
  { pop: 50000, text: 'A metropolis. Regional rail, major logistics and transport hubs unlock.' },
];

/** Drives the whole simulation: clock, scheduling and systems. Independent of any renderer. */
export class Simulation {
  traffic: Traffic;
  speedIndex = 1;
  private fieldJob = 0;
  private fieldTimer = 0;
  private edgeTimer = 0;
  private lastHour = -1;
  private lastDay = -1;
  private lastMonth = -1;
  private lineVersion = -1;
  private jobTimer = 0;
  private freightTimer = 0;
  private statTimer = 0;
  autosave: ((w: World) => void) | null = null;
  debug = { simMs: 0, fps: 0, jobMs: {} as Record<string, number> };

  constructor(public world: World) {
    this.traffic = new Traffic(world);
    // warm up fields so the first frame has data
    updateDensity(world); updateCoverage(world); updateLandValue(world); updateAccessibility(world);
    world.stats.sprawl = sprawlIndex(world);
    this.lastHour = Math.floor(world.hour);
    this.lastDay = Math.floor(world.day);
    this.lastMonth = world.month;
    updateEdgeTimes(world);
  }

  get speed() { return SPEEDS[this.speedIndex]; }
  setSpeed(i: number) { this.speedIndex = clamp(i, 0, SPEEDS.length - 1); }

  /** Advance by a real-time delta (seconds). */
  update(realDt: number) {
    const t0 = performance.now();
    const w = this.world;
    const m = this.speed;
    realDt = Math.min(realDt, 0.1);
    this.refreshDirty();
    if (m > 0) {
      // physical traffic time is capped so vehicles never tunnel at high speed
      const phys = realDt * Math.min(m, 3);
      const sub = Math.ceil(phys / 0.05);
      for (let i = 0; i < sub; i++) this.traffic.step(w, phys / sub, m * (1 / sub) * (sub === 0 ? 1 : 1) * 1);
      weatherTick(w, realDt * Math.min(m, 4));
      // clock
      w.minute += realDt * m * GAME_MIN_PER_SEC;
      while (w.minute >= 1440) { w.minute -= 1440; w.day += 1; }
      const hour = Math.floor(w.hour);
      if (hour !== this.lastHour) { this.lastHour = hour; this.onHour(); }
      const day = Math.floor(w.day);
      if (day !== this.lastDay) { this.lastDay = day; this.onDay(); }
      if (w.month !== this.lastMonth) { this.lastMonth = w.month; this.onMonth(); }
    }
    // background analytics keep running even when paused so building feedback is live
    this.fieldTimer += realDt;
    if (this.fieldTimer > (m > 0 ? 1.0 : 0.6)) { this.fieldTimer = 0; this.runFieldJob(); }
    this.edgeTimer += realDt;
    if (this.edgeTimer > 0.5) { this.edgeTimer = 0; updateEdgeTimes(w); }
    this.traffic.assigner.step(w, 70);
    this.freightTimer += realDt;
    if (this.freightTimer > 1.5) {
      this.freightTimer = 0;
      const F = this.traffic.freight;
      if (w.freightDirty) F.rebuild(w);
      F.assign(w);
    }
    this.statTimer += realDt;
    if (this.statTimer > 0.8) { this.statTimer = 0; this.refreshStats(); }
    this.debug.simMs = this.debug.simMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private refreshDirty() {
    const w = this.world;
    if (w.accessDirty) w.refreshAccess();
    // lines recompute when stops/network change
    if (this.lineVersion !== w.net.topoVersion + w.stopVersion * 10007) {
      this.lineVersion = w.net.topoVersion + w.stopVersion * 10007;
      for (const l of w.lines.values()) {
        const ok = recomputeLine(w, l);
        if (!ok && l.active === false) { /* stays inactive until the player fixes it */ }
      }
      this.traffic.assigner.tn = null;
    }
  }

  private runFieldJob() {
    const w = this.world;
    const jobs: [string, () => void][] = [
      ['density', () => updateDensity(w)],
      ['coverage', () => updateCoverage(w)],
      ['pollution', () => updatePollution(w)],
      ['landvalue', () => updateLandValue(w)],
      ['access', () => updateAccessibility(w)],
      ['happy', () => updateHappiness(w)],
    ];
    const [name, fn] = jobs[this.fieldJob % jobs.length];
    this.fieldJob++;
    const t0 = performance.now();
    fn();
    this.debug.jobMs[name] = performance.now() - t0;
  }

  private refreshStats() {
    const w = this.world;
    const c = this.traffic.counts();
    w.stats.vehicles = c.vehicles;
    w.stats.peds = c.peds;
    let ptPop = 0, lm = 0, walk = 0, bike = 0, pw = 0;
    const F = w.fields;
    for (const b of w.buildings.values()) {
      if (b.progress < 1 || !b.residents) continue;
      const k = w.idx(b.x + b.w / 2, b.y + b.h / 2);
      const r = b.residents;
      pw += r;
      if (F.pt[k] > 0.12) ptPop += r;
      lm += F.lastMile[k] * r;
      walk += F.walk[k] * r;
      bike += F.bike[k] * r;
    }
    w.stats.ptCoverage = pw ? ptPop / pw : 0;
    w.stats.lastMile = pw ? lm / pw : 0;
    w.stats.walkAccess = pw ? walk / pw : 0;
    w.stats.bikeAccess = pw ? bike / pw : 0;
    w.stats.vendors = w.vendors.length;
    // heavy share of visible traffic
    if (c.vehicles > 10) w.stats.heavyPct = w.stats.heavyPct * 0.7 + (c.heavy / c.vehicles) * 0.3;
  }

  private onHour() {
    const w = this.world;
    weatherHour(w);
    floodStep(w, 1);
    growthStep(w);
    if (w.assignDirty || Math.floor(w.hour) % 3 === 0) { assignDestinations(w); }
    updateVendors(w);
  }

  private advise() {
    const w = this.world, st = w.stats;
    if (st.unserved > 25) w.warnOnce('unserved', 25, `${st.unserved} people live or work without power or water — see the Power and Water lenses`);
    if (st.congestion > 0.3) {
      let worst: { n: string; v: number } | null = null;
      for (const e of w.net.edges.values()) { const v = Math.max(e.flowVc?.[0] ?? 0, e.flowVc?.[1] ?? 0); if (!worst || v > worst.v) worst = { n: e.spec.name, v }; }
      if (worst && worst.v > 1) w.warnOnce('jam', 20, `Heavy congestion on a ${worst.n}. Inspect it, add lanes or a bus lane, or build transit`);
    }
    if (st.workers > 40 && st.employed / Math.max(1, st.workers) < 0.7) w.warnOnce('jobs', 30, 'Many residents have no job. Zone more commercial, industrial or office land');
    if (st.unreachable > 10) w.warnOnce('unreach', 20, 'Some trips have no road connection. Check one-way streets and gaps');
    if (st.floodedTiles > 12) w.warnOnce('flood', 15, 'Flooded streets are slowing traffic. Add covered drains or a stormwater pond', 'bad');
  }

  private onDay() {
    const w = this.world;
    this.advise();
    constructionStep(w, 1);
    occupancyStep(w);
    recount(w);
    dailyEconomy(w);
    w.stats.city = cityIdentity(w);
    if (w.day % 3 === 0) {
      w.history.push({ day: w.day, pop: w.stats.population, money: w.money, happy: w.stats.happiness, congestion: w.stats.congestion, income: w.stats.incomeMonth, expense: w.stats.expenseMonth, modal: { ...w.stats.modal } });
      if (w.history.length > 160) w.history.shift();
    }
    for (const mi of MILESTONES) if (w.maxPop >= mi.pop && !w.milestones.includes(mi.pop)) { w.milestones.push(mi.pop); w.notify(`${mi.pop.toLocaleString('en-IN')} citizens — ${mi.text}`, 'good'); }
    if (w.day - w.autosaveDay >= 15) { w.autosaveDay = w.day; this.autosave?.(w); }
  }

  private onMonth() {
    const w = this.world;
    updateDistricts(w);
    upgradeStep(w);
    w.stats.sprawl = sprawlIndex(w);
    if (w.stats.sprawl > 0.6 && w.month % 3 === 0) w.notify('Sprawl is raising road upkeep and commute distances', 'warn');
  }
}

/** Group the city into named districts by 24-tile cells, labelled by dominant land use. */
export function updateDistricts(world: World) {
  const cells = new Map<number, { x: number; y: number; res: number; com: number; ind: number; off: number; pop: number; n: number }>();
  for (const b of world.buildings.values()) {
    if (b.progress < 1) continue;
    const gx = Math.floor(b.x / 24), gy = Math.floor(b.y / 24), k = gy * 100 + gx;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { x: gx * 24 + 12, y: gy * 24 + 12, res: 0, com: 0, ind: 0, off: 0, pop: 0, n: 0 }));
    const cat = DEFS[b.def]?.cat;
    if (cat === 'res') c.res += b.residents; else if (cat === 'com' || cat === 'market' || cat === 'mixed') { c.com += b.jobs; c.res += b.residents * 0.5; }
    else if (cat === 'ind' || cat === 'logistics') c.ind += b.jobs; else if (cat === 'office') c.off += b.jobs;
    c.pop += b.residents; c.n++;
  }
  world.districts = [...cells.values()].filter((c) => c.n >= 4).map((c, i) => {
    const kinds: [string, number][] = [['Residential', c.res], ['Commercial', c.com * 1.6], ['Industrial', c.ind], ['Tech & offices', c.off * 1.3]];
    kinds.sort((a, b) => b[1] - a[1]);
    return { id: i + 1, name: world.areaName(c.x, c.y), x: c.x, y: c.y, r: 12, kind: kinds[0][0] };
  });
}

/** Street vendors cluster near markets, stations, schools, offices and busy footpaths. */
export function updateVendors(world: World) {
  const rng = world.rng;
  const F = world.fields;
  const byEdge = new Map<ID, number>();
  for (const v of world.vendors) byEdge.set(v.edge, (byEdge.get(v.edge) ?? 0) + 1);
  const keep: Vendor[] = [];
  for (const v of world.vendors) if (world.net.edges.has(v.edge)) keep.push(v);
  world.vendors = keep;
  for (const e of world.net.edges.values()) {
    if (e.structure !== 'ground' || e.spec.sidewalk === 'none' || e.spec.category === 'highway' || e.spec.speed > 60) continue;
    const mid = pointAt(e.pts, e.cum, e.len / 2);
    const k = world.idx(mid.x, mid.y);
    const hub = F.autoDen[k] + F.jobDen[k] * 0.5 + F.popDen[k] * 0.3 + (F.tod[k] > 0.3 ? 0.4 : 0);
    const cap = e.spec.sidewalk === 'narrow' ? 0 : e.spec.sidewalk === 'standard' ? 1 : 3; // vendors need room
    const want = Math.min(cap, Math.floor(hub * 1.6 * Math.min(2, e.len / 3)));
    const have = byEdge.get(e.id) ?? 0;
    if (have < want && world.vendors.length < 260 && rng() < 0.6) {
      const s = e.len * (0.2 + rng() * 0.6);
      const p = pointAt(e.pts, e.cum, s);
      const side = rng() < 0.5 ? 1 : -1;
      const off = (carriageHalf(e.spec) + SIDEWALK_W[e.spec.sidewalk] * 0.7) * side;
      world.vendors.push({ id: world.newId(), x: p.x + Math.sin(p.ang) * off, y: p.y - Math.cos(p.ang) * off, ang: p.ang, kind: Math.floor(rng() * 4), edge: e.id });
    } else if (have > want && rng() < 0.4) {
      const i = world.vendors.findIndex((v) => v.edge === e.id);
      if (i >= 0) world.vendors.splice(i, 1);
    }
  }
}

export { DEFS };
