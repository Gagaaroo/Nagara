import {
  Building, Citizen, District, GAME_START, ID, MapParams, RoadEdge, Terrain, TransitLine, TransitStop, Vendor, Zone, Build, TILE_M,
} from './types';
import { RoadNetwork } from './roads/network';
import { DEFS, BuildingDef } from '../data/buildings';
import { Rng, mulberry32 } from '../utils/rng';
import { areaNames } from '../data/names';
import { RoadGraph } from './transportation/pathfinding';
import type { TransitNet } from './transportation/transit';

export interface Policies {
  tax: number; // 0.05..0.15
  fare: number; // ₹ per bus trip
  undergroundUtilities: boolean;
  autoStandRule: boolean;
}

export interface Stats {
  population: number;
  households: number;
  employed: number;
  workers: number;
  jobs: number;
  students: number;
  enrolled: number;
  happiness: number;
  happinessParts: Record<string, number>;
  demand: { r: number; c: number; i: number; o: number };
  modal: Record<string, number>; // trips per day by mode
  trips: number;
  avgCommuteMin: number;
  avgDistKm: number;
  congestion: number; // 0..1+
  freightTrips: number;
  heavyPct: number;
  lastMile: number;
  ptCoverage: number;
  walkAccess: number;
  bikeAccess: number;
  avgSpeed: number;
  powerSupply: number;
  powerDemand: number;
  waterSupply: number;
  waterDemand: number;
  unserved: number;
  airAvg: number;
  noiseAvg: number;
  landValueAvg: number;
  vendors: number;
  vehicles: number;
  peds: number;
  ridership: number;
  sprawl: number;
  floodedTiles: number;
  incomeMonth: number;
  expenseMonth: number;
  breakdown: Record<string, number>;
  city: string; // identity label
  unreachable: number;
}

export interface Message { id: number; text: string; kind: 'info' | 'good' | 'warn' | 'bad'; t: number }

export class World {
  seq = 1;
  rng: Rng;
  net: RoadNetwork;
  graph: RoadGraph;
  transitNet: TransitNet | null = null;
  day = 0; // days since start
  minute = 8 * 60 + 30; // minutes in day
  money = 0;
  cityName: string;
  buildings = new Map<ID, Building>();
  buildGrid: Int32Array;
  zones: Uint8Array;
  citizens: Citizen[] = [];
  citizensByHome = new Map<ID, Citizen[]>();
  stops = new Map<ID, TransitStop>();
  lines = new Map<ID, TransitLine>();
  vendors: Vendor[] = [];
  districts: District[] = [];
  policies: Policies = { tax: 0.09, fare: 12, undergroundUtilities: false, autoStandRule: true };
  stats: Stats;
  history: { day: number; pop: number; money: number; happy: number; congestion: number; income: number; expense: number; modal: Record<string, number> }[] = [];
  messages: Message[] = [];
  msgSeq = 1;
  terrainVersion = 0;
  terrainDirty = false;
  dirtyRects: [number, number, number, number][] = [];
  buildingVersion = 0;
  zoneVersion = 0;
  stopVersion = 0;
  accessDirty = true;
  assignDirty = true;
  freightDirty = true;
  free = false; // free building (used while seeding)
  unlockAll = false;
  maxPop = 0;
  milestones: number[] = [];
  autosaveDay = 0;
  fields: Record<string, Float32Array>;
  floodDepth: Float32Array;
  rain = 0; // 0..1 current rainfall intensity
  weather: 'clear' | 'cloudy' | 'rain' | 'heavy' = 'clear';
  cloud = 0.2;
  n: number;
  traffic_hasNoWarehouse = false;

  constructor(public params: MapParams, public terrain: Terrain) {
    this.n = terrain.n;
    this.rng = mulberry32(terrain.seedNum ^ 0xabcdef);
    this.net = new RoadNetwork(terrain.n, () => this.newId());
    this.graph = new RoadGraph(this.net);
    this.buildGrid = new Int32Array(terrain.n * terrain.n);
    this.zones = new Uint8Array(terrain.n * terrain.n);
    this.cityName = terrain.cityName;
    this.unlockAll = params.sandbox;
    const sz = terrain.n * terrain.n;
    this.fields = {};
    for (const k of ['landValue', 'air', 'noise', 'popDen', 'jobDen', 'power', 'water', 'police', 'fire', 'health', 'edu1', 'edu2', 'park', 'culture', 'waste', 'drain', 'pt', 'walk', 'bike', 'lastMile', 'ped', 'tod', 'autoDen', 'frontage', 'jobAccess', 'standCov', 'flow', 'freight', 'lastMileT', 'sidewalk', 'forestAvg'])
      this.fields[k] = new Float32Array(sz);
    this.floodDepth = new Float32Array(sz);
    this.stats = emptyStats(this.cityName);
  }

