import { World } from '../world';
import { generateTerrain } from '../terrain/generate';
import { Building, MapParams, RoadSpec, Structure, TransitLine, TransitStop, Vendor, NodeControl } from '../types';
import { DEFS } from '../../data/buildings';
import { classifyTile } from '../terrain/query';
import { fillHome } from '../population/growth';
import { recomputeLine } from '../transportation/transit';
import { recount } from '../population/growth';

export const SAVE_VERSION = 1;

export interface SaveMeta { id: string; name: string; city: string; pop: number; day: number; money: number; savedAt: number; seed: string; auto: boolean }
export interface SaveData {
  version: number;
  meta: SaveMeta;
  params: MapParams;
  seq: number; day: number; minute: number; money: number; cityName: string; maxPop: number; milestones: number[]; autosaveDay: number;
  policies: World['policies'];
  weather: World['weather']; rain: number;
  terrainDiff: { i: number[]; d: number[] };
  zones: number[]; // RLE
  nodes: { id: number; x: number; y: number; z: number; c: NodeControl; cr: boolean; bp: boolean; tl: boolean; cy: number; ms: number; bn: Record<number, number> }[];
  edges: { id: number; a: number; b: number; s: RoadSpec; st: Structure; p: number[]; z: number[]; c: number; bt: number }[];
  buildings: { id: number; d: string; x: number; y: number; w: number; h: number; r: number; z: number; l: number; v: number; wl: number; bt: number; pg: number; rs: number; j: number; ab: boolean; n: string }[];
  stops: TransitStop[];
  lines: Omit<TransitLine, 'rt'>[];
  vendors: Vendor[];
  history: World['history'];
  templates?: RoadSpec[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function serialize(world: World, name: string, auto = false, templates?: RoadSpec[]): SaveData {
  const t = world.terrain;
  const di: number[] = [], dd: number[] = [];
  for (let i = 0; i < t.heights.length; i++) {
    const d = t.heights[i] - t.baseHeights[i];
    if (Math.abs(d) > 0.004) { di.push(i); dd.push(Math.round(d * 100)); }
  }
  const rle: number[] = [];
  let prev = world.zones[0], cnt = 0;
  for (let i = 0; i < world.zones.length; i++) { if (world.zones[i] === prev) cnt++; else { rle.push(prev, cnt); prev = world.zones[i]; cnt = 1; } }
  rle.push(prev, cnt);
  return {
    version: SAVE_VERSION,
    meta: { id: '', name, city: world.cityName, pop: world.stats.population, day: Math.floor(world.day), money: Math.round(world.money), savedAt: Date.now(), seed: world.params.seed, auto },
    params: world.params, seq: world.seq, day: world.day, minute: world.minute, money: world.money, cityName: world.cityName, maxPop: world.maxPop, milestones: world.milestones, autosaveDay: world.autosaveDay,
    policies: world.policies, weather: world.weather, rain: world.rain,
    terrainDiff: { i: di, d: dd },
    zones: rle,
    nodes: [...world.net.nodes.values()].map((n) => ({ id: n.id, x: r2(n.x), y: r2(n.y), z: r1(n.z), c: n.control, cr: n.crossings, bp: n.busPriority, tl: n.turnLanes, cy: n.cycle, ms: n.mainShare, bn: n.banned })),
    edges: [...world.net.edges.values()].map((e) => ({ id: e.id, a: e.a, b: e.b, s: e.spec, st: e.structure, p: e.pts.map(r2), z: e.zs.map(r1), c: r1(e.cost), bt: e.built })),
    buildings: [...world.buildings.values()].map((b) => ({ id: b.id, d: b.def, x: b.x, y: b.y, w: b.w, h: b.h, r: b.rot, z: b.zone, l: b.level, v: b.variant, wl: b.wealth, bt: b.built, pg: r2(b.progress), rs: b.residents, j: b.jobs, ab: b.abandoned, n: b.name })),
    stops: [...world.stops.values()].map((s) => ({ ...s, waiting: 0 })),
    lines: [...world.lines.values()].map((l) => { const { rt, ...rest } = l; void rt; return rest; }),
    vendors: world.vendors,
    history: world.history,
    templates,
  };
}

export function deserialize(data: SaveData): World {
  const terrain = generateTerrain(data.params);
  const V = terrain.n + 1;
  for (let k = 0; k < data.terrainDiff.i.length; k++) terrain.heights[data.terrainDiff.i[k]] += data.terrainDiff.d[k] / 100;
  void V;
  for (let j = 0; j < terrain.n; j++) for (let i = 0; i < terrain.n; i++) classifyTile(terrain, i, j);
  const w = new World(data.params, terrain);
  w.seq = data.seq; w.day = data.day; w.minute = data.minute; w.money = data.money; w.cityName = data.cityName; w.maxPop = data.maxPop; w.milestones = data.milestones ?? []; w.autosaveDay = data.autosaveDay ?? 0;
  w.policies = { ...w.policies, ...data.policies };
  w.weather = data.weather ?? 'clear'; w.rain = data.rain ?? 0;
  w.history = data.history ?? [];
  let zi = 0;
  for (let i = 0; i < data.zones.length; i += 2) for (let k = 0; k < data.zones[i + 1]; k++) w.zones[zi++] = data.zones[i];
  for (const n of data.nodes) {
    w.net.nodes.set(n.id, { id: n.id, x: n.x, y: n.y, z: n.z, control: n.c, crossings: n.cr, busPriority: n.bp, turnLanes: n.tl, cycle: n.cy, mainShare: n.ms, banned: n.bn ?? {}, edges: [] });
  }
  for (const e of data.edges) {
    const edge = { id: e.id, a: e.a, b: e.b, spec: e.s, structure: e.st, pts: e.p, zs: e.z, cum: [], len: 0, cost: e.c, built: e.bt };
    w.net.finishEdge(edge as any);
    w.net.edges.set(edge.id, edge as any);
    w.net.nodes.get(e.a)?.edges.push(e.id);
    w.net.nodes.get(e.b)?.edges.push(e.id);
    (w.net as any).indexEdge(edge);
  }
  w.net.ensureMask();
  (w.net as any).maskDirty = true;
  w.net.ensureMask();
  w.net.touch(true);
  for (const bd of data.buildings) {
    const def = DEFS[bd.d];
    if (!def) continue;
    const b: Building = {
      id: bd.id, def: bd.d, x: bd.x, y: bd.y, w: bd.w, h: bd.h, rot: bd.r, zone: bd.z, level: bd.l, variant: bd.v, wealth: bd.wl, built: bd.bt, progress: bd.pg, residents: 0, jobs: bd.j, workers: 0,
      access: 0, accessS: 0, ax: bd.x + bd.w / 2, ay: bd.y + bd.h / 2, powered: false, watered: false, abandoned: bd.ab, unserved: 0, name: bd.n, load: 0,
    };
    w.buildings.set(b.id, b);
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) { const k = (b.y + j) * w.n + b.x + i; w.buildGrid[k] = b.id; terrain.forest[k] = 0; }
  }
  for (const e of w.net.edges.values()) w.afterRoadAdded(e);
  w.refreshAccess();
  for (const bd of data.buildings) { const b = w.buildings.get(bd.id); if (b && bd.rs > 0) fillHome(w, b, bd.rs); }
  for (const s of data.stops) w.stops.set(s.id, { ...s });
  for (const l of data.lines) w.lines.set(l.id, { ...l } as TransitLine);
  w.vendors = data.vendors ?? [];
  recount(w);
  w.stopVersion++;
  for (const l of w.lines.values()) { l.active = recomputeLine(w, l) && l.active; }
  w.buildingVersion++; w.zoneVersion++; w.terrainVersion++;
  w.terrainDirty = true;
  return w;
}

// ───────── storage ─────────
/** Storage boundary: swap this for a backend later without touching game code. */
export interface SaveStore {
  list(): Promise<SaveMeta[]>;
  get(id: string): Promise<SaveData | null>;
  put(id: string, data: SaveData): Promise<void>;
  remove(id: string): Promise<void>;
}

class IdbStore implements SaveStore {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = new Promise((res, rej) => {
      const rq = indexedDB.open('nagara', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('saves'); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((res, rej) => { const rq = fn(db.transaction('saves', mode).objectStore('saves')); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  }
  async list() {
    const db = await this.db;
    return new Promise<SaveMeta[]>((res, rej) => {
      const out: SaveMeta[] = [];
      const rq = db.transaction('saves', 'readonly').objectStore('saves').openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { const d = c.value as SaveData; out.push({ ...d.meta, id: String(c.key) }); c.continue(); } else res(out.sort((a, b) => b.savedAt - a.savedAt)); };
      rq.onerror = () => rej(rq.error);
    });
  }
  async get(id: string) { return ((await this.tx('readonly', (s) => s.get(id))) as SaveData) ?? null; }
  async put(id: string, data: SaveData) { await this.tx('readwrite', (s) => s.put({ ...data, meta: { ...data.meta, id } }, id)); }
  async remove(id: string) { await this.tx('readwrite', (s) => s.delete(id)); }
}

class MemoryStore implements SaveStore {
  private m = new Map<string, SaveData>();
  async list() { return [...this.m.entries()].map(([id, d]) => ({ ...d.meta, id })).sort((a, b) => b.savedAt - a.savedAt); }
  async get(id: string) { return this.m.get(id) ?? null; }
  async put(id: string, d: SaveData) { this.m.set(id, d); }
  async remove(id: string) { this.m.delete(id); }
}

let store: SaveStore | null = null;
export function getStore(): SaveStore {
  if (store) return store;
  try { store = typeof indexedDB !== 'undefined' ? new IdbStore() : new MemoryStore(); } catch { store = new MemoryStore(); }
  return store;
}
export function setStore(s: SaveStore) { store = s; }
export const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5'];
export const AUTOSAVE = 'autosave';
