import type { World } from '../world';
import { Building, Zone, Build, TILE_M } from '../types';
import { DEFS, BuildingDef } from '../../data/buildings';
import { CATEGORY_RANK, bikeScore, roadNoiseFactor, walkScore } from '../roads/spec';
import { clamp, sat } from '../../utils/math';
import { pointAt } from '../roads/geometry';
import { TRANSIT, stopCatchment } from '../transportation/transit';

function splat(f: Float32Array, n: number, cx: number, cy: number, r: number, v: number, mode: 'max' | 'add' = 'max', pow = 1) {
  const R = Math.ceil(r);
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(n - 1, Math.ceil(cy + R)); y++)
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(n - 1, Math.ceil(cx + R)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const w = Math.pow(1 - d / r, pow) * v;
      const k = y * n + x;
      if (mode === 'max') { if (w > f[k]) f[k] = w; } else f[k] += w;
    }
}

export const powerDemand = (b: Building) => (b.residents * 0.0011 + b.jobs * 0.0016) * (b.progress >= 1 ? 1 : 0.1) + (DEFS[b.def]?.cat === 'utility' ? 0.02 : 0);
export const waterDemand = (b: Building) => (b.residents * 0.00016 + b.jobs * 0.00006) * (b.progress >= 1 ? 1 : 0.1);

const done = (b: Building) => b.progress >= 1 && !b.abandoned;

/** Service coverage, power & water connectivity. */
export function updateCoverage(world: World) {
  const F = world.fields, n = world.n;
  for (const k of ['police', 'fire', 'health', 'edu1', 'edu2', 'park', 'culture', 'waste', 'drain', 'power', 'water', 'standCov']) F[k].fill(0);
  const plants: Building[] = [], subs: Building[] = [], wsrc: Building[] = [], wtow: Building[] = [];
  let supply = 0, treat = 0, raw = 0;
  for (const b of world.buildings.values()) {
    const def = DEFS[b.def];
    if (!def || !done(b)) continue;
    if (b.def === 'auto_stand') splat(F.standCov, n, b.x + 0.5, b.y + 0.5, def.radius ?? 7, 1, 'max', 0.4);
    if (!def.service) continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = def.radius ?? 10;
    switch (def.service) {
      case 'police': splat(F.police, n, cx, cy, r, 1, 'max', 0.35); break;
      case 'fire': splat(F.fire, n, cx, cy, r, 1, 'max', 0.35); break;
      case 'health': splat(F.health, n, cx, cy, r, 1, 'max', 0.35); break;
      case 'edu1': splat(F.edu1, n, cx, cy, r, 1, 'max', 0.35); break;
      case 'edu2': case 'edu3': splat(F.edu2, n, cx, cy, r, 1, 'max', 0.35); splat(F.edu1, n, cx, cy, r, 0.7, 'max', 0.35); break;
      case 'coaching': splat(F.edu1, n, cx, cy, r, 0.6, 'max', 0.35); break;
      case 'park': splat(F.park, n, cx, cy, r, 1, 'max', 0.6); break;
      case 'culture': splat(F.culture, n, cx, cy, r, 1, 'max', 0.5); break;
      case 'waste': splat(F.waste, n, cx, cy, r, 1, 'max', 0.3); break;
      case 'drain': splat(F.drain, n, cx, cy, r, 1, 'max', 0.4); break;
      case 'power': if (def.capacity) { plants.push(b); supply += def.capacity; } else subs.push(b); break;
      case 'water':
        if (b.def === 'water_tower') wtow.push(b);
        else { wsrc.push(b); if (b.def === 'water_treatment') treat += def.capacity ?? 0; else raw += def.capacity ?? 0; }
        break;
    }
  }
  // power: substations only work when chained to a plant within 20 tiles
  const live: Building[] = plants.slice();
  const pending = subs.slice();
  for (let guard = 0; guard < 6 && pending.length; guard++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const s = pending[i];
      if (live.some((p) => Math.hypot(p.x - s.x, p.y - s.y) <= 22)) { live.push(s); pending.splice(i, 1); }
    }
  }
  const underground = world.policies.undergroundUtilities;
  for (const b of live) { const def = DEFS[b.def]; splat(F.power, n, b.x + b.w / 2, b.y + b.h / 2, (def.radius ?? 12) * (underground ? 1.15 : 1), 1, 'max', 0.15); }
  // water: towers connect to a source within 24 tiles
  const wlive: Building[] = wsrc.slice();
  for (const t of wtow) if (wsrc.some((p) => Math.hypot(p.x - t.x, p.y - t.y) <= 24)) wlive.push(t);
  for (const b of wlive) { const def = DEFS[b.def]; splat(F.water, n, b.x + b.w / 2, b.y + b.h / 2, def.radius ?? 12, 1, 'max', 0.15); }
  const waterSupply = Math.min(raw + treat, 6 + treat + raw * 0.35 + (treat > 0 ? raw : 0));
  let pd = 0, wd = 0;
  for (const b of world.buildings.values()) { pd += powerDemand(b); wd += waterDemand(b); }
  const st = world.stats;
  st.powerSupply = supply; st.powerDemand = pd; st.waterSupply = waterSupply; st.waterDemand = wd;
  const pRatio = pd > 0 ? Math.min(1, supply / pd) : 1;
  const wRatio = wd > 0 ? Math.min(1, waterSupply / wd) : 1;
  let unserved = 0;
  for (const b of world.buildings.values()) {
    const def = DEFS[b.def];
    const k = (Math.floor(b.y + b.h / 2)) * n + Math.floor(b.x + b.w / 2);
    const hasP = F.power[k] > 0, hasW = F.water[k] > 0;
    const roll = ((b.id * 2654435761 + Math.floor(world.day / 3) * 97) >>> 0) % 1000 / 1000;
    b.powered = (hasP && roll < pRatio + 0.0001) || def?.service === 'power' && !!def.capacity;
    b.watered = (hasW && roll < wRatio + 0.0001) || (def?.service === 'water' && def.key !== 'water_tower');
    if (def && (def.cat === 'park' || def.key === 'auto_stand' || def.cat === 'landmark' && def.service === 'park')) { b.powered = true; b.watered = true; }
    if (b.progress >= 1 && (def?.cat === 'res' || def?.cat === 'mixed' || def?.cat === 'com' || def?.cat === 'ind' || def?.cat === 'office')) {
      if (!b.powered || !b.watered) unserved += b.residents + b.jobs;
    }
  }
  st.unserved = unserved;
}

