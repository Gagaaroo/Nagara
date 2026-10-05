import type { World } from '../world';
import { DEFS } from '../../data/buildings';
import { CATEGORY_RANK, laneCount } from '../roads/spec';
import { TRANSIT, lineMonthlyCost } from '../transportation/transit';
import { clamp, sat } from '../../utils/math';
import { Zone } from '../types';

const WAGE = [14000, 32000, 85000]; // ₹ / month by wealth

export interface Budget { income: Record<string, number>; expense: Record<string, number> }

export function sprawlIndex(world: World): number {
  const pts: [number, number][] = [];
  for (const b of world.buildings.values()) if (b.progress >= 1 && (b.residents > 0 || b.jobs > 0)) pts.push([b.x + b.w / 2, b.y + b.h / 2]);
  if (pts.length < 20) return 0;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let md = 0;
  for (const p of pts) md += Math.hypot(p[0] - cx, p[1] - cy);
  md /= pts.length;
  let area = 0;
  for (const b of world.buildings.values()) area += b.w * b.h;
  const compact = Math.sqrt(area / Math.PI) * 0.75; // mean distance of a filled disc ≈ 2/3 r
  const spread = clamp((md - compact * 1.15) / Math.max(6, compact * 1.3), 0, 1);
  const pop = Math.max(500, world.stats.population);
  const roadTiles = world.net.totalLength();
  const perK = roadTiles / (pop / 1000);
  const roads = clamp((perK - 9) / 30, 0, 1);
  return clamp(spread * 0.6 + roads * 0.4, 0, 1);
}

/** Computes the monthly budget from the current state. */
export function computeBudget(world: World): Budget {
  const rate = world.policies.tax;
  const rm = rate / 0.09;
  const inc: Record<string, number> = { 'Residents': 0, 'Commerce': 0, 'Industry': 0, 'Offices & IT': 0, 'Transit fares': 0, 'Street vendors': 0 };
  const exp: Record<string, number> = { 'Buildings & services': 0, 'Road maintenance': 0, 'Transit operations': 0, 'Utilities policy': 0 };
  for (const c of world.citizens) {
    if (c.work && c.reach) inc['Residents'] += (c.earners * WAGE[c.wealth] * rate * 2.5) / 1e5;
    else inc['Residents'] += (c.members * 220 * rm) / 1e5; // property/other
  }
  for (const b of world.buildings.values()) {
    if (b.progress < 1) continue;
    const def = DEFS[b.def];
    if (b.abandoned) { exp['Buildings & services'] += def.upkeep * 0.3; continue; }
    const jobs = b.workers;
    if (def.cat === 'com' || def.cat === 'market' || def.cat === 'mixed') inc['Commerce'] += jobs * 0.016 * rm;
    else if (def.cat === 'ind' || def.cat === 'logistics') inc['Industry'] += jobs * 0.014 * rm;
    else if (def.cat === 'office') inc['Offices & IT'] += jobs * 0.045 * rm;
    exp['Buildings & services'] += def.upkeep * (def.cat === 'service' ? 1 : 1);
  }
  inc['Street vendors'] = world.vendors.length * 0.05;
  let road = 0;
  for (const e of world.net.edges.values()) {
    const k = e.structure === 'bridge' ? 3 : e.structure === 'tunnel' ? 5 : e.structure === 'elevated' ? 2.5 : 1;
    const wear = 1 + ((e as any).wear ?? 0) * 0.8;
    road += e.len * Math.max(1, laneCount(e.spec)) * 0.011 * k * wear * (CATEGORY_RANK[e.spec.category] >= 3 ? 1.4 : 1);
  }
  const sprawl = world.stats.sprawl;
  exp['Road maintenance'] = road * (1 + sprawl * 0.5);
  let transit = 0, fares = 0;
  for (const l of world.lines.values()) { if (!l.active) continue; transit += lineMonthlyCost(l); fares += l.revenue; }
  exp['Transit operations'] = transit;
  inc['Transit fares'] = fares;
  exp['Utilities policy'] = world.policies.undergroundUtilities ? world.stats.population * 0.0006 : 0;
  const m = world.incomeMultiplier();
  for (const k of Object.keys(inc)) inc[k] *= m;
  return { income: inc, expense: exp };
}

