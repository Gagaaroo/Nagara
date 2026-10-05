/** Random-action fuzz test: hammer the command layer and simulation, report any exception. */
import { createWorld } from '../src/game/simulation/startCity';
import { Simulation } from '../src/game/simulation/engine';
import { MapParams, Zone, StructureMode } from '../src/game/types';
import * as A from '../src/game/actions';
import { PRESETS } from '../src/game/roads/spec';
import { BUILDINGS } from '../src/data/buildings';
import { mulberry32 } from '../src/utils/rng';
import { addBusStop, draftLine } from '../src/game/transportation/transit';

const seed = Number(process.argv[2] ?? 1);
const rng = mulberry32(seed);
const terrains = ['plains', 'rolling', 'coastal', 'valley', 'mountain', 'plateau'] as const;
const params: MapParams = { seed: 'fuzz' + seed, size: 'small', terrain: terrains[seed % 6], region: 'south', water: 0.6, mountains: 0.6, forest: 0.5, resources: 'rich', difficulty: 'standard', sandbox: true };
const world = createWorld(params);
const sim = new Simulation(world);
sim.setSpeed(3);
world.money = 1e7;
const n = world.n;
let errors = 0;
const rr = (a: number, b: number) => a + rng() * (b - a);
const modes: StructureMode[] = ['auto', 'ground', 'elevated', 'depressed', 'bridge', 'tunnel'];
const tick = (k = 20) => { for (let i = 0; i < k; i++) sim.update(1 / 30); };
for (let step = 0; step < 220; step++) {
  try {
    const r = rng();
    if (r < 0.34) {
      const sp = { ...PRESETS[Math.floor(rng() * PRESETS.length)] };
      if (rng() < 0.4) { sp.lanesFwd = 1 + Math.floor(rng() * 5); sp.lanesBwd = rng() < 0.3 ? 0 : 1 + Math.floor(rng() * 5); sp.speed = 10 + Math.floor(rng() * 22) * 5; }
      const x0 = rr(3, n - 3), y0 = rr(3, n - 3), a = rng() * 6.28, L = rr(2, 25);
      const path = [x0, y0, x0 + Math.cos(a) * L, y0 + Math.sin(a) * L];
      const plan = A.previewRoad(world, path, sp, modes[Math.floor(rng() * modes.length)]);
      if (plan.valid || rng() < 0.2) A.buildRoad(world, plan, sp);
    } else if (r < 0.5) {
      const z = Math.floor(rng() * 8) as Zone;
      A.zoneRect(world, Math.floor(rr(0, n - 10)), Math.floor(rr(0, n - 10)), Math.floor(rr(0, n)), Math.floor(rr(0, n)), z);
    } else if (r < 0.66) {
      const def = BUILDINGS[Math.floor(rng() * BUILDINGS.length)];
      A.placeBuilding(world, def.key, Math.floor(rr(0, n - 3)), Math.floor(rr(0, n - 3)), Math.floor(rng() * 4), (['elevated', 'surface', 'underground'] as const)[Math.floor(rng() * 3)]);
    } else if (r < 0.74) {
      A.bulldozeAt(world, rr(0, n), rr(0, n));
    } else if (r < 0.8) {
      const nodes = [...world.net.nodes.values()];
      if (nodes.length) {
        const nd = nodes[Math.floor(rng() * nodes.length)];
        A.patchNode(world, nd.id, { control: (['auto', 'priority', 'signal', 'roundabout', 'none'] as const)[Math.floor(rng() * 5)], crossings: rng() < 0.5, turnLanes: rng() < 0.5, busPriority: rng() < 0.5, cycle: 40 + Math.floor(rng() * 80) });
        if (nd.edges.length) A.toggleTurnBan(world, nd.id, nd.edges[0], 1 << Math.floor(rng() * 4));
      }
    } else if (r < 0.86) {
      const edges = [...world.net.edges.values()];
      if (edges.length) {
        const e = edges[Math.floor(rng() * edges.length)];
        const q = rng();
        if (q < 0.3) A.upgradeRoad(world, e.id, PRESETS[Math.floor(rng() * PRESETS.length)]);
        else if (q < 0.5) A.patchRoad(world, e.id, { lanesFwd: 1 + Math.floor(rng() * 4), speed: 20 + Math.floor(rng() * 16) * 5 });
        else if (q < 0.65) A.reverseRoad(world, e.id);
        else if (q < 0.8) A.demolishRoad(world, e.id);
        else A.patchRoad(world, e.id, { trucks: (['allowed', 'banned', 'priority'] as const)[Math.floor(rng() * 3)] });
      }
    } else if (r < 0.94) {
      const edges = [...world.net.edges.values()].filter((e) => e.structure === 'ground');
      const ids: number[] = [];
      for (let i = 0; i < 2 + Math.floor(rng() * 4) && edges.length; i++) { const e = edges[Math.floor(rng() * edges.length)]; const res = addBusStop(world, e.id, e.len * rng(), rng() < 0.5); if (typeof res !== 'string') ids.push(res.id); }
      const depot = [...world.buildings.values()].find((b) => b.def === 'bus_depot');
      if (ids.length >= 2) { const l = A.makeLine(world, { name: 'F' + step, mode: (['bus', 'ebus', 'artibus', 'minibus'] as const)[Math.floor(rng() * 4)], stops: ids, headwayMin: 3 + Math.floor(rng() * 20), color: 0xe8743b, depot: depot?.id ?? 0 }); void l; }
    } else {
      const stations = [...world.stops.values()].filter((s) => s.kind === 'metro' || s.kind === 'suburban' || s.kind === 'regional');
      if (stations.length >= 2) { const pick = stations.sort(() => rng() - 0.5).slice(0, 2 + Math.floor(rng() * 3)); const d = draftLine(world, { name: 'm', mode: 'metro', stops: pick.map((s) => s.id), headwayMin: 6, color: 0x3e8fd4, depot: 0, alignment: 'underground' }); if (typeof d !== 'string' && rng() < 0.5) A.makeLine(world, { name: 'M' + step, mode: 'metro', stops: pick.map((s) => s.id), headwayMin: 6, color: 0x3e8fd4, depot: 0, alignment: 'elevated' }); }
    }
    tick(10 + Math.floor(rng() * 40));
  } catch (e) {
    errors++;
    console.log('ERROR at step', step, (e as Error).stack?.split('\n').slice(0, 4).join('\n'));
    if (errors > 5) break;
  }
}
tick(300);
const s = world.stats;
console.log(`seed ${seed} ${params.terrain}: errors ${errors} | pop ${s.population} bld ${world.buildings.size} edges ${world.net.edges.size} nodes ${world.net.nodes.size} lines ${world.lines.size} veh ${sim.traffic.vehicles.length} day ${world.day.toFixed(0)} NaN? ${[s.happiness, s.congestion, s.avgSpeed, world.money].some((v) => !isFinite(v))}`);
