import { createWorld } from '../src/game/simulation/startCity';
import { Simulation } from '../src/game/simulation/engine';
import { MapParams, Zone } from '../src/game/types';
import { planRoad, commitRoad } from '../src/game/roads/builder';
import { PRESETS } from '../src/game/roads/spec';
import { DEFS } from '../src/data/buildings';
import { placeBuilding, placeBusStop, makeLine } from '../src/game/actions';
import { addBusStop } from '../src/game/transportation/transit';

const params: MapParams = { seed: process.argv[2] ?? 'Kaveri-2026', size: (process.argv[3] as any) ?? 'medium', terrain: (process.argv[4] as any) ?? 'rolling', region: 'south', water: 0.5, mountains: 0.4, forest: 0.5, resources: 'rich', difficulty: 'standard', sandbox: true };
const world = createWorld(params);
const sim = new Simulation(world);
sim.setSpeed(3);
world.free = true;
const spec = (n: string) => PRESETS.find((p) => p.name === n)!;
const t = world.terrain;
const cx = Math.round(t.start.x), cy = Math.round(t.start.y);
const road = (x0: number, y0: number, x1: number, y1: number, name: string, mode: any = 'auto') => {
  const plan = planRoad(world, [x0, y0, x1, y1], spec(name), mode);
  if (plan.pieces.length && (plan.valid || true)) commitRoad(world, plan, spec(name));
  return plan;
};
const SPARSE = process.argv[6] === 'sparse';
// grid of streets
if (!SPARSE) for (let i = -30; i <= 30; i += 6) { road(cx + i, cy - 34, cx + i, cy + 34, i % 12 === 0 ? 'Collector Road' : 'Local Street', 'ground'); }
if (!SPARSE) for (let j = -30; j <= 30; j += 6) { road(cx - 34, cy + j, cx + 34, cy + j, j % 12 === 0 ? 'Urban Avenue' : 'Local Street', 'ground'); }
world.net.touch(true);
const zone = (x0: number, y0: number, x1: number, y1: number, z: Zone) => world.paintZone(cx + x0, cy + y0, cx + x1, cy + y1, z);
zone(-30, -30, 30, 30, Zone.ResLow);
zone(-18, -18, 18, 18, Zone.ResMed);
zone(-6, -6, 6, 6, Zone.Commercial);
zone(-12, -12, -7, 12, Zone.Mixed);
zone(20, -30, 30, -10, Zone.Industrial);
zone(7, 7, 14, 14, Zone.ResHigh);
zone(-5, 12, 5, 18, Zone.Office);
const put = (k: string, x: number, y: number) => { for (let r = 0; r < 12; r++) for (let a = 0; a < 16; a++) { const xx = cx + x + Math.round(Math.cos(a) * r), yy = cy + y + Math.round(Math.sin(a) * r); if (placeBuilding(world, k, xx, yy, 0).ok) return true; } return false; };
for (const [k, x, y] of [['school', 6, -4], ['school', -8, 8], ['clinic', 3, 3], ['police', -3, 2], ['fire', 4, -10], ['power_thermal', -34, 20], ['substation', 10, 10], ['substation', -12, -12], ['substation', 12, -12], ['substation', -12, 12], ['water_treatment', -30, -26], ['water_tower', 12, 12], ['water_tower', -12, -10], ['water_tower', 14, -16], ['borewell', 0, 20], ['borewell', 8, 22], ['market_local', 0, -3], ['hospital_gov', -14, 3], ['college', 14, -5], ['auto_stand', 2, 0], ['park_big', 8, 18], ['temple', -20, 4], ['warehouse', 22, -6], ['bus_terminal', 0, 6]] as const) {
  const ok = put(k, x, y); if (!ok) console.log('could not place', k);
}
for (let gx = -28; gx <= 28; gx += 14) for (let gy = -28; gy <= 28; gy += 14) { put('substation', gx, gy); put('water_tower', gx + 3, gy + 3); }
for (const [x, y] of [[-26, -20], [-26, 20], [26, 20]] as const) put('water_treatment', x, y);
put('power_thermal', -34, -10);
for (const [x, y] of [[18, 18], [-18, 18], [18, -18], [-18, -18], [0, -22], [0, 24]] as const) { put('school', x, y); put('clinic', x + 4, y + 2); }
world.refreshAccess();
// bus route along the central avenue
const stops: number[] = [];
const ne = (x: number, y: number) => world.net.nearestEdge(x, y, 3);
for (const x of [-24, -16, -8, 0, 8, 16, 24]) { const e = ne(cx + x, cy + 1); if (e) { const r = addBusStop(world, e.e.id, e.s, true); if (typeof r !== 'string') stops.push(r.id); else console.log('stop err', r); } }
const depot = [...world.buildings.values()].find((b) => b.def === 'bus_depot');
const bl = makeLine(world, { name: 'Route 101', mode: 'bus', stops, headwayMin: 8, color: 0xe8743b, depot: depot?.id ?? 0 });
console.log('bus line', bl.ok, bl.msg, 'stops', stops.length);
// metro
const mst: number[] = [];
const putM = (x: number, y: number) => { for (let r = 0; r < 8; r++) for (let a = 0; a < 16; a++) { const xx = cx + x + Math.round(Math.cos(a) * r), yy = cy + y + Math.round(Math.sin(a) * r); const res = placeBuilding(world, 'station_metro', xx, yy, 0, 'elevated'); if (res.ok) { const b = world.buildingAt(xx, yy)!; const s = [...world.stops.values()].find((q) => q.building === b.id); if (s) mst.push(s.id); return; } } };
for (const x of [-26, -10, 6, 22]) putM(x, -2);
put('metro_depot', -30, 28);
const md = [...world.buildings.values()].find((b) => b.def === 'metro_depot');
const ml = makeLine(world, { name: 'Green Line', mode: 'metro', stops: mst, headwayMin: 5, color: 0x2fa89a, depot: md?.id ?? 0, alignment: 'elevated' });
console.log('metro line', ml.ok, ml.msg, 'stations', mst.length);
world.free = false;
world.money = 99999;
const dt = 1 / 30;
let peakCong = 0, peakVeh = 0, minSpd = 99, peakWorst = '';
const report = () => {
  const s = world.stats, tr = sim.traffic;
  console.log(`day ${Math.floor(world.day)} pop ${s.population} bld ${world.buildings.size} veh ${tr.vehicles.length} ped ${tr.peds.length} trains ${tr.trains.length} money ${world.money.toFixed(0)} happy ${s.happiness.toFixed(2)} peakCong ${peakCong.toFixed(2)} (${peakWorst}) minSpd ${minSpd.toFixed(0)} peakVeh ${peakVeh} K ${tr.debug.kScale.toFixed(1)} emp ${s.employed}/${s.workers} jobs ${s.jobs} commute ${s.avgCommuteMin.toFixed(0)}m ${s.avgDistKm.toFixed(1)}km | ${Object.entries(s.modal).map(([k, v]) => `${k}${(v * 100).toFixed(0)}`).join(' ')} | R${s.demand.r.toFixed(1)} C${s.demand.c.toFixed(1)} I${s.demand.i.toFixed(1)} O${s.demand.o.toFixed(1)} | lastmile ${s.lastMile.toFixed(2)} pt ${s.ptCoverage.toFixed(2)} unreach ${s.unreachable.toFixed(0)} unserved ${s.unserved} weather ${world.weather} flood ${s.floodedTiles} income ${s.incomeMonth.toFixed(0)}/${s.expenseMonth.toFixed(0)}`);
};
const days = Number(process.argv[5] ?? 40);
let next = 5;
const t0 = Date.now();
while (world.day < days) {
  sim.update(dt);
  if (world.stats.congestion > peakCong) { peakCong = world.stats.congestion; let worst = 0; for (const e of world.net.edges.values()) { const v = Math.max(e.flowVc?.[0] ?? 0, e.flowVc?.[1] ?? 0); if (v > worst) { worst = v; peakWorst = e.spec.name + ' ' + v.toFixed(2); } } }
  peakVeh = Math.max(peakVeh, sim.traffic.vehicles.length); if (world.stats.avgSpeed > 0) minSpd = Math.min(minSpd, world.stats.avgSpeed);
  if (world.day >= next) { report(); next += 5; peakCong = 0; peakVeh = 0; minSpd = 99; }
}
report();
console.log('wall', ((Date.now() - t0) / 1000).toFixed(1), 's; simMs', sim.debug.simMs.toFixed(2), 'jobs', JSON.stringify(sim.debug.jobMs));
for (const l of world.lines.values()) console.log('line', l.name, 'active', l.active, 'riders/day', l.ridersToday.toFixed(0), 'load', l.loadFactor.toFixed(2), 'veh', l.vehicles);
console.log('traffic debug', JSON.stringify(sim.traffic.debug));
