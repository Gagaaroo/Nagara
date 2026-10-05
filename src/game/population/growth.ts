import type { World } from '../world';
import { Building, Citizen, Zone, Build } from '../types';
import { BuildingDef, BUILDINGS, DEFS, growthDefs } from '../../data/buildings';
import { clamp, sat, lerp } from '../../utils/math';
import { wealthAt } from '../simulation/fields';

const isHome = (b: Building) => { const c = DEFS[b.def]?.cat; return c === 'res' || c === 'mixed'; };
export const capacityOf = (b: Building) => { const d = DEFS[b.def]; return d ? d.resPerLevel * b.level : 0; };

export function computeDemand(world: World) {
  const st = world.stats;
  let jobs = 0, comJobs = 0, indJobs = 0, offJobs = 0, earners = 0, cap = 0, pop = 0;
  for (const b of world.buildings.values()) {
    if (b.progress < 1) continue;
    const def = DEFS[b.def];
    jobs += b.jobs;
    if (def.cat === 'com' || def.cat === 'market' || def.cat === 'mixed') comJobs += b.jobs;
    if (def.cat === 'ind' || def.cat === 'logistics') indJobs += b.jobs;
    if (def.cat === 'office') offJobs += b.jobs;
    if (isHome(b)) cap += capacityOf(b);
  }
  for (const c of world.citizens) { earners += c.earners; pop += c.members; }
  st.jobs = jobs; st.workers = earners;
  const unemployed = Math.max(0, earners - st.employed);
  const vacancy = Math.max(0, jobs - st.employed);
  const housingFree = cap > 0 ? 1 - pop / cap : 0.5;
  const happy = st.happiness;
  let r = 0.42 + 0.9 * (vacancy - unemployed * 0.6) / Math.max(80, jobs) + (happy - 0.5) * 0.6;
  if (housingFree > 0.35) r *= 0.45; // plenty of empty homes already
  if (pop < 80) r = Math.max(r, 0.6);
  const comTarget = pop * 0.07;
  const c = Math.max(0.08, 0.12 + 1.1 * (comTarget - comJobs) / Math.max(30, comTarget));
  const indTarget = earners * 0.3 + 12;
  const i = 0.1 + 1.0 * (indTarget - indJobs) / Math.max(30, indTarget) + (unemployed > earners * 0.12 ? 0.25 : 0);
  const offTarget = pop > 3500 ? earners * 0.17 : 0;
  const o = pop > 3500 ? 0.1 + 1.0 * (offTarget - offJobs) / Math.max(30, offTarget) + world.fields.edu2.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) / 600 * 0.2 : 0;
  st.demand = { r: sat(r), c: sat(c), i: sat(i), o: sat(o) };
}

function defWeight(def: BuildingDef, lv: number, tod: number, pop: number): number {
  const v = lv + tod * 0.5;
  switch (def.key) {
    case 'house': return 3.2 - lv * 2.2;
    case 'row_house': return 2.4 - Math.abs(lv - 0.35) * 2;
    case 'small_apt': return 0.8 + lv * 1.4 + tod;
    case 'apt_block': return 1.2 + (1 - Math.abs(v - 0.45) * 1.6);
    case 'modern_apt': return 0.2 + lv * 2.4;
    case 'tower': return 0.3 + v * 2.2 + tod;
    case 'complex': return 0.2 + v * 1.6;
    case 'shop': return 3.2 - lv * 1.2;
    case 'restaurant': return 1.2 + lv;
    case 'shop_street': return 0.4 + lv * 1.8;
    case 'mall': return pop > 8000 ? lv * 2 + tod * 2 : 0;
    case 'mixed_low': return 2.4 - v * 1.6;
    case 'mixed_mid': return 0.6 + v * 1.8 + tod;
    case 'mixed_high': return 0.1 + v * 2 + tod * 2;
    case 'workshop': return pop < 6000 ? 3 : 1.4;
    case 'factory': return pop > 1500 ? 1.4 + pop / 20000 : 0.2;
    case 'warehouse_z': return pop > 2500 ? 1 : 0;
    case 'office': return 1.6 + lv;
    case 'biz_park': return 0.4 + lv * 1.2 + tod;
    case 'it_tower': return 0.4 + lv * 2 + tod * 1.5;
    case 'tech_campus': return 0.2 + lv * 1.8;
    default: return 1;
  }
}

