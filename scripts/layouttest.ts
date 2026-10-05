import { createWorld } from '../src/game/simulation/startCity';
import { LAYOUTS, rotateLayout } from '../src/data/layouts';
import { DEFS } from '../src/data/buildings';
import { placeBuilding } from '../src/game/actions';
import { MapParams } from '../src/game/types';
const w = createWorld({ seed: 'Kaveri-2026', size: 'medium', terrain: 'plains', region: 'south', water: 0.2, mountains: 0.1, forest: 0.2, resources: 'rich', difficulty: 'relaxed', sandbox: true } as MapParams);
w.money = 1e6; w.unlockAll = true;
const cx = Math.round(w.terrain.start.x), cy = Math.round(w.terrain.start.y);
for (const l of LAYOUTS) for (const r of [0, 1]) {
  const items = rotateLayout(l, r); let placed = 0, tried = 0;
  outer: for (let dy = -28; dy < 28; dy += 3) for (let dx = -28; dx < 28; dx += 3) {
    const ok = items.every((i) => w.canPlace(DEFS[i.key], cx + dx + i.ox, cy + dy + i.oy, i.rot).ok);
    if (!ok) continue; tried++;
    for (const i of items) if (placeBuilding(w, i.key, cx + dx + i.ox, cy + dy + i.oy, i.rot).ok) placed++;
    break outer;
  }
  console.log(l.key, 'rot', r, 'items', items.length, 'placed', placed);
}