export function dailyEconomy(world: World) {
  const b = computeBudget(world);
  const inc = Object.values(b.income).reduce((a, v) => a + v, 0);
  const exp = Object.values(b.expense).reduce((a, v) => a + v, 0);
  world.stats.incomeMonth = inc;
  world.stats.expenseMonth = exp;
  world.stats.breakdown = { ...Object.fromEntries(Object.entries(b.income).map(([k, v]) => ['+ ' + k, v])), ...Object.fromEntries(Object.entries(b.expense).map(([k, v]) => ['− ' + k, v])) };
  world.money += (inc - exp) / 30;
  if (world.money < 0 && world.day % 15 === 0) world.notify('The treasury is overdrawn — raise taxes or cut costs', 'bad');
}

/** City happiness 0..1, a weighted blend of eight simple components. */
export function updateHappiness(world: World) {
  const F = world.fields, st = world.stats;
  let w = 0, housing = 0, services = 0, pollution = 0, recreation = 0, access = 0, traffic = 0;
  for (const b of world.buildings.values()) {
    if (b.progress < 1 || !b.residents) continue;
    const k = world.idx(b.x + b.w / 2, b.y + b.h / 2);
    const r = b.residents;
    w += r;
    housing += r * (b.powered && b.watered ? 1 : 0.15);
    services += r * ((F.health[k] + F.edu1[k] + F.police[k] + F.fire[k] + F.waste[k] * 0.8) / 4.8);
    pollution += r * (1 - sat(F.air[k] * 1.1 + F.noise[k] * 0.7));
    recreation += r * sat(F.park[k] * 0.7 + F.culture[k] * 0.4 + F.walk[k] * 0.2);
    access += r * sat(F.walk[k] * 0.5 + F.lastMile[k] * 0.3 + F.pt[k] * 0.3 + F.frontage[k] * 0.2);
    traffic += r * (1 - sat(F.flow[k] * 1.4));
  }
  const parts: Record<string, number> = {};
  const emp = st.workers > 0 ? st.employed / st.workers : 0.5;
  parts.Housing = w ? housing / w : 0.6;
  parts.Employment = clamp(emp * 1.05, 0, 1);
  parts.Transport = clamp(1 - sat(st.avgCommuteMin / 70) * 0.55 - st.congestion * 0.6 + st.ptCoverage * 0.12, 0, 1);
  parts.Services = w ? services / w : 0.5;
  parts.Pollution = w ? pollution / w : 0.8;
  parts.Recreation = w ? recreation / w : 0.4;
  parts.Traffic = w ? clamp(traffic / w - st.congestion * 0.5, 0, 1) : 0.7;
  parts.Accessibility = w ? access / w : 0.5;
  const wt: Record<string, number> = { Housing: 0.18, Employment: 0.16, Transport: 0.14, Services: 0.16, Pollution: 0.1, Recreation: 0.08, Traffic: 0.08, Accessibility: 0.1 };
  let h = 0;
  for (const k of Object.keys(wt)) h += parts[k] * wt[k];
  h += -(world.policies.tax - 0.09) * 1.6 + (world.rain > 0.6 ? -0.02 : 0) - (st.floodedTiles > 20 ? 0.04 : 0);
  const target = clamp(h * 1.08, 0, 1);
  st.happiness = st.happiness * 0.7 + target * 0.3;
  st.happinessParts = parts;
}

export function cityIdentity(world: World): string {
  const m = world.stats.modal;
  const pop = world.stats.population;
  if (pop < 600) return 'Frontier settlement';
  const transit = (m.bus ?? 0) + (m.metro ?? 0) + (m.rail ?? 0);
  const active = (m.walk ?? 0) + (m.cycle ?? 0);
  const motor = (m.car ?? 0) + (m.two ?? 0);
  const sp = world.stats.sprawl;
  let high = 0, tot = 0, ind = 0, off = 0;
  for (const b of world.buildings.values()) { tot++; if (b.zone === Zone.ResHigh || b.zone === Zone.Mixed) high++; if (b.zone === Zone.Industrial) ind++; if (b.zone === Zone.Office) off++; }
  if (off / Math.max(1, tot) > 0.12) return 'Technology hub';
  if (ind / Math.max(1, tot) > 0.22) return 'Industrial centre';
  if (transit > 0.3 && sp < 0.45) return 'Transit-oriented city';
  if (active > 0.38 && sp < 0.4) return 'Walkable compact city';
  if (motor > 0.5 && sp > 0.45) return 'Car-oriented sprawl';
  if (motor > 0.5) return 'Two-wheeler city';
  if (sp > 0.55) return 'Sprawling suburban city';
  if (high / Math.max(1, tot) > 0.25) return 'Dense mixed-use city';
  return 'Mixed-mobility city';
}

export { TRANSIT };
