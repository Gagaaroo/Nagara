import { useSyncExternalStore } from 'react';
import type { World } from '../game/world';
import type { Simulation } from '../game/simulation/engine';
import { Alignment, ID, MapParams, RoadSpec, StructureMode, Terrain, TransitMode, Zone } from '../game/types';
import { PRESETS, cloneSpec } from '../game/roads/spec';
import type { RoadPlan } from '../game/roads/builder';
import type { OverlayKey } from '../rendering/overlays';
import { generateTerrain, randomSeedText } from '../game/terrain/generate';
import { createWorld } from '../game/simulation/startCity';
import { Simulation as Sim } from '../game/simulation/engine';
import { AUTOSAVE, SaveData, deserialize, getStore, serialize } from '../game/save/save';
import { RoadView } from '../rendering/roadView';
import { draftLine, lineBuildCost } from '../game/transportation/transit';

export type Screen = 'menu' | 'newcity' | 'game' | 'load' | 'settings' | 'about';
export type ToolId = 'select' | 'road' | 'bulldoze' | 'upgrade' | 'zone' | 'building' | 'busstop' | 'linepick' | 'layout';
export type ViewMode = 'city' | 'transport' | 'terrain' | 'transit';
export type Dock = 'none' | 'roads' | 'layouts' | 'zones' | 'transit' | 'services' | 'utilities' | 'parks' | 'buildings';
export type Panel = 'none' | 'mobility' | 'city' | 'budget' | 'lines' | 'help' | 'save' | 'overlays' | 'debug' | 'design';
export type Selection = { kind: 'edge' | 'node' | 'building' | 'stop' | 'line' | 'tile'; id: number; x?: number; y?: number } | null;

export interface Hover { x: number; y: number; h: number; slope: number; build: number; water: number; lv: number; zone: number; area: string; building?: string }
export interface Settings { renderScale: number; vehicleCap: 'low' | 'medium' | 'high'; autosave: boolean; confirmRoads: boolean; hints: boolean; shadowsLite: boolean }
export interface TransitDraft {
  family: 'bus' | 'metro' | 'rail'; mode: TransitMode; depot: ID; stops: ID[]; name: string; headwayMin: number; color: number; segAlign: Alignment[]; defaultAlign: Alignment; step: number;
}
export interface DraftPreview { line: import('../game/types').TransitLine | null; err: string; cost: number }
export interface RoadDraft { pts: [number, number][]; plan: RoadPlan | null; pending: boolean; path: number[] }

const SETTINGS_KEY = 'nagara.settings.v1';
const TEMPLATE_KEY = 'nagara.templates.v1';

const defaultSettings = (): Settings => ({ renderScale: 1, vehicleCap: 'medium', autosave: true, confirmRoads: false, hints: true, shadowsLite: false });

export const defaultParams = (): MapParams => ({
  seed: 'Kaveri-2026', size: 'medium', terrain: 'rolling', region: 'south', water: 0.5, mountains: 0.35, forest: 0.5, resources: 'standard', difficulty: 'standard', sandbox: false,
});

function loadJson<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? { ...fallback, ...JSON.parse(s) } : fallback; } catch { return fallback; }
}

class Store {
  version = 0;
  private listeners = new Set<() => void>();
  private pending = false;

  screen: Screen = 'menu';
  world: World | null = null;
  sim: Simulation | null = null;
  params: MapParams = defaultParams();
  previewTerrain: Terrain | null = null;
  settings: Settings = loadJson(SETTINGS_KEY, defaultSettings());
  hasAutosave = false;