  newId(): ID { return this.seq++; }
  nodes_get(id: ID) { return this.net.nodes.get(id); }
  idx(x: number, y: number) { return Math.floor(y) * this.n + Math.floor(x); }
  inb(x: number, y: number) { return x >= 0 && y >= 0 && x < this.n && y < this.n; }

  // ───────── clock ─────────
  get hour() { return this.minute / 60; }
  date() {
    const start = new Date(Date.UTC(GAME_START.year, GAME_START.month, GAME_START.day));
    start.setUTCDate(start.getUTCDate() + Math.floor(this.day));
    return start;
  }
  dateLabel(): string {
    const d = this.date();
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  timeLabel(): string {
    const h = Math.floor(this.minute / 60), m = Math.floor(this.minute % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  get month() { return this.date().getUTCMonth(); }

  costMultiplier(): number {
    return this.params.difficulty === 'relaxed' ? 0.75 : this.params.difficulty === 'challenging' ? 1.3 : 1;
  }
  incomeMultiplier(): number {
    return this.params.difficulty === 'relaxed' ? 1.25 : this.params.difficulty === 'challenging' ? 0.85 : 1;
  }

  notify(text: string, kind: Message['kind'] = 'info') {
    this.messages.push({ id: this.msgSeq++, text, kind, t: Date.now() });
    if (this.messages.length > 60) this.messages.shift();
  }

  spend(cost: number): boolean {
    if (this.free) return true;
    if (cost > this.money + 1e-6) return false;
    this.money -= cost;
    return true;
  }

  get population() { return this.stats.population; }

  // ───────── unlocks ─────────
  isUnlocked(popNeeded: number | undefined): boolean {
    return this.unlockAll || !popNeeded || this.maxPop >= popNeeded;
  }

  // ───────── land / zoning ─────────
  tileFree(x: number, y: number): boolean {
    if (!this.inb(x, y)) return false;
    const k = y * this.n + x;
    if (this.buildGrid[k]) return false;
    if (this.net.isRoadTile(x, y)) return false;
    const b = this.terrain.build[k];
    if (b === Build.No || this.terrain.waterKind[k]) return false;
    return true;
  }

  paintZone(x0: number, y0: number, x1: number, y1: number, zone: Zone): number {
    let changed = 0;
    for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(this.n - 1, Math.max(y0, y1)); y++)
      for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(this.n - 1, Math.max(x0, x1)); x++) {
        const k = y * this.n + x;
        if (zone !== Zone.None && !this.tileFree(x, y)) continue;
        if (this.zones[k] !== zone) { this.zones[k] = zone; changed++; }
      }
    if (changed) this.zoneVersion++;
    return changed;
  }

  canPlace(def: BuildingDef, x: number, y: number, rot: number): { ok: boolean; reason: string } {
    const w = rot % 2 ? def.h : def.w, h = rot % 2 ? def.w : def.h;
    if (x < 0 || y < 0 || x + w > this.n || y + h > this.n) return { ok: false, reason: 'Outside the map' };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (y + j) * this.n + x + i;
      if (this.buildGrid[k]) return { ok: false, reason: 'Space occupied' };
      if (this.net.isRoadTile(x + i, y + j)) return { ok: false, reason: 'On a road' };
      if (this.terrain.waterKind[k]) return { ok: false, reason: 'Water' };
      const bc = this.terrain.build[k];
      if (bc === Build.No) return { ok: false, reason: this.terrain.protectedLand[k] ? 'Protected land' : 'Too steep' };
    }
    if (def.needsWaterEdge) {
      let near = false;
      for (let j = -3; j < h + 3 && !near; j++) for (let i = -3; i < w + 3; i++) {
        const xx = x + i, yy = y + j;
        if (this.inb(xx, yy) && this.terrain.waterKind[yy * this.n + xx] && this.terrain.waterKind[yy * this.n + xx] !== 0) { near = true; break; }
      }
      if (!near) return { ok: false, reason: 'Must be within 3 tiles of water' };
    }
    return { ok: true, reason: '' };
  }

