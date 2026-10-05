import { createWorld } from '../src/game/simulation/startCity';
import { Simulation } from '../src/game/simulation/engine';
import { Zone, MapParams } from '../src/game/types';
import { planRoad, commitRoad } from '../src/game/roads/builder';
import { PRESETS } from '../src/game/roads/spec';
const params: MapParams = { seed: 'Kaveri-2026', size: 'medium', terrain: 'rolling', region: 'south', water: 0.5, mountains: 0.35, forest: 0.5, resources: 'standard', difficulty: 'standard', sandbox: false };
const w = createWorld(params); const sim = new Simulation(w); sim.setSpeed(1);
const t = w.terrain; const sp = PRESETS[0];
// new street east of town and zone both sides
const plan = planRoad(w, [t.start.x + 18, t.start.y - 10, t.start.x + 18, t.start.y + 12], sp, 'auto'); commitRoad(w, plan, sp);
w.free = false;
const before = w.buildings.size;
const n = w.paintZone(t.start.x + 14, t.start.y - 9, t.start.x + 22, t.start.y + 10, Zone.ResLow);
console.log('zoned', n, 'tiles; buildings before', before, 'roadAccess sample', w.hasRoadAccess(t.start.x + 15.5, t.start.y + 0.5));
for (let sec = 1; sec <= 20; sec++) { for (let i = 0; i < 30; i++) sim.update(1 / 30); if (sec % 4 === 0) console.log(sec + 's buildings', w.buildings.size, 'done', [...w.buildings.values()].filter(b => b.progress >= 1).length, 'pop', w.stats.population); }
