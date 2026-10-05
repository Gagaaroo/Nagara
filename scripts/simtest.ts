import { createWorld } from '../src/game/simulation/startCity';
import { Simulation } from '../src/game/simulation/engine';
import { MapParams } from '../src/game/types';
import { generateTerrain } from '../src/game/terrain/generate';

const params: MapParams = { seed: process.argv[2] ?? 'Kaveri-2026', size: 'medium', terrain: (process.argv[3] as any) ?? 'rolling', region: 'south', water: 0.5, mountains: 0.4, forest: 0.5, resources: 'standard', difficulty: 'standard', sandbox: false };
const t0 = Date.now();
const world = createWorld(params);
console.log('world created in', Date.now() - t0, 'ms', world.cityName, 'start', world.terrain.start, 'entry', world.terrain.entry);
console.log('edges', world.net.edges.size, 'nodes', world.net.nodes.size, 'buildings', world.buildings.size, 'pop', world.stats.population, 'citizens', world.citizens.length, 'money', world.money.toFixed(0));
const sim = new Simulation(world);
sim.setSpeed(2);
const dt = 1 / 30;
let simSecs = 0;
const t1 = Date.now();
const report = () => {
  const s = world.stats, tr = sim.traffic;
  console.log(`day ${world.day.toFixed(0)} ${world.timeLabel()} pop ${s.population} bld ${world.buildings.size} veh ${tr.vehicles.length} ped ${tr.peds.length} money ${world.money.toFixed(0)} happy ${s.happiness.toFixed(2)} cong ${s.congestion.toFixed(2)} spd ${s.avgSpeed.toFixed(0)} emp ${s.employed}/${s.workers} jobs ${s.jobs} commute ${s.avgCommuteMin.toFixed(1)}m dist ${s.avgDistKm.toFixed(1)}km inc ${s.incomeMonth.toFixed(1)} exp ${s.expenseMonth.toFixed(1)} unreach ${s.unreachable.toFixed(0)}`);
  console.log('  modal', Object.entries(s.modal).map(([k, v]) => `${k}:${(v * 100).toFixed(0)}`).join(' '), 'demand', Object.entries(s.demand).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' '));
  console.log('  debug', JSON.stringify(tr.debug), 'trips', tr.assigner.trips.length, 'power', s.powerSupply.toFixed(1) + '/' + s.powerDemand.toFixed(1), 'water', s.waterSupply.toFixed(1) + '/' + s.waterDemand.toFixed(1), 'freight', s.freightTrips.toFixed(0));
};
report();
const days = Number(process.argv[4] ?? 6);
let nextReport = 1;
while (world.day < days) {
  sim.update(dt);
  simSecs += dt;
  if (world.day >= nextReport) { report(); nextReport++; }
}
console.log('simulated', simSecs.toFixed(0), 's game in', Date.now() - t1, 'ms; simMs avg', sim.debug.simMs.toFixed(2));