function fits(world: World, def: BuildingDef, ax: number, ay: number, rot: number, zone: Zone): boolean {
  const w = rot % 2 ? def.h : def.w, h = rot % 2 ? def.w : def.h;
  const n = world.n;
  if (ax < 0 || ay < 0 || ax + w > n || ay + h > n) return false;
  let minZ = 1e9, maxZ = -1e9;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (ay + j) * n + ax + i;
    if (world.zones[k] !== zone) return false;
    if (!world.tileFree(ax + i, ay + j)) return false;
    if (world.terrain.build[k] === Build.Expensive && w * h > 2) return false;
    const hh = world.terrain.heights[(ay + j) * (n + 1) + ax + i];
    minZ = Math.min(minZ, hh); maxZ = Math.max(maxZ, hh);
  }
  return maxZ - minZ < 14;
}

/** Try to grow one building on a random zoned tile. */
export function tryGrow(world: World, zoneTypes: { zone: Zone; w: number }[]): boolean {
  const n = world.n, rng = world.rng, F = world.fields;
  const total = zoneTypes.reduce((a, z) => a + z.w, 0);
  if (total <= 0) return false;
  const list = world.zoneTiles();
  if (!list.length) return false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const k = list[Math.floor(rng() * list.length)];
    const x = k % n, y = (k / n) | 0;
    const zone = world.zones[k] as Zone;
    if (!zone || world.buildGrid[k]) continue;
    const zt = zoneTypes.find((z) => z.zone === zone);
    if (!zt || rng() > zt.w) continue;
    if (F.frontage[k] < 0.25) continue; // needs a road nearby
    if (F.power[k] <= 0 || F.water[k] <= 0) { world.stats.unserved += 0; continue; }
    if (!world.tileFree(x, y)) continue;
    const lv = F.landValue[k], tod = F.tod[k];
    const pop = world.stats.population;
    const cands = growthDefs(zone).filter((d) => world.isUnlocked(d.unlock));
    // weighted pick
    const ws = cands.map((d) => Math.max(0, defWeight(d, lv, tod, pop)));
    let tot = ws.reduce((a, v) => a + v, 0);
    if (tot <= 0) continue;
    let pick = rng() * tot, di = 0;
    for (let i = 0; i < ws.length; i++) { pick -= ws[i]; if (pick <= 0) { di = i; break; } }
    const order = [cands[di], ...cands.filter((_, i) => i !== di).sort((a, b) => a.w * a.h - b.w * b.h)];
    for (const def of order) {
      for (let rot = 0; rot < (def.w === def.h ? 1 : 2); rot++) {
        const w = rot % 2 ? def.h : def.w, h = rot % 2 ? def.w : def.h;
        for (let t = 0; t < 4; t++) {
          const ax = x - Math.floor(rng() * w), ay = y - Math.floor(rng() * h);
          if (!fits(world, def, ax, ay, rot, zone)) continue;
          const wealth = wealthAt(world, ax, ay, rng());
          if (def.wealth && (wealth < def.wealth[0] || wealth > def.wealth[1])) continue;
          const maxL = lerp(def.minLevels, def.maxLevels, clamp(0.25 + lv * 0.55 + tod * 0.5 + rng() * 0.2, 0, 1));
          const level = Math.max(def.minLevels, Math.min(def.maxLevels, Math.round(maxL)));
          const b = world.placeBuilding(def, ax, ay, rot, { free: true, zone, level, wealth });
          if (!b) continue;
          if (!b.access) { world.demolish(b.id, true); continue; }
          return true;
        }
      }
    }
  }
  return false;
}

/** Called once per game hour. */
export function growthStep(world: World) {
  computeDemand(world);
  const d = world.stats.demand;
  const pop = world.stats.population;
  const zt = [
    { zone: Zone.ResLow, w: d.r }, { zone: Zone.ResMed, w: d.r }, { zone: Zone.ResHigh, w: d.r * 0.9 },
    { zone: Zone.Commercial, w: d.c }, { zone: Zone.Mixed, w: (d.r + d.c) / 2 }, { zone: Zone.Industrial, w: d.i }, { zone: Zone.Office, w: d.o },
  ];
  const budget = Math.min(7, 1 + Math.floor(pop / 3500) + (world.unlockAll ? 1 : 0));
  let made = 0;
  for (let i = 0; i < budget + 2 && made < budget; i++) if (tryGrow(world, zt)) made++;
}

export function constructionStep(world: World, dtDays: number) {
  for (const b of world.buildings.values()) {
    if (b.progress >= 1) continue;
    const def = DEFS[b.def];
    const days = def.cat === 'landmark' ? 25 : def.cat === 'res' || def.cat === 'mixed' || def.cat === 'office' ? 3 + b.level * 0.5 : 4 + (def.w * def.h);
    b.progress = Math.min(1, b.progress + dtDays / days);
    if (b.progress >= 1) { world.buildingVersion++; world.assignDirty = true; world.freightDirty = true; }
  }
}