/** Population & job density, frontage, TOD, auto demand. */
export function updateDensity(world: World) {
  const F = world.fields, n = world.n;
  for (const k of ['popDen', 'jobDen', 'tod', 'autoDen', 'frontage', 'sidewalk', 'forestAvg']) F[k].fill(0);
  for (const b of world.buildings.values()) {
    const def = DEFS[b.def];
    if (!def || b.progress < 1) continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (b.residents) splat(F.popDen, n, cx, cy, 3.5, b.residents / 14, 'add', 1);
    if (b.jobs) splat(F.jobDen, n, cx, cy, 3.5, b.jobs / 14, 'add', 1);
    // activity centres draw autos
    const v = def.visits ?? 0;
    if (v > 0) splat(F.autoDen, n, cx, cy, 5 + v, Math.min(1, 0.12 * v), 'add', 1);
    if (def.cat === 'service' && (def.service === 'edu1' || def.service === 'edu2' || def.service === 'edu3' || def.service === 'health')) splat(F.autoDen, n, cx, cy, 6, 0.35, 'add', 1);
    if (b.zone === Zone.ResHigh || b.zone === Zone.Mixed) splat(F.autoDen, n, cx, cy, 4, 0.12, 'add', 1);
  }
  for (const s of world.stops.values()) {
    const kindW = s.kind === 'bus' ? 0.25 : s.kind === 'terminal' ? 0.6 : 0.9;
    if (s.kind !== 'bus') splat(F.autoDen, n, s.x, s.y, 8, kindW, 'add', 1);
    else splat(F.autoDen, n, s.x, s.y, 3, 0.1, 'add', 1);
    // transit-oriented development potential
    const hasLine = [...world.lines.values()].some((l) => l.active && l.stops.includes(s.id));
    if (!hasLine) continue;
    const r = s.kind === 'metro' ? 14 : s.kind === 'suburban' || s.kind === 'regional' ? 16 : s.kind === 'terminal' ? 9 : 4;
    const v = s.kind === 'bus' ? 0.18 : s.kind === 'terminal' ? 0.5 : 0.95;
    splat(F.tod, n, s.x, s.y, r, v, 'max', 0.7);
  }
  // roads: frontage & sidewalk quality
  for (const e of world.net.edges.values()) {
    if (e.structure !== 'ground' && e.structure !== 'depressed') continue;
    const rank = CATEGORY_RANK[e.spec.category];
    const fr = e.spec.category === 'highway' ? 0.2 : [0.55, 0.75, 0.95, 1][rank] ?? 0.5;
    const ws = walkScore(e.spec);
    const steps = Math.max(1, Math.ceil(e.len / 1.2));
    for (let k = 0; k <= steps; k++) {
      const p = pointAt(e.pts, e.cum, (e.len * k) / steps);
      splat(F.frontage, n, p.x, p.y, 3.2, fr, 'max', 0.5);
      splat(F.sidewalk, n, p.x, p.y, 3.2, ws, 'max', 0.5);
    }
  }
  // normalise density fields to 0..1+
  for (const k of ['popDen', 'jobDen', 'autoDen']) { const a = F[k]; for (let i = 0; i < a.length; i++) a[i] = Math.min(1.5, a[i]); }
  // forest neighbourhood average
  const forest = world.terrain.forest;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let s = 0, c = 0;
    for (let j = -2; j <= 2; j += 2) for (let i = -2; i <= 2; i += 2) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < n && yy < n) { s += forest[yy * n + xx]; c++; } }
    F.forestAvg[y * n + x] = s / c / 255;
  }
}

