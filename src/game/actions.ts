/** Player commands. Every command validates, charges the treasury and mutates the world. */
import type { World } from './world';
import { ID, Alignment, RoadSpec, TransitMode, TransitStop, Zone, NodeControl } from './types';
import { RoadPlan, commitRoad, planRoad } from './roads/builder';
import { DEFS } from '../data/buildings';
import { addBusStop, addStationStop, createLine, deleteLine, setLineFrequency, TRANSIT, trackCost } from './transportation/transit';
import { costPerTile, finalizeSpec, laneCount, STRUCTURE_COST } from './roads/spec';
import { Structure } from './types';

export interface Result { ok: boolean; msg: string }
const fail = (msg: string): Result => ({ ok: false, msg });
const ok = (msg = ''): Result => ({ ok: true, msg });

// ───────── unlocks ─────────
export const ROAD_UNLOCK: Record<string, number> = {
  'Local Street': 0, 'Neighbourhood Lane': 0, 'Collector Road': 0, 'Service Road': 0, 'Industrial Road': 0,
  'Urban Avenue': 3000, 'Arterial Road': 3000, 'Bus-Only Street': 5000, 'Freight Corridor': 8000, Highway: 10000, 'Transit Corridor': 15000,
};

export function specUnlock(spec: RoadSpec): { pop: number; why: string } {
  let pop = 0, why = '';
  const need = (p: number, w: string) => { if (p > pop) { pop = p; why = w; } };
  if (Math.max(spec.lanesFwd, spec.lanesBwd) >= 3) need(3000, '3+ lanes per direction');
  if (spec.speed >= 80) need(10000, 'speed limits above 70 km/h');
  if (spec.bus === 'dedicated' || spec.bus === 'busonly') need(2000, 'dedicated bus infrastructure');
  if (spec.median === 'landscaped' || spec.median === 'raised' || spec.median === 'barrier') need(800, 'raised medians');
  if (spec.bike === 'protected' || spec.bike === 'track') need(1200, 'protected cycle infrastructure');
  if (spec.drain === 'storm') need(5000, 'stormwater drains');
  if (spec.trucks === 'priority') need(8000, 'freight corridors');
  return { pop, why };
}

export const FEATURE_UNLOCK = { signals: 1500, roundabout: 1500, turnRestrict: 4000, metro: 25000, suburban: 35000, regional: 50000, busTerminal: 1500, articulated: 15000, ebus: 8000, undergroundUtilities: 25000, logistics: 40000 };

// ───────── roads ─────────
export function previewRoad(world: World, path: number[], spec: RoadSpec, mode: Parameters<typeof planRoad>[3]): RoadPlan {
  return planRoad(world, path, finalizeSpec(spec), mode);
}

export function buildRoad(world: World, plan: RoadPlan, spec: RoadSpec): Result {
  const sp = finalizeSpec(spec);
  const lock = specUnlock(sp);
  if (!world.isUnlocked(lock.pop)) return fail(`Locked until ${lock.pop.toLocaleString('en-IN')} citizens (${lock.why})`);
  if (!plan.valid) return fail(plan.issues[0] ?? 'Cannot build here');
  if (!world.spend(plan.cost)) return fail('Not enough funds');
  commitRoad(world, plan, sp);
  return ok();
}

export function upgradeRoad(world: World, edgeId: ID, spec: RoadSpec): Result {
  const e = world.net.edges.get(edgeId);
  if (!e) return fail('Select a road');
  const sp = finalizeSpec(spec);
  const lock = specUnlock(sp);
  if (!world.isUnlocked(lock.pop)) return fail(`Locked until ${lock.pop.toLocaleString('en-IN')} citizens`);
  const newCost = e.len * costPerTile(sp) * STRUCTURE_COST[e.structure] * world.costMultiplier();
  const diff = Math.max(0.5, newCost - e.cost * 0.5);
  if (!world.spend(diff)) return fail(`Not enough funds (${diff.toFixed(1)} L)`);
  e.spec = sp;
  e.cost = newCost;
  world.net.finishEdge(e);
  // keep any vehicles consistent: lanes were rebuilt, so clear them
  world.net.touch(true);
  world.accessDirty = true;
  world.assignDirty = true;
  return ok(`Road upgraded to ${sp.name}`);
}

export function patchRoad(world: World, edgeId: ID, patch: Partial<RoadSpec>): Result {
  const e = world.net.edges.get(edgeId);
  if (!e) return fail('Select a road');
  const lanesChanged = (patch.lanesFwd !== undefined && patch.lanesFwd !== e.spec.lanesFwd) || (patch.lanesBwd !== undefined && patch.lanesBwd !== e.spec.lanesBwd);
  e.spec = finalizeSpec({ ...e.spec, ...patch });
  e.spec.name = patch.name ?? e.spec.name;
  world.net.finishEdge(e);
  if (lanesChanged) world.net.touch(true); else world.net.touch(false);
  world.assignDirty = true;
  return ok();
}