export function newHousehold(world: World, b: Building): Citizen {
  const r = world.rng;
  const def = DEFS[b.def];
  const big = def.shape === 'house' || def.shape === 'row';
  const members = clamp(Math.round(2 + r() * 2.4 + (big ? 0.6 : 0) - (b.wealth === 2 ? 0.4 : 0)), 1, 6);
  const earners = members >= 3 ? (r() < 0.55 ? 2 : 1) : members === 2 ? (r() < 0.7 ? 1 : 2) : r() < 0.8 ? 1 : 0;
  const students = clamp(members - earners - (r() < 0.3 ? 1 : 0), 0, 3);
  const carP = [0.07, 0.3, 0.72][b.wealth] ?? 0.3;
  const twoP = [0.45, 0.66, 0.52][b.wealth] ?? 0.5;
  return {
    id: world.newId(), home: b.id, members, earners, students, wealth: b.wealth, work: 0, school: 0, shop: 0,
    hasCar: r() < carP, hasTwo: r() < twoP, commuteMode: 'walk', schoolMode: 'walk', leisureMode: 'walk', commuteMin: 0, commuteKm: 0, happy: 0.6, reach: true,
  };
}

/** Daily: move residents in/out of completed homes. */
export function occupancyStep(world: World) {
  const st = world.stats;
  const jobsRatio = st.workers > 0 ? clamp(st.jobs / Math.max(1, st.workers), 0, 2) : 1;
  const attract = clamp(0.35 + st.happiness * 0.45 + (jobsRatio - 0.8) * 0.35 + (st.demand.r - 0.4) * 0.3, 0.05, 1);
  for (const b of world.buildings.values()) {
    if (b.progress < 1 || !isHome(b)) continue;
    const cap = capacityOf(b);
    const cits = world.citizensOf(b.id);
    let current = 0;
    for (const c of cits) current += c.members;
    b.residents = current;
    const served = b.powered && b.watered;
    const target = served ? cap * attract : 0;
    if (!served) b.unserved += 1; else b.unserved = 0;
    if (b.unserved > 24 && !b.abandoned) { b.abandoned = true; world.buildingVersion++; world.notify(`${b.name} abandoned — no power or water`, 'warn'); }
    if (b.abandoned && served && b.unserved === 0) { b.abandoned = false; world.buildingVersion++; }
    if (current < target - 2 && !b.abandoned) {
      const add = Math.max(1, Math.round((cap - current) * 0.2));
      let added = 0;
      while (added < add && current + 2 <= cap) {
        const h = newHousehold(world, b);
        if (current + h.members > cap + 1) break;
        world.addCitizen(h);
        current += h.members; added += h.members;
      }
      world.assignDirty = true;
    } else if (current > target + 6 && cits.length > 0) {
      // someone leaves
      const c = cits[cits.length - 1];
      world.removeCitizen(c);
      current -= c.members;
      world.assignDirty = true;
    }
    b.residents = current;
  }
  // job buildings: unserved ones shut down after a while
  for (const b of world.buildings.values()) {
    if (b.progress < 1 || isHome(b)) continue;
    const def = DEFS[b.def];
    if (!(def.cat === 'com' || def.cat === 'ind' || def.cat === 'office' || def.cat === 'market')) continue;
    if (!b.powered || !b.watered) b.unserved++; else b.unserved = Math.max(0, b.unserved - 1);
    if (b.unserved > 30 && !b.abandoned) { b.abandoned = true; world.buildingVersion++; }
    else if (b.abandoned && b.unserved === 0) { b.abandoned = false; world.buildingVersion++; }
  }
}