/** Public-transport coverage and walking/cycling accessibility. */
export function updateAccessibility(world: World) {
  const F = world.fields, n = world.n;
  const t = world.terrain;
  F.pt.fill(0); F.lastMile.fill(0); F.walk.fill(0); F.bike.fill(0);
  const lineBy = new Map<number, number>(); // stop id → best frequency quality
  for (const l of world.lines.values()) {
    if (!l.active) continue;
    const q = l.headwayMin <= 5 ? 1 : l.headwayMin <= 10 ? 0.85 : l.headwayMin <= 20 ? 0.6 : 0.4;
    for (const sid of l.stops) lineBy.set(sid, Math.max(lineBy.get(sid) ?? 0, q));
  }
  const stopsServed = [...world.stops.values()].filter((s) => lineBy.has(s.id));
  for (const s of stopsServed) {
    const cat = stopCatchment(world, s);
    splat(F.pt, n, s.x, s.y, cat, lineBy.get(s.id)!, 'max', 0.6);
  }
  const nonBus = stopsServed.filter((s) => s.kind !== 'bus');
  const nodes = stopsServed;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    if (t.waterKind[k]) continue;
    const slopeP = clamp(1 - t.slope[k] / 0.12, 0.1, 1);
    const sw = F.sidewalk[k];
    const amen = sat((F.jobDen[k] * 0.5 + F.autoDen[k] * 0.7));
    F.walk[k] = sat((sw * 0.55 + amen * 0.3 + F.park[k] * 0.15) * (0.6 + 0.4 * slopeP) * (F.frontage[k] > 0 ? 1 : 0.4));
    F.bike[k] = sat((F.frontage[k] > 0 ? 0.25 + F.sidewalk[k] * 0.1 : 0.05) + slopeP * 0.35 + F.bike[k] * 0 + 0.2 * (1 - F.air[k]));
  }
  // cycling infrastructure along roads raises bike access locally
  for (const e of world.net.edges.values()) {
    if (e.structure !== 'ground') continue;
    const bs = bikeScore(e.spec);
    const steps = Math.max(1, Math.ceil(e.len / 1.2));
    for (let k = 0; k <= steps; k++) {
      const p = pointAt(e.pts, e.cum, (e.len * k) / steps);
      const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
        const xx = x0 + i, yy = y0 + j;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const d = Math.hypot(i, j);
        if (d > 3) continue;
        const kk = yy * n + xx;
        F.bike[kk] = Math.max(F.bike[kk], sat(bs * (0.55 + 0.45 * clamp(1 - t.slope[kk] / 0.1, 0.1, 1)) * (1 - d / 4)));
      }
    }
  }
  // last-mile: minutes to the nearest meaningful node using the best feeder
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    if (t.waterKind[k] || (F.popDen[k] < 0.02 && F.jobDen[k] < 0.02)) continue;
    let best = 0;
    for (const s of nodes) {
      const d = Math.hypot(s.x - x - 0.5, s.y - y - 0.5);
      if (d > 28) continue;
      const imp = s.kind === 'bus' ? 0.5 : s.kind === 'terminal' ? 0.8 : 1;
      const walkQ = clamp(F.sidewalk[k] * 0.7 + 0.3, 0.25, 1);
      const walkT = (d * TILE_M * 1.25) / (1.3 * (0.55 + 0.45 * clamp(1 - t.slope[k] / 0.12, 0.2, 1)) * walkQ) / 60;
      const bikeT = F.bike[k] > 0.3 ? 2 + (d * TILE_M * 1.2) / 4 / 60 : 99;
      const standNear = Math.max(F.standCov[k], F.autoDen[k] > 0.4 ? 0.3 : 0);
      const autoT = d < 3 ? 99 : 2.5 + (1 - standNear) * 5 + (d * TILE_M * 1.25) / 5.5 / 60;
      const tm = Math.min(walkT, bikeT, autoT);
      const sc = imp * sat(1 - (tm - 4) / 16);
      if (sc > best) best = sc;
    }
    F.lastMile[k] = best;
  }
}