export function reverseRoad(world: World, edgeId: ID): Result {
  const e = world.net.edges.get(edgeId);
  if (!e) return fail('Select a road');
  if (e.spec.lanesBwd !== 0 && e.spec.lanesFwd !== 0) return fail('Only one-way roads can be reversed');
  const sp = { ...e.spec, lanesFwd: e.spec.lanesBwd, lanesBwd: e.spec.lanesFwd };
  e.spec = sp;
  world.net.finishEdge(e);
  world.net.touch(true);
  world.assignDirty = true;
  return ok('Direction reversed');
}

export function bulldozeAt(world: World, x: number, y: number, tolerance = 0.55): Result {
  const b = world.buildingAt(x, y);
  if (b) {
    if (world.isLandmark(b)) { /* allowed but costly */ }
    const c = world.demolishCost(b) * 0.3;
    if (!world.spend(c)) return fail('Not enough funds');
    world.demolish(b.id);
    return ok(`${b.name} demolished`);
  }
  // stops
  for (const s of world.stops.values()) if (s.kind === 'bus' && Math.hypot(s.x - x, s.y - y) < 0.7) { world.removeStop(s.id); return ok('Bus stop removed'); }
  const ne = world.net.nearestEdge(x, y, tolerance + 0.3);
  if (ne) {
    const c = Math.max(0.5, ne.e.cost * 0.1);
    if (!world.spend(c)) return fail('Not enough funds');
    world.removeRoad(ne.e.id);
    return ok('Road removed');
  }
  const k = world.idx(x, y);
  if (world.inb(x, y) && world.zones[k]) { world.paintZone(Math.floor(x), Math.floor(y), Math.floor(x), Math.floor(y), Zone.None); return ok('Zone cleared'); }
  return fail('Nothing to demolish');
}

export function demolishRoad(world: World, edgeId: ID): Result {
  const e = world.net.edges.get(edgeId);
  if (!e) return fail('Select a road');
  const c = Math.max(0.5, e.cost * 0.1);
  if (!world.spend(c)) return fail('Not enough funds');
  world.removeRoad(edgeId);
  return ok('Road removed');
}

export function zoneRect(world: World, x0: number, y0: number, x1: number, y1: number, zone: Zone): Result {
  const info = zone === Zone.None ? null : { unlock: zoneUnlock(zone) };
  if (info && !world.isUnlocked(info.unlock)) return fail(`Locked until ${info.unlock.toLocaleString('en-IN')} citizens`);
  const c = world.paintZone(x0, y0, x1, y1, zone);
  return c ? ok(`${c} tiles ${zone === Zone.None ? 'cleared' : 'zoned'}`) : fail('Nothing to zone here');
}
export const zoneUnlock = (z: Zone): number => ({ [Zone.ResHigh]: 25000, [Zone.Mixed]: 1500, [Zone.Office]: 4000 } as Record<number, number>)[z] ?? 0;

// ───────── buildings ─────────
export function buildingIssue(world: World, key: string, x: number, y: number, rot: number): string | null {
  const def = DEFS[key];
  if (!def) return 'Unknown building';
  if (!world.isUnlocked(def.unlock)) return `Unlocks at ${def.unlock!.toLocaleString('en-IN')} citizens`;
  const c = world.canPlace(def, x, y, rot);
  if (!c.ok) return c.reason;
  const needsRoad = def.cat === 'service' || def.cat === 'transit' || def.cat === 'market' || def.cat === 'logistics' || def.cat === 'culture' || def.cat === 'landmark' && def.service !== 'park';
  if (needsRoad || key === 'water_pump') {
    const w = rot % 2 ? def.h : def.w, h = rot % 2 ? def.w : def.h;
    if (!world.findAccess(x, y, w, h)) return 'Needs a road within 4 tiles';
  }
  if (key.startsWith('station_') && !world.findAccess(x, y, def.w, def.h, 6)) return 'Needs a road within 6 tiles';
  if (world.placeCost(def, x, y, rot) > world.money + 1e-6) return 'Not enough funds';
  return null;
}

export function placeBuilding(world: World, key: string, x: number, y: number, rot: number, alignment: Alignment = 'elevated'): Result {
  const issue = buildingIssue(world, key, x, y, rot);
  if (issue) return fail(issue);
  const def = DEFS[key];
  const b = world.placeBuilding(def, x, y, rot, { instant: false, wealth: 1 });
  if (!b) return fail('Cannot place here');
  if (key === 'bus_terminal') addStationStop(world, b.id, 'terminal', 'surface');
  else if (key === 'station_metro') addStationStop(world, b.id, 'metro', alignment);
  else if (key === 'station_suburban') addStationStop(world, b.id, 'suburban', 'surface');
  else if (key === 'station_regional' || key === 'lm_central_station') addStationStop(world, b.id, 'regional', 'surface');
  b.progress = def.cat === 'transit' || def.cat === 'park' || key === 'auto_stand' ? 1 : 0;
  world.buildingVersion++;
  return ok(`${def.name} placed`);
}

