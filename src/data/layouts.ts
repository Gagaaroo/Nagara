import { DEFS } from './buildings';
import { Zone } from '../game/types';

export interface LayoutItem { key: string; x: number; y: number; level?: number; wealth?: number }
export interface Layout { key: string; name: string; desc: string; items: LayoutItem[]; w: number; h: number; unlock?: number }

const L = (key: string, name: string, desc: string, items: LayoutItem[], unlock = 0): Layout => {
  let w = 0, h = 0;
  for (const it of items) { const d = DEFS[it.key]; w = Math.max(w, it.x + d.w); h = Math.max(h, it.y + d.h); }
  return { key, name, desc, items, w, h, unlock };
};

/** Ready-made building groups. Face the open side toward a road: buildings need a road within 4 tiles. */
export const LAYOUTS: Layout[] = [
  L('colony', 'Residential colony', 'Houses and row houses around a small park, with an auto stand.', [
    { key: 'house', x: 0, y: 0 }, { key: 'house', x: 1, y: 0 }, { key: 'row_house', x: 2, y: 0 }, { key: 'row_house', x: 3, y: 0 }, { key: 'house', x: 4, y: 0 }, { key: 'house', x: 5, y: 0 },
    { key: 'small_apt', x: 0, y: 2 }, { key: 'park_small', x: 2, y: 2 }, { key: 'small_apt', x: 3, y: 2 }, { key: 'auto_stand', x: 4, y: 2 }, { key: 'house', x: 5, y: 2 },
    { key: 'house', x: 0, y: 3 }, { key: 'row_house', x: 1, y: 3 }, { key: 'row_house', x: 3, y: 3 }, { key: 'row_house', x: 4, y: 3 }, { key: 'house', x: 5, y: 3 },
  ]),
  L('apartments', 'Apartment cluster', 'Mid-rise apartment blocks with a clinic and a green court.', [
    { key: 'apt_block', x: 0, y: 0 }, { key: 'apt_block', x: 2, y: 0 }, { key: 'modern_apt', x: 4, y: 0, level: 8 },
    { key: 'park_small', x: 0, y: 2 }, { key: 'clinic', x: 1, y: 2 }, { key: 'apt_block', x: 2, y: 2 }, { key: 'auto_stand', x: 4, y: 2 },
  ]),
  L('market', 'Market street', 'A walkable strip of shopping street, shops, food and a local market.', [
    { key: 'shop_street', x: 0, y: 0 }, { key: 'shop', x: 2, y: 0 }, { key: 'restaurant', x: 3, y: 0 }, { key: 'shop_street', x: 4, y: 0 }, { key: 'shop', x: 6, y: 0 },
    { key: 'market_local', x: 0, y: 2 }, { key: 'restaurant', x: 2, y: 2 }, { key: 'shop', x: 3, y: 2 }, { key: 'auto_stand', x: 4, y: 2 }, { key: 'shop_street', x: 5, y: 2 },
  ]),
  L('mall', 'Shopping complex', 'Two malls, food court shops, a bus terminal and an auto stand.', [
    { key: 'mall', x: 0, y: 0 }, { key: 'mall', x: 2, y: 0 }, { key: 'restaurant', x: 4, y: 0 }, { key: 'shop', x: 5, y: 0 },
    { key: 'shop_street', x: 4, y: 1 }, { key: 'bus_terminal', x: 0, y: 2 }, { key: 'auto_stand', x: 3, y: 2 }, { key: 'restaurant', x: 4, y: 2 },
  ], 8000),
  L('itpark', 'Office & IT park', 'Office blocks and IT towers with cafés and a park.', [
    { key: 'it_tower', x: 0, y: 0, level: 12 }, { key: 'it_tower', x: 2, y: 0, level: 14 }, { key: 'office', x: 4, y: 0 }, { key: 'office', x: 6, y: 0 },
    { key: 'biz_park', x: 0, y: 2 }, { key: 'park_small', x: 3, y: 2 }, { key: 'restaurant', x: 4, y: 2 }, { key: 'restaurant', x: 5, y: 2 }, { key: 'auto_stand', x: 6, y: 2 },
  ], 25000),
  L('office', 'Office block', 'Corporate offices with shops and a park, available earlier.', [
    { key: 'office', x: 0, y: 0 }, { key: 'office', x: 2, y: 0 }, { key: 'restaurant', x: 4, y: 0 }, { key: 'park_small', x: 0, y: 1 }, { key: 'shop', x: 1, y: 1 },
  ], 4000),
  L('mixed', 'Mixed-use neighbourhood', 'Shops below, homes above, plus a school and park: lots of short trips.', [
    { key: 'mixed_mid', x: 0, y: 0 }, { key: 'mixed_low', x: 2, y: 0 }, { key: 'mixed_low', x: 3, y: 0 }, { key: 'mixed_mid', x: 4, y: 0 },
    { key: 'mixed_low', x: 0, y: 1 }, { key: 'park_small', x: 1, y: 1 }, { key: 'school', x: 2, y: 1 }, { key: 'shop', x: 4, y: 1 }, { key: 'restaurant', x: 5, y: 1 },
  ], 1500),
];

/** Rotate a layout by r quarter turns; returns items with a rotation flag (odd = footprint swapped). */
export function rotateLayout(l: Layout, r: number) {
  return l.items.map((it) => {
    const d = DEFS[it.key];
    let x = it.x, y = it.y, w = d.w, h = d.h;
    for (let k = 0; k < r % 4; k++) { const nx = l.h * 0 - y - h; const ny = x; x = nx; y = ny; [w, h] = [h, w]; }
    return { ...it, ox: x, oy: y, rot: r % 2 === 1 ? 1 : 0, w, h };
  }).map((it, _i, arr) => {
    const minX = Math.min(...arr.map((a) => a.ox)), minY = Math.min(...arr.map((a) => a.oy));
    return { ...it, ox: it.ox - minX, oy: it.oy - minY };
  });
}
export { Zone };