  /** Cost of placing a building including terrain preparation. */
  placeCost(def: BuildingDef, x: number, y: number, rot: number): number {
    const w = rot % 2 ? def.h : def.w, h = rot % 2 ? def.w : def.h;
    let f = 0, c = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (y + j) * this.n + x + i;
      if (k < 0 || k >= this.n * this.n) continue;
      f += 1 + this.terrain.slope[k] * 5 + (this.terrain.forest[k] / 255) * 0.3; c++;
    }
    return def.cost * (c ? f / c : 1) * this.costMultiplier();
  }

  findAccess(x: number, y: number, w: number, h: number, range = 4.2) {
    const cx = x + w / 2, cy = y + h / 2;
    let best: ReturnType<RoadNetwork['nearestEdge']> = null;
    const r = range + Math.max(w, h) / 2;
    for (const e of this.net.edgesNear(cx, cy, r)) {
      if (e.structure !== 'ground' && e.structure !== 'depressed') continue;
      if (e.spec.category === 'highway' && e.spec.speed >= 80) continue;
    }
    best = this.net.nearestEdge(cx, cy, r, (e) => (e.structure === 'ground' || e.structure === 'depressed') && !(e.spec.category === 'highway'));
    return best;
  }

  placeBuilding(def: BuildingDef, x: number, y: number, rot: number, opts: { free?: boolean; instant?: boolean; zone?: Zone; level?: number; wealth?: number; noAccess?: boolean } = {}): Building | null {
    const can = this.canPlace(def, x, y, rot);
    if (!can.ok) return null;
    if (!opts.free) {
      const cost = this.placeCost(def, x, y, rot);
      if (!this.spend(cost)) return null;
    }
    const w = rot % 2 ? def.h : def.w, h = rot % 2 ? def.w : def.h;
    const rv = this.rng();
    const level = opts.level ?? Math.round(def.minLevels + (def.maxLevels - def.minLevels) * rv);
    const b: Building = {
      id: this.newId(), def: def.key, x, y, w, h, rot, zone: opts.zone ?? def.zone, level, variant: Math.floor(this.rng() * 1e6), wealth: opts.wealth ?? 1,
      built: this.day, progress: opts.instant ? 1 : 0, residents: 0, jobs: 0, workers: 0, access: 0, accessS: 0, ax: x + w / 2, ay: y + h / 2,
      powered: false, watered: false, abandoned: false, unserved: 0, name: def.name, load: 0,
    };
    const lvl = Math.max(1, level);
    b.jobs = Math.round(def.jobsPerLevel * (def.cat === 'service' || def.cat === 'transit' || def.cat === 'utility' || def.cat === 'culture' || def.cat === 'market' || def.cat === 'landmark' || def.cat === 'logistics' ? 1 : lvl));
    this.buildings.set(b.id, b);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (y + j) * this.n + x + i;
      this.buildGrid[k] = b.id;
      this.terrain.forest[k] = 0;
    }
    this.accessFor(b);
    this.buildingVersion++;
    this.accessDirty = true;
    this.assignDirty = true;
    this.freightDirty = true;
    return b;
  }

  accessFor(b: Building) {
    const r = this.findAccess(b.x, b.y, b.w, b.h);
    if (r) { b.access = r.e.id; b.accessS = r.s; b.ax = r.x; b.ay = r.y; } else { b.access = 0; }
  }

  refreshAccess() {
    for (const b of this.buildings.values()) this.accessFor(b);
    this.accessDirty = false;
    this.assignDirty = true;
  }

  demolishCost(b: Building): number {
    const def = DEFS[b.def];
    return (def ? Math.max(0.5, def.cost * 0.25 + b.level * 0.4) : 1) * this.costMultiplier();
  }

  isLandmark(b: Building) { return b.def.startsWith('lm_'); }

  demolish(id: ID, silent = false) {
    const b = this.buildings.get(id);
    if (!b) return;
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) this.buildGrid[(b.y + j) * this.n + b.x + i] = 0;
    this.buildings.delete(id);
    const cits = this.citizensByHome.get(id);
    if (cits) { const set = new Set(cits); this.citizens = this.citizens.filter((c) => !set.has(c)); this.citizensByHome.delete(id); }
    for (const c of this.citizens) { if (c.work === id) c.work = 0; if (c.school === id) c.school = 0; if (c.shop === id) c.shop = 0; }
    for (const s of [...this.stops.values()]) if (s.building === id) this.removeStop(s.id);
    this.buildingVersion++;
    this.assignDirty = true;
    this.freightDirty = true;
    if (!silent) this.notify(`${b.name} demolished`, 'info');
  }

  removeStop(id: ID) {
    const s = this.stops.get(id);
    if (!s) return;
    this.stops.delete(id);
    for (const l of this.lines.values()) if (l.stops.includes(id)) { l.stops = l.stops.filter((x) => x !== id); l.active = false; }
    this.stopVersion++;
  }

  /** Called after any road is committed. */
  afterRoadAdded(e: RoadEdge) {
    this.accessDirty = true;
    this.assignDirty = true;
    this.freightDirty = true;
    // clear trees under ground roads
    if (e.structure === 'ground' || e.structure === 'depressed') {
      const hw = (e.width ?? 0.5) / 2 + 0.4;
      for (let i = 0; i < e.pts.length; i += 2)
        for (let ty = Math.floor(e.pts[i + 1] - hw); ty <= Math.floor(e.pts[i + 1] + hw); ty++)
          for (let tx = Math.floor(e.pts[i] - hw); tx <= Math.floor(e.pts[i] + hw); tx++)
            if (this.inb(tx, ty)) this.terrain.forest[ty * this.n + tx] = 0;
    }
  }

  removeRoad(edgeId: ID) {
    const e = this.net.edges.get(edgeId);
    if (!e) return;
    this.net.removeEdge(edgeId);
    this.accessDirty = true;
    this.assignDirty = true;
    for (const s of this.stops.values()) if (s.edge === edgeId) { s.edge = 0; }
    for (const l of this.lines.values()) if (l.edges.includes(edgeId)) { l.active = false; }
    this.stopVersion++;
  }

  private zoneCache: { key: string; list: number[] } = { key: '', list: [] };
  /** Indices of zoned, empty, road-adjacent tiles (cached until zoning or buildings change). */
  zoneTiles(): number[] {
    const key = `${this.zoneVersion}|${this.buildingVersion}|${this.net.version}`;
    if (this.zoneCache.key === key) return this.zoneCache.list;
    const list: number[] = [];
    const n = this.n;
    for (let k = 0; k < n * n; k++) if (this.zones[k] && !this.buildGrid[k] && this.fields.frontage[k] >= 0.25) list.push(k);
    this.zoneCache = { key, list };
    return list;
  }

  buildingAt(x: number, y: number): Building | undefined {
    if (!this.inb(x, y)) return undefined;
    const id = this.buildGrid[Math.floor(y) * this.n + Math.floor(x)];
    return id ? this.buildings.get(id) : undefined;
  }

  citizensOf(homeId: ID): Citizen[] { return this.citizensByHome.get(homeId) ?? []; }

  addCitizen(c: Citizen) {
    this.citizens.push(c);
    let arr = this.citizensByHome.get(c.home);
    if (!arr) this.citizensByHome.set(c.home, (arr = []));
    arr.push(c);
  }
  removeCitizen(c: Citizen) {
    const i = this.citizens.indexOf(c);
    if (i >= 0) { this.citizens[i] = this.citizens[this.citizens.length - 1]; this.citizens.pop(); }
    const arr = this.citizensByHome.get(c.home);
    if (arr) { const j = arr.indexOf(c); if (j >= 0) arr.splice(j, 1); }
  }

  tileMeters() { return TILE_M; }

  areaName(x: number, y: number) {
    const gx = Math.floor(x / 24), gy = Math.floor(y / 24);
    return areaNames[(gx * 7 + gy * 3) % areaNames.length];
  }
}

export function emptyStats(city: string): Stats {
  return {
    population: 0, households: 0, employed: 0, workers: 0, jobs: 0, students: 0, enrolled: 0, happiness: 0.6, happinessParts: {},
    demand: { r: 0.5, c: 0.3, i: 0.3, o: 0 }, modal: {}, trips: 0, avgCommuteMin: 0, avgDistKm: 0, congestion: 0, freightTrips: 0, heavyPct: 0,
    lastMile: 0, ptCoverage: 0, walkAccess: 0, bikeAccess: 0, avgSpeed: 0, powerSupply: 0, powerDemand: 0, waterSupply: 0, waterDemand: 0, unserved: 0,
    airAvg: 0, noiseAvg: 0, landValueAvg: 0, vendors: 0, vehicles: 0, peds: 0, ridership: 0, sprawl: 0, floodedTiles: 0, incomeMonth: 0, expenseMonth: 0,
    breakdown: {}, city, unreachable: 0,
  };
}