// ───────── intersections ─────────
export function patchNode(world: World, nodeId: ID, patch: Partial<{ control: NodeControl; crossings: boolean; busPriority: boolean; turnLanes: boolean; cycle: number; mainShare: number }>): Result {
  const n = world.net.nodes.get(nodeId);
  if (!n) return fail('Select an intersection');
  if (patch.control === 'signal' || patch.control === 'roundabout') {
    if (!world.isUnlocked(FEATURE_UNLOCK.signals)) return fail(`Signals unlock at ${FEATURE_UNLOCK.signals.toLocaleString('en-IN')} citizens`);
  }
  const cost = (patch.control && patch.control !== n.control ? (patch.control === 'roundabout' ? 24 : patch.control === 'signal' ? 14 : 2) : 0) + (patch.crossings && !n.crossings ? 2 : 0) + (patch.turnLanes && !n.turnLanes ? 6 : 0);
  if (cost && !world.spend(cost * world.costMultiplier())) return fail('Not enough funds');
  Object.assign(n, patch);
  world.net.touch(true);
  world.assignDirty = true;
  return ok();
}

export function toggleTurnBan(world: World, nodeId: ID, edgeId: ID, bit: number): Result {
  const n = world.net.nodes.get(nodeId);
  if (!n) return fail('Select an intersection');
  if (!world.isUnlocked(FEATURE_UNLOCK.turnRestrict)) return fail(`Turn restrictions unlock at ${FEATURE_UNLOCK.turnRestrict.toLocaleString('en-IN')} citizens`);
  n.banned[edgeId] = (n.banned[edgeId] ?? 0) ^ bit;
  if (!n.banned[edgeId]) delete n.banned[edgeId];
  world.net.touch(true);
  world.assignDirty = true;
  return ok();
}

// ───────── transit ─────────
export function placeBusStop(world: World, x: number, y: number, shelter: boolean): Result {
  const ne = world.net.nearestEdge(x, y, 1.1, (e) => e.structure !== 'tunnel');
  if (!ne) return fail('Place the stop on a road');
  const r = addBusStop(world, ne.e.id, ne.s, shelter);
  return typeof r === 'string' ? fail(r) : ok('Bus stop placed');
}

export function makeLine(world: World, p: { name: string; mode: TransitMode; stops: ID[]; headwayMin: number; color: number; depot: ID; segAlign?: Alignment[]; alignment?: Alignment }): Result & { id?: ID } {
  const spec = TRANSIT[p.mode];
  if (!world.isUnlocked(p.mode === 'metro' ? FEATURE_UNLOCK.metro : p.mode === 'suburban' ? FEATURE_UNLOCK.suburban : p.mode === 'regional' ? FEATURE_UNLOCK.regional : p.mode === 'artibus' ? FEATURE_UNLOCK.articulated : p.mode === 'ebus' ? FEATURE_UNLOCK.ebus : 0))
    return fail(`${spec.name} is locked`);
  const r = createLine(world, p);
  if (typeof r === 'string') return fail(r);
  world.notify(`${r.name} is running`, 'good');
  return { ok: true, msg: 'Line activated', id: r.id };
}

export function editLine(world: World, id: ID, patch: { name?: string; headwayMin?: number; active?: boolean; color?: number }): Result {
  const l = world.lines.get(id);
  if (!l) return fail('Line not found');
  if (patch.name !== undefined) l.name = patch.name;
  if (patch.color !== undefined) l.color = patch.color;
  if (patch.active !== undefined) l.active = patch.active;
  if (patch.headwayMin !== undefined) {
    const before = l.vehicles;
    setLineFrequency(world, l, patch.headwayMin);
    const extra = (l.vehicles - before) * TRANSIT[l.mode].vehicleCost * world.costMultiplier();
    if (extra > 0 && !world.spend(extra)) { setLineFrequency(world, l, patch.headwayMin * 2); return fail('Not enough funds for extra vehicles'); }
  }
  world.stopVersion++;
  return ok();
}

export function removeLine(world: World, id: ID): Result { deleteLine(world, id); return ok('Line removed'); }

export function railCostPreview(world: World, mode: TransitMode, stopIds: ID[], segAlign: Alignment[]): number {
  let c = 0;
  for (let i = 0; i + 1 < stopIds.length; i++) {
    const a = world.stops.get(stopIds[i]), b = world.stops.get(stopIds[i + 1]);
    if (!a || !b) continue;
    const L = Math.hypot(a.x - b.x, a.y - b.y) * 1.1;
    const al = segAlign[i] ?? 'elevated';
    c += L * (mode === 'metro' ? (al === 'underground' ? 38 : al === 'elevated' ? 15 : 7) : (al === 'underground' ? 42 : al === 'elevated' ? 12 : 5));
  }
  return c * world.costMultiplier();
}

export function stopById(world: World, id: ID): TransitStop | undefined { return world.stops.get(id); }
export { laneCount, trackCost };
export type { Structure };
