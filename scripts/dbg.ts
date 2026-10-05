import { createWorld } from '../src/game/simulation/startCity';
import { MapParams, Zone } from '../src/game/types';
const params: MapParams = { seed: 'Kaveri-2026', size: 'medium', terrain: 'rolling', region: 'south', water: 0.5, mountains: 0.4, forest: 0.5, resources: 'standard', difficulty: 'standard', sandbox: false };
const w = createWorld(params);
const z = [0,0,0,0,0,0,0,0]; w.zones.forEach(v => z[v]++);
console.log('zones', z, 'edges', [...w.net.edges.values()].map(e => `${e.spec.name}:${e.structure}:${e.len.toFixed(0)}`).join(' | '));
let pw = 0, wt = 0, fr = 0, zoned=0;
for (let i = 0; i < w.n*w.n; i++) { if (w.zones[i]) { zoned++; if (w.fields.power[i] > 0) pw++; if (w.fields.water[i] > 0) wt++; if (w.fields.frontage[i] >= 0.25) fr++; } }
console.log('zoned', zoned, 'power', pw, 'water', wt, 'frontage', fr);
console.log([...w.buildings.values()].map(b => b.def).join(','));
console.log('start', w.terrain.start, 'entry', w.terrain.entry);