/** Air and noise pollution from traffic and industry, softened by greenery. */
export function updatePollution(world: World) {
  const F = world.fields, n = world.n;
  F.air.fill(0); F.noise.fill(0); F.flow.fill(0); F.freight.fill(0);
  for (const e of world.net.edges.values()) {
    const st = e.stat;
    if (!st) continue;
    const air = (st.car * 1 + st.two * 0.6 + st.auto * 0.9 + st.bus * 2.4 + st.truck * 4.2) * 0.0016;
    const noise = (st.car * 1 + st.two * 1.5 + st.auto * 1.3 + st.bus * 2.2 + st.truck * 3.6) * roadNoiseFactor(e.spec) * 0.0018;
    const flow = (st.car + st.two + st.auto + st.bus + st.truck) * 0.002;
    const frt = st.truck * 0.01;
    const steps = Math.max(1, Math.ceil(e.len / 1.5));
    const hide = e.structure === 'tunnel' ? 0.15 : 1;
    for (let k = 0; k <= steps; k++) {
      const p = pointAt(e.pts, e.cum, (e.len * k) / steps);
      splat(F.air, n, p.x, p.y, 3.2, air * hide, 'add', 1.4);
      splat(F.noise, n, p.x, p.y, 3.6, noise * hide, 'add', 1.2);
      splat(F.flow, n, p.x, p.y, 2.5, flow, 'max', 1);
      splat(F.freight, n, p.x, p.y, 2.5, frt, 'max', 1);
    }
  }
  for (const b of world.buildings.values()) {
    const def = DEFS[b.def];
    if (!def || b.progress < 1 || b.abandoned) continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (def.air) splat(F.air, n, cx, cy, 5 + def.air * 1.5, def.air * (def.cat === 'ind' ? b.level : 1) * 0.28, 'add', 1.1);
    if (def.noise) splat(F.noise, n, cx, cy, 4.5, def.noise * 0.3, 'add', 1.1);
  }
  let a = 0, nz = 0, c = 0;
  for (let i = 0; i < n * n; i++) {
    const g = 1 - 0.55 * F.park[i] - 0.45 * F.forestAvg[i];
    F.air[i] = sat(F.air[i] * Math.max(0.15, g));
    F.noise[i] = sat(F.noise[i] * Math.max(0.25, 1 - 0.3 * F.park[i] - 0.25 * F.forestAvg[i]));
    if (F.popDen[i] > 0.05) { a += F.air[i]; nz += F.noise[i]; c++; }
  }
  world.stats.airAvg = c ? a / c : 0;
  world.stats.noiseAvg = c ? nz / c : 0;
}

/** Land value from accessibility, services, jobs, parks, TOD and nuisance. */
export function updateLandValue(world: World) {
  const F = world.fields, n = world.n, t = world.terrain;
  let sum = 0, cnt = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    if (t.waterKind[k]) { F.landValue[k] = 0; continue; }
    const services = (F.health[k] + F.edu1[k] + F.police[k] + F.fire[k] + F.culture[k] * 0.5) / 4.5;
    const water = F.water[k] > 0 ? 1 : 0, power = F.power[k] > 0 ? 1 : 0;
    let lv = 0.16 + F.frontage[k] * 0.2 + sat(F.jobDen[k]) * 0.14 + services * 0.1 + F.pt[k] * 0.1 + F.tod[k] * 0.12 + F.park[k] * 0.1 + F.walk[k] * 0.06 + (water + power) * 0.04;
    lv -= F.air[k] * 0.22 + F.noise[k] * 0.14 + F.flow[k] * 0.05;
    // waterfront and views
    lv += F.forestAvg[k] * 0.04;
    lv = sat(lv);
    F.landValue[k] = lv;
    if (F.popDen[k] > 0.05) { sum += lv; cnt++; }
  }
  world.stats.landValueAvg = cnt ? sum / cnt : 0;
}

export function wealthAt(world: World, x: number, y: number, rnd: number): number {
  const lv = world.fields.landValue[world.idx(x, y)];
  const v = lv + (rnd - 0.5) * 0.18;
  return v < 0.36 ? 0 : v < 0.55 ? 1 : 2;
}

export function bldgTile(b: Building) { return [Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h / 2)]; }
export type { BuildingDef };
export { Build };
