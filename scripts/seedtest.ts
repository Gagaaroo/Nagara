import { createWorld } from '../src/game/simulation/startCity';
import { MapParams, Zone } from '../src/game/types';
const terr = ['plains', 'rolling', 'coastal', 'valley', 'mountain', 'plateau'] as const;
const regions = ['south', 'north', 'west', 'coastal', 'mountain'] as const;
let bad = 0;
for (let i = 0; i < Number(process.argv[2] ?? 18); i++) {
  const params: MapParams = { seed: 'seed-' + i, size: (['small', 'medium', 'large'] as const)[i % 3], terrain: terr[i % 6], region: regions[i % 5], water: 0.1 + (i % 5) * 0.2, mountains: (i % 4) * 0.3, forest: 0.2 + (i % 3) * 0.3, resources: 'standard', difficulty: 'standard', sandbox: false };
  const w = createWorld(params);
  let zoned = 0; for (const z of w.zones) if (z) zoned++;
  const ok = w.stats.population >= 380;
  if (!ok) bad++;
  console.log(String(i).padStart(2), params.size.padEnd(6), params.terrain.padEnd(9), params.region.padEnd(9), 'start', w.terrain.start.x, w.terrain.start.y, 'edges', w.net.edges.size, 'zoned', zoned, 'bld', w.buildings.size, 'pop', w.stats.population, ok ? '' : '  <-- LOW');
}
console.log('low-pop starts:', bad);