  // tools
  tool: ToolId = 'select';
  dock: Dock = 'none';
  panel: Panel = 'none';
  roadSpec: RoadSpec = cloneSpec(PRESETS[0]);
  roadPreset = PRESETS[0].name;
  roadMode: 'line' | 'curve' = 'line';
  structure: StructureMode = 'auto';
  templates: RoadSpec[] = (() => { try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? '[]'); } catch { return []; } })();
  roadDraft: RoadDraft = { pts: [], plan: null, pending: false, path: [] };
  zone: Zone = Zone.ResLow;
  layoutKey: string | null = null;
  buildKey: string | null = null;
  buildRot = 0;
  buildIssue: string | null = null;
  stationAlign: Alignment = 'elevated';
  selection: Selection = null;
  overlay: OverlayKey = 'none';
  viewMode: ViewMode = 'city';
  transitDraft: TransitDraft | null = null;
  draftPreview: DraftPreview = { line: null, err: '', cost: 0 };
  debug = false;
  hover: Hover | null = null;
  toastSeen = 0;
  message = '';
  designMode = false;
  saveNote = '';
  intro = true;
  checklistOpen = true;
  baseline = { edges: 0, zoned: 0, buildings: 0 };
  lensesOpen = false;
  advRoad = false;
  view: import('../rendering/gameView').GameView | null = null;
  fps = 0;

  // ───── subscription ─────
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getSnapshot = () => this.version;
  emit() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; this.version++; for (const l of this.listeners) l(); });
  }

  // ───── settings ─────
  setSettings(p: Partial<Settings>) {
    this.settings = { ...this.settings, ...p };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage unavailable */ }
    this.applyRuntimeSettings();
    this.emit();
  }
  applyRuntimeSettings() {
    if (this.sim) this.sim.traffic.maxVehicles = this.settings.vehicleCap === 'low' ? 220 : this.settings.vehicleCap === 'high' ? 800 : 480;
    if (this.sim) this.sim.traffic.maxPeds = this.settings.vehicleCap === 'low' ? 160 : this.settings.vehicleCap === 'high' ? 600 : 360;
  }

  // ───── screens ─────
  go(s: Screen) { this.screen = s; if (s === 'menu') this.refreshAutosave(); this.emit(); }

  async refreshAutosave() {
    try { const l = await getStore().list(); this.hasAutosave = l.length > 0; this.emit(); } catch { this.hasAutosave = false; }
  }

  regenTerrain() {
    this.previewTerrain = generateTerrain(this.params);
    this.emit();
  }
  randomSeed() { this.params = { ...this.params, seed: randomSeedText() }; this.regenTerrain(); }

  startNew() {
    const world = createWorld(this.params, this.previewTerrain ?? undefined);
    this.attach(world);
  }

  worldId = 0;
  attach(world: World) {
    this.world = world;
    this.worldId++;
    this.sim = new Sim(world);
    this.sim.autosave = (w) => { if (this.settings.autosave) this.saveTo(AUTOSAVE, 'Autosave', true, w).catch(() => undefined); };
    this.applyRuntimeSettings();
    this.screen = 'game';
    this.tool = 'select'; this.dock = 'none'; this.panel = 'none'; this.selection = null; this.overlay = 'none'; this.viewMode = 'city';
    this.roadDraft = { pts: [], plan: null, pending: false, path: [] };
    this.transitDraft = null; this.designMode = false; this.toastSeen = world.msgSeq; this.intro = false; this.checklistOpen = this.settings.hints && world.day < 3; this.baseline = { edges: world.net.edges.size, zoned: world.zones.reduce((a, v) => a + (v ? 1 : 0), 0), buildings: world.buildings.size };
    this.emit();
  }

  async saveTo(id: string, name: string, auto = false, world?: World) {
    const w = world ?? this.world;
    if (!w) return;
    const data = serialize(w, name, auto, this.templates);
    await getStore().put(id, data);
    this.saveNote = `${auto ? 'Autosaved' : 'Saved'} ${new Date().toLocaleTimeString()}`;
    this.emit();
  }

  async loadFrom(id: string) {
    const data: SaveData | null = await getStore().get(id);
    if (!data) { this.message = 'Save not found'; this.emit(); return; }
    if (data.templates?.length) this.templates = data.templates;
    this.params = data.params;
    this.attach(deserialize(data));
  }

  async continueLatest() {
    const list = await getStore().list();
    if (list.length) await this.loadFrom(list[0].id);
  }

  exitToMenu() {
    this.world = null; this.sim = null;
    this.go('menu');
  }

  // ───── tools ─────
  setTool(t: ToolId) {
    if (this.tool === 'zone' && t !== 'zone' && this.overlay === 'zones') this.overlay = 'none';
    this.tool = t;
    this.roadDraft = { pts: [], plan: null, pending: false, path: [] };
    this.buildIssue = null;
    this.emit();
  }
  openDock(d: Dock) { this.dock = this.dock === d ? 'none' : d; this.emit(); }
  setPanel(p: Panel) { this.panel = this.panel === p ? 'none' : p; this.emit(); }
  choosePreset(name: string) {
    const p = PRESETS.find((x) => x.name === name);
    if (!p) return;
    this.roadSpec = cloneSpec(p); this.roadPreset = name; this.dock = 'none'; this.setTool('road');
  }
  patchRoad(p: Partial<RoadSpec>) { this.roadSpec = { ...this.roadSpec, ...p }; this.roadPreset = 'Custom'; this.roadDraft.plan = null; this.emit(); }
  saveTemplate(name: string) {
    const t = { ...this.roadSpec, name };
    this.templates = [...this.templates.filter((x) => x.name !== name), t];
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(this.templates)); } catch { /* ignore */ }
    this.roadPreset = name; this.roadSpec = t;
    this.emit();
  }
  deleteTemplate(name: string) {
    this.templates = this.templates.filter((x) => x.name !== name);
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(this.templates)); } catch { /* ignore */ }
    this.emit();
  }
  chooseTemplate(t: RoadSpec) { this.roadSpec = cloneSpec(t); this.roadPreset = t.name; this.dock = 'none'; this.setTool('road'); }
  chooseBuilding(key: string) { this.buildKey = key; this.buildRot = 0; this.tool = 'building'; this.dock = 'none'; this.buildIssue = null; this.emit(); }
  chooseLayout(key: string) { this.layoutKey = key; this.buildRot = 0; this.tool = 'layout'; this.dock = 'none'; this.emit(); }
  chooseZone(z: Zone) { this.zone = z; this.tool = 'zone'; this.dock = 'none'; this.overlay = 'zones'; this.emit(); }
  select(sel: Selection) { this.selection = sel; this.emit(); }
  setOverlay(o: OverlayKey) { this.overlay = this.overlay === o ? 'none' : o; this.emit(); }
  setViewMode(v: ViewMode) {
    this.viewMode = v;
    if (v === 'transport' && this.overlay === 'none') this.overlay = 'traffic';
    if (v === 'terrain' && this.overlay === 'none') this.overlay = 'elevation';
    if (v === 'transit' && this.overlay === 'none') this.overlay = 'pt';
    if (v === 'city' && ['traffic', 'elevation', 'pt'].includes(this.overlay)) this.overlay = 'none';
    this.emit();
  }
  toggleDesignMode() {
    this.designMode = !this.designMode;
    if (this.designMode) { this.setViewMode('transport'); this.overlay = 'traffic'; this.panel = 'mobility'; this.tool = 'select'; this.dock = 'none'; }
    else { this.viewMode = 'city'; this.overlay = 'none'; this.panel = 'none'; }
    this.emit();
  }
  startTransit(family: TransitDraft['family'], mode: TransitMode) {
    const w = this.world!;
    const colors = [0xe8743b, 0x2fa89a, 0x3e8fd4, 0xd9a21b, 0x8b6fcf, 0xc4483f, 0x58a65c];
    const depotKey = family === 'bus' ? 'bus_depot' : family === 'metro' ? 'metro_depot' : 'rail_yard';
    const depot = [...w.buildings.values()].find((b) => b.def === depotKey)?.id ?? 0;
    const n = [...w.lines.values()].filter((l) => (family === 'bus') === (['bus', 'ebus', 'artibus', 'minibus'].includes(l.mode))).length;
    this.transitDraft = {
      family, mode, depot, stops: [], name: family === 'bus' ? `Route ${101 + n}` : family === 'metro' ? ['Green', 'Amber', 'Blue', 'Violet', 'Teal'][n % 5] + ' Line' : `Rail ${n + 1}`,
      headwayMin: family === 'bus' ? 10 : family === 'metro' ? 5 : 15, color: colors[(w.lines.size) % colors.length], segAlign: [], defaultAlign: 'elevated', step: depot ? 2 : 1,
    };
    this.tool = 'linepick';
    this.panel = 'none';
    this.emit();
  }
  refreshDraft() {
    const d = this.transitDraft, w = this.world;
    if (!d || !w) { this.draftPreview = { line: null, err: '', cost: 0 }; return; }
    if (d.stops.length < 2) { this.draftPreview = { line: null, err: d.stops.length ? 'Add at least one more stop' : '', cost: 0 }; return; }
    const r = draftLine(w, { name: d.name, mode: d.mode, stops: d.stops, headwayMin: d.headwayMin, color: d.color, depot: d.depot, segAlign: d.segAlign, alignment: d.defaultAlign });
    if (typeof r === 'string') this.draftPreview = { line: null, err: r, cost: 0 };
    else this.draftPreview = { line: r, err: '', cost: lineBuildCost(w, r) };
  }
  cancelTransit() { this.transitDraft = null; this.tool = 'select'; this.emit(); }
  flash(msg: string) { this.message = msg; this.emit(); setTimeout(() => { if (this.message === msg) { this.message = ''; this.emit(); } }, 3200); }
}

export const store = new Store();
export function useStore(): Store { useSyncExternalStore(store.subscribe, store.getSnapshot); return store; }
export type { Store };
export { RoadView };