/** Assign workplaces, schools and shopping destinations. */
export function assignDestinations(world: World) {
  const rng = world.rng, n = world.n;
  const jobBuildings: Building[] = [];
  const schools: Building[] = [];
  const shops: Building[] = [];
  const work = new Map<number, number>();
  for (const b of world.buildings.values()) {
    if (b.progress < 1 || b.abandoned) continue;
    const def = DEFS[b.def];
    if (b.jobs > 0 && !(def.cat === 'res')) jobBuildings.push(b);
    if (def.service === 'edu1' || def.service === 'edu2' || def.service === 'edu3') schools.push(b);
    if ((def.visits ?? 0) > 0.7 && def.cat !== 'service' && def.cat !== 'office') shops.push(b);
    work.set(b.id, 0);
  }
  const schoolLoad = new Map<number, number>();
  // keep valid existing assignments
  let employed = 0, enrolled = 0, students = 0;
  for (const c of world.citizens) {
    if (c.work && work.has(c.work)) work.set(c.work, work.get(c.work)! + c.earners);
    else c.work = 0;
    if (c.school && work.has(c.school)) schoolLoad.set(c.school, (schoolLoad.get(c.school) ?? 0) + c.students); else c.school = 0;
    if (c.shop && !work.has(c.shop)) c.shop = 0;
  }
  const home = (c: Citizen) => world.buildings.get(c.home);
  const spare = (b: Building) => b.jobs - (work.get(b.id) ?? 0);
  for (const c of world.citizens) {
    const hb = home(c);
    if (!hb) continue;
    if (c.earners > 0 && !c.work && jobBuildings.length) {
      let best: Building | null = null, bs = 1e9;
      for (let t = 0; t < 12; t++) {
        const b = jobBuildings[Math.floor(rng() * jobBuildings.length)];
        if (spare(b) < c.earners) continue;
        const def = DEFS[b.def];
        const d = Math.hypot(b.x - hb.x, b.y - hb.y);
        const match = c.wealth === 2 ? (def.cat === 'office' ? -10 : def.cat === 'ind' ? 8 : 0) : c.wealth === 0 ? (def.cat === 'ind' || def.cat === 'com' || def.cat === 'market' ? -6 : def.cat === 'office' ? 6 : 0) : 0;
        const s = d * 0.6 + match + rng() * 6;
        if (s < bs) { bs = s; best = b; }
      }
      if (best) { c.work = best.id; work.set(best.id, (work.get(best.id) ?? 0) + c.earners); c.reach = true; }
    }
    if (c.students > 0 && !c.school && schools.length) {
      let best: Building | null = null, bd = 28;
      for (const s of schools) {
        const cap = DEFS[s.def].capacity ?? 500;
        if ((schoolLoad.get(s.id) ?? 0) + c.students > cap) continue;
        const d = Math.hypot(s.x - hb.x, s.y - hb.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { c.school = best.id; schoolLoad.set(best.id, (schoolLoad.get(best.id) ?? 0) + c.students); }
    }
    if (!c.shop && shops.length) {
      let best: Building | null = null, bs = -1e9;
      for (let t = 0; t < 7; t++) {
        const b = shops[Math.floor(rng() * shops.length)];
        const d = Math.hypot(b.x - hb.x, b.y - hb.y);
        const s = (DEFS[b.def].visits ?? 1) * 3 - d * 0.35 + rng() * 2;
        if (s > bs) { bs = s; best = b; }
      }
      if (best) c.shop = best.id;
    }
    if (c.work && c.reach) employed += c.earners;
    students += c.students;
    if (c.school) enrolled += c.students;
  }
  for (const b of world.buildings.values()) b.workers = work.get(b.id) ?? 0;
  world.stats.employed = employed;
  world.stats.students = students;
  world.stats.enrolled = enrolled;
  void n;
}

/** Monthly: densify buildings where land value and transit support it. */
export function upgradeStep(world: World) {
  const F = world.fields;
  let ups = 0;
  for (const b of world.buildings.values()) {
    if (ups > 12) break;
    const def = DEFS[b.def];
    if (b.progress < 1 || b.zone === Zone.None || def.cost > 0) continue;
    const k = world.idx(b.x + b.w / 2, b.y + b.h / 2);
    const cap = lerp(def.minLevels, def.maxLevels, clamp(0.3 + F.landValue[k] * 0.55 + F.tod[k] * 0.55, 0, 1));
    if (b.level < Math.floor(cap) && world.rng() < 0.18 + F.tod[k] * 0.3) {
      b.level++;
      if (def.jobsPerLevel) b.jobs = Math.round(def.jobsPerLevel * b.level);
      world.buildingVersion++;
      ups++;
    }
  }
  if (ups) world.assignDirty = true;
}

export { BUILDINGS };

export function recount(world: World) {
  const st = world.stats;
  let pop = 0;
  for (const c of world.citizens) pop += c.members;
  st.population = pop;
  st.households = world.citizens.length;
  if (pop > world.maxPop) world.maxPop = pop;
}

/** Recreate households for a home building so total members ≈ residents (used when loading). */
export function fillHome(world: World, b: Building, residents: number) {
  let cur = 0, guard = 0;
  while (cur < residents && guard++ < 200) {
    const h = newHousehold(world, b);
    const left = residents - cur;
    if (h.members > left) { h.members = Math.max(1, left); h.earners = Math.min(h.earners, h.members); h.students = Math.min(h.students, h.members - h.earners); }
    world.addCitizen(h);
    cur += h.members;
  }
  b.residents = cur;
}
