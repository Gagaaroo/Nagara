import { generateTerrain } from '../src/game/terrain/generate';
import { MapParams } from '../src/game/types';

const base: MapParams = { seed: 'Kaveri-2026', size: 'medium', terrain: 'rolling', region: 'south', water: 0.5, mountains: 0.4, forest: 0.5, resources: 'standard', difficulty: 'standard', sandbox: false };
const a = generateTerrain(base);
const b = generateTerrain(base);
const c = generateTerrain({ ...base, seed: 'other' });
console.log('deterministic', a.heights.every((v, i) => v === b.heights[i]), 'differs', a.heights.some((v, i) => v !== c.heights[i]));
for (const terrain of ['plains', 'rolling', 'coastal', 'valley', 'mountain', 'plateau'] as const) {
  const t = generateTerrain({ ...base, terrain });
  let min = 1e9, max = -1e9;
  t.heights.forEach((v) => { min = Math.min(min, v); max = Math.max(max, v); });
  const cls = [0, 0, 0, 0]; t.build.forEach((v) => cls[v]++);
  const wk = [0, 0, 0, 0, 0, 0]; t.waterKind.forEach((v) => wk[v]++);
  console.log(terrain, 'h', min.toFixed(0), max.toFixed(0), 'build', cls.map((v) => (v / t.build.length * 100).toFixed(0)).join('/'), 'water', wk.join(','), 'start', t.start, 'bodies', t.waterBodies.length, t.cityName);
}
