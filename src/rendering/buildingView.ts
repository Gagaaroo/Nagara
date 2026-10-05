import * as THREE from 'three';
import type { World } from '../game/world';
import { Building, HEIGHT_SCALE, ID } from '../game/types';
import { DEFS, BuildingDef } from '../data/buildings';
import { MeshBuilder, signAtlas } from './meshBuilder';
import { AWNING, ROOF_COLORS, WALL_PALETTES } from './palette';

const HS = HEIGHT_SCALE;
const FLOOR = 0.1;
const CH = 16;

const rnd = (seed: number, k: number) => { let h = (seed * 2654435761 + k * 40503) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const shade = (c: number, f: number) => { const r = Math.min(255, Math.round(((c >> 16) & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round((c & 255) * f)); return (r << 16) | (g << 8) | b; };
const desat = (c: number, f: number) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; const m = (r + g + b) / 3; const mx = (a: number) => Math.round(m + (a - m) * f); return (mx(r) << 16) | (mx(g) << 8) | mx(b); };

interface Ctx { mb: MeshBuilder; sb: MeshBuilder; W: number; D: number; sx: number; sz: number; levels: number; v: number; wealth: number; def: BuildingDef; wall: number; roof: number; accent: number; dim: boolean }

function sign(c: Ctx, x: number, y: number, z: number, w: number, h: number, k = 0) {
  const cell = (c.v * 7 + k * 5) % 32, col = cell % 4, row = Math.floor(cell / 4);
  const u0 = col / 4, u1 = (col + 1) / 4, v1 = 1 - row / 8, v0 = 1 - (row + 1) / 8;
  c.sb.quad([x - w / 2, y, z], [x + w / 2, y, z], [x + w / 2, y + h, z], [x - w / 2, y + h, z], 0xffffff, [u0, v0, u1, v0, u1, v1, u0, v1]);
}
function tank(mb: MeshBuilder, x: number, y: number, z: number, r = 0.035) {
  mb.cylinder(x, y, z, r, 0.06, 0xdfe7ea, 8);
  mb.cylinder(x, y, z, r * 0.2, 0.0, 0x444444, 3, r * 0.2, false);
}
function parapet(mb: MeshBuilder, sx: number, sz: number, y: number, color: number) {
  const t = 0.014, h = 0.03;
  mb.box(0, y, sz / 2 - t / 2, sx, h, t, color, { noBottom: true });
  mb.box(0, y, -sz / 2 + t / 2, sx, h, t, color, { noBottom: true });
  mb.box(sx / 2 - t / 2, y, 0, t, h, sz, color, { noBottom: true });
  mb.box(-sx / 2 + t / 2, y, 0, t, h, sz, color, { noBottom: true });
}
function balconies(mb: MeshBuilder, sx: number, sz: number, floors: number, color: number, v: number) {
  for (let f = 1; f < floors; f += 1) {
    if (rnd(v, f) < 0.15) continue;
    mb.box(0, f * FLOOR - 0.008, sz / 2 + 0.014, sx * 0.78, 0.014, 0.028, color, { noBottom: true });
  }
}
function cross(mb: MeshBuilder, x: number, y: number, z: number, s: number, color = 0xd23b3b) {
  mb.box(x, y, z, s * 0.35, s, 0.01, color, { noBottom: true });
  mb.box(x, y + s * 0.325, z, s, s * 0.35, 0.01, color, { noBottom: true });
}
function awning(mb: MeshBuilder, x: number, y: number, z: number, w: number, color: number) {
  mb.quad([x - w / 2, y, z + 0.07], [x + w / 2, y, z + 0.07], [x + w / 2, y + 0.04, z], [x - w / 2, y + 0.04, z], color, undefined, 1);
}

const SHAPES: Record<string, (c: Ctx) => void> = {
  house: ({ mb, sx, sz, levels, v, wealth, wall, roof, accent }) => {
    const bw = sx * (0.7 + rnd(v, 1) * 0.15), bd = sz * 0.62;
    const h = levels * FLOOR + 0.02;
    mb.box(0, 0, -sz * 0.08, bw, h, bd, wall, { bays: 4, floors: levels });
    if (wealth === 2) {
      mb.box(0, h, -sz * 0.08, bw + 0.04, 0.025, bd + 0.04, 0xe8e4da, { noBottom: true });
      mb.box(0.1, 0, sz * 0.2, bw * 0.5, 0.07, 0.1, shade(wall, 0.95), { bays: 3, floors: 1 });
    } else if (rnd(v, 2) < 0.6) mb.gable(0, h, -sz * 0.08, bw, bd, 0.085, roof, 0.025);
    else { parapet(mb, bw, bd, h, shade(wall, 0.9)); tank(mb, bw * 0.25, h, 0, 0.028); }
    mb.box(0, 0, sz * 0.26, bw * 0.5, 0.03, 0.12, shade(wall, 0.9), { noBottom: true }); // porch slab
    mb.box(-bw * 0.28, 0, sz * 0.26, 0.012, 0.075, 0.012, accent, { noBottom: true });
    mb.box(bw * 0.28, 0, sz * 0.26, 0.012, 0.075, 0.012, accent, { noBottom: true });
  },
  row: ({ mb, sx, sz, levels, v, wall }) => {
    const units = 3;
    const uw = sx / units;
    for (let i = 0; i < units; i++) {
      const c = WALL_PALETTES[(v + i) % WALL_PALETTES.length][(v + i * 3) % 4];
      const h = (levels + (rnd(v, i) < 0.35 ? 1 : 0)) * FLOOR + 0.02;
      const x = -sx / 2 + uw * (i + 0.5);
      mb.box(x, 0, 0, uw * 0.96, h, sz * 0.7, i === 1 ? wall : c, { bays: 3, floors: Math.round(h / FLOOR) });
      mb.box(x, h, 0, uw * 0.96, 0.02, sz * 0.7, 0xcfcac0, { noBottom: true });
      if (rnd(v, 5 + i) < 0.6) tank(mb, x, h + 0.02, -sz * 0.1, 0.03);
      mb.box(x, 0.0, sz * 0.38, uw * 0.7, 0.02, 0.08, 0xb5b0a4, { noBottom: true });
    }
  },
  apt: ({ mb, sx, sz, levels, v, wall, roof, dim }) => {
    const h = levels * FLOOR;
    const bx = sx * 0.9, bz = sz * 0.82;
    mb.box(0, 0, 0, bx, h, bz, wall, { bays: 5, floors: levels });
    parapet(mb, bx, bz, h, shade(wall, 0.85));
    balconies(mb, bx, bz, levels, shade(wall, 0.7), v);
    tank(mb, -bx * 0.25, h, 0, 0.034); if (bx > 0.9) tank(mb, bx * 0.25, h, 0, 0.034);
    mb.box(bx * 0.3, h, bz * 0.2, 0.1, 0.06, 0.1, shade(wall, 0.95), { noBottom: true });
    void roof; void dim;
  },
  tower: ({ mb, sx, sz, levels, v, wall, wealth }) => {
    const glass = wealth === 2 ? 0xa9c6d4 : wall;
    const podium = Math.min(2, Math.max(1, Math.floor(levels / 6)));
    mb.box(0, 0, 0, sx * 0.96, podium * FLOOR + 0.02, sz * 0.96, shade(wall, 0.92), { bays: 5, floors: podium });
    const h = levels * FLOOR;
    mb.box(0, podium * FLOOR, 0, sx * 0.72, h - podium * FLOOR, sz * 0.72, glass, { bays: 5, floors: levels - podium });
    if (levels > 10) mb.box(0, h, 0, sx * 0.5, 0.1, sz * 0.5, shade(glass, 0.9), { bays: 4, floors: 1 });
    mb.box(0, h + (levels > 10 ? 0.1 : 0), 0, 0.02, 0.18, 0.02, 0xc9c9c9, { noBottom: true });
    for (let f = 4; f < levels; f += 4) mb.box(0, f * FLOOR - 0.01, sz * 0.36 + 0.012, sx * 0.55, 0.012, 0.024, 0xf0eee6, { noBottom: true });
    void v;
  },
  complex: ({ mb, sx, sz, levels, v, wall }) => {
    const h = levels * FLOOR;
    const bw = sx * 0.28;
    mb.box(-sx * 0.32, 0, 0, bw, h, sz * 0.84, wall, { bays: 4, floors: levels });
    mb.box(sx * 0.32, 0, 0, bw, h * 0.9, sz * 0.84, shade(wall, 0.96), { bays: 4, floors: Math.round(levels * 0.9) });
    mb.box(0, 0, -sz * 0.34, sx * 0.4, h * 0.8, sz * 0.2, shade(wall, 0.9), { bays: 4, floors: Math.round(levels * 0.8) });
    mb.flat(0, 0.004, sz * 0.1, sx * 0.38, sz * 0.5, 0x6e9a58);
    for (const x of [-sx * 0.32, sx * 0.32]) tank(mb, x, h, 0, 0.04);
    void v;
  },
  shop: (c) => {
    const { mb, sx, sz, levels, v, wall, accent } = c;
    const bw = sx * 0.84, bd = sz * 0.76;
    sign(c, 0, 0.085, bd / 2 + 0.017, bw * 0.66, 0.03 * 1.0, 1);
    const h = levels * FLOOR * 0.92 + 0.02;
    mb.box(0, 0, 0, bw, h, bd, wall, { bays: 4, floors: levels });
    mb.box(0, 0.0, bd / 2 + 0.002, bw * 0.9, 0.055, 0.004, 0x30363b, { noBottom: true });
    awning(mb, 0, 0.065, bd / 2, bw * 0.9, accent);
    mb.box(0, 0.085, bd / 2 + 0.01, bw * 0.7, 0.03, 0.012, AWNING[(v + 2) % AWNING.length], { noBottom: true });
    parapet(mb, bw, bd, h, shade(wall, 0.85));
  },
  bazaar: (c) => {
    const { mb, sx, sz, levels, v, wall } = c;
    const n = Math.max(3, Math.round(sx / 0.32));
    const uw = (sx * 0.96) / n;
    for (let i = 0; i < n; i++) {
      const x = -sx * 0.48 + uw * (i + 0.5);
      const h = (levels + (rnd(v, i) < 0.4 ? 0 : -0.3)) * FLOOR * 0.9 + 0.03;
      mb.box(x, 0, -sz * 0.12, uw * 0.94, h, sz * 0.5, WALL_PALETTES[(v + i) % 5][i % 4], { bays: 3, floors: Math.round(levels) });
      awning(mb, x, 0.06, sz * 0.13, uw * 0.94, AWNING[(v + i) % AWNING.length]);
      sign(c, x, 0.085, sz * 0.13 + 0.002, uw * 0.8, 0.025, i);
      // stall in front
      mb.box(x, 0, sz * 0.34, uw * 0.5, 0.035, 0.07, 0x9b7b58, { noBottom: true });
      mb.pyramid(x, 0.075, sz * 0.34, uw * 0.7, 0.14, 0.03, 0.03, AWNING[(v + i + 3) % AWNING.length]);
    }
    void wall;
  },
  mall: (c) => {
    const { mb, sx, sz, levels, wall, accent } = c;
    sign(c, 0, levels * FLOOR * 0.62 + 0.002, sz * 0.43 + 0.041, sx * 0.55, 0.05, 3);
    const h = levels * FLOOR;
    mb.box(0, 0, 0, sx * 0.92, h, sz * 0.86, shade(wall, 0.96), { bays: 4, floors: levels });
    mb.box(0, 0.02, sz * 0.43 + 0.004, sx * 0.8, h * 0.5, 0.01, 0x7fa6b8, { noBottom: true });
    mb.box(0, h * 0.62, sz * 0.43 + 0.02, sx * 0.55, 0.05, 0.04, accent, { noBottom: true });
    mb.box(0, 0, sz * 0.46, sx * 0.4, 0.07, 0.1, 0xd8d4c8, { noBottom: true });
    parapet(mb, sx * 0.92, sz * 0.86, h, shade(wall, 0.85));
    mb.box(-sx * 0.2, h, 0, 0.2, 0.05, 0.2, 0xb8b8b0, { noBottom: true });
  },
  market: ({ mb, sx, sz, v, def }) => {
    mb.flat(0, 0.004, 0, sx * 0.96, sz * 0.96, 0xb3a98e);
    const big = def.key === 'lm_market';
    const cols = Math.max(2, Math.round(sx / 0.45)), rows = Math.max(2, Math.round(sz / 0.45));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = -sx * 0.4 + (sx * 0.8 * (i + 0.5)) / cols, z = -sz * 0.4 + (sz * 0.8 * (j + 0.5)) / rows;
      const c = AWNING[(v + i * 3 + j * 5) % AWNING.length];
      mb.box(x, 0, z, 0.1, 0.035, 0.08, 0x8b6f4e, { noBottom: true });
      mb.pyramid(x, 0.06, z, 0.2, 0.18, 0.045, 0.02, c);
      mb.box(x - 0.08, 0, z - 0.07, 0.008, 0.075, 0.008, 0xd9d4c8, { noBottom: true });
    }
    if (big) { mb.dome(0, 0.12, 0, 0.22, 0xe5d3a8, 10, 4); mb.cylinder(0, 0, 0, 0.2, 0.12, 0xdcc89c, 10); }
    // low perimeter wall
    parapet(mb, sx * 0.98, sz * 0.98, 0, 0xcfc7b3);
  },
  factory: ({ mb, sx, sz, v, wall }) => {
    const h = 0.22;
    mb.box(0, 0, 0, sx * 0.9, h, sz * 0.7, 0xb6bbbd, { bays: 3, floors: 2 });
    const teeth = Math.max(3, Math.round(sx / 0.22));
    for (let i = 0; i < teeth; i++) {
      const x = -sx * 0.45 + (sx * 0.9 * (i + 0.5)) / teeth;
      mb.pyramid(x, h, 0, (sx * 0.9) / teeth, sz * 0.7, 0.06, 0.0, 0x8e9498);
    }
    mb.cylinder(sx * 0.32, 0, -sz * 0.25, 0.04, 0.48, 0xb85a3c, 8, 0.03);
    mb.box(sx * 0.32, 0.42, -sz * 0.25, 0.09, 0.015, 0.09, 0xefefef, {});
    mb.cylinder(-sx * 0.35, 0, sz * 0.33, 0.06, 0.12, 0xd8dde0, 8);
    mb.box(0, 0, sz * 0.4, sx * 0.9, 0.004, sz * 0.2, 0x8d8a82, { noBottom: true });
    void v; void wall;
  },
  warehouse: ({ mb, sx, sz, v }) => {
    const h = 0.16;
    mb.box(0, 0, 0, sx * 0.9, h, sz * 0.82, [0x9db4c8, 0xc9c0a8, 0xb0b8b3][v % 3], { bays: 2, floors: 1 });
    mb.gable(0, h, 0, sx * 0.9, sz * 0.82, 0.04, 0x7e8a92, 0.01);
    const doors = Math.max(2, Math.round(sx / 0.35));
    for (let i = 0; i < doors; i++) mb.box(-sx * 0.38 + (sx * 0.76 * i) / Math.max(1, doors - 1), 0, sz * 0.41 + 0.003, 0.12, 0.09, 0.006, 0x2f3a42, { noBottom: true });
    mb.box(0, 0, sz * 0.46, sx * 0.9, 0.003, 0.1, 0x77746c, { noBottom: true });
  },
  office: ({ mb, sx, sz, levels, v, wall }) => {
    const h = levels * FLOOR;
    mb.box(0, 0, 0, sx * 0.9, h, sz * 0.8, [0xb7c9d3, 0xdadcd8, 0xc2d0c9][v % 3], { bays: 5, floors: levels });
    mb.box(0, h, 0, sx * 0.9, 0.025, sz * 0.8, 0xe8e6de, { noBottom: true });
    mb.box(-sx * 0.2, h + 0.025, 0, 0.14, 0.05, 0.12, 0xb8b8b0, { noBottom: true });
    mb.box(0, 0, sz * 0.42, sx * 0.4, 0.07, 0.07, 0xd8d6cc, { noBottom: true });
    void wall;
  },
  ittower: ({ mb, sx, sz, levels, v }) => {
    const h = levels * FLOOR;
    mb.box(0, 0, 0, sx * 0.95, 0.1, sz * 0.95, 0xd6d9d7, { bays: 4, floors: 1 });
    mb.box(0, 0.1, 0, sx * 0.62, h - 0.1, sz * 0.62, [0x88b9c4, 0x93aecb, 0x7fb5ae][v % 3], { bays: 6, floors: levels });
    mb.box(0, h, 0, sx * 0.7, 0.04, sz * 0.7, 0xe8e8e2, { noBottom: true });
    mb.box(0, h + 0.04, 0, sx * 0.4, 0.06, sz * 0.4, 0xc8d4d8, { noBottom: true });
    mb.box(0, h + 0.1, 0, 0.018, 0.22, 0.018, 0xe6e6e6, { noBottom: true });
    mb.box(0, h + 0.28, 0, 0.04, 0.012, 0.04, 0xe8554a, { noBottom: true });
  },
  campus: ({ mb, sx, sz, levels, v }) => {
    const h = levels * FLOOR;
    mb.flat(0, 0.004, 0, sx * 0.96, sz * 0.96, 0x72a05c);
    for (const [x, z, k] of [[-0.3, -0.25, 1], [0.3, -0.2, 0.8], [0, 0.3, 0.9]] as [number, number, number][])
      mb.box(sx * x, 0, sz * z, sx * 0.34, h * k, sz * 0.26, [0xbfd0d8, 0xd9dcd8, 0xa9c4cc][(v + Math.round(x * 5)) % 3], { bays: 4, floors: Math.max(1, Math.round(levels * k)) });
    mb.dome(0, 0, sz * 0.02, 0.18, 0x9fc4d4, 8, 3);
    mb.box(0, 0.005, sz * 0.12, sx * 0.1, 0.002, sz * 0.5, 0xd8cdb0, { noBottom: true });
  },
  school: ({ mb, sx, sz, v }) => {
    const c = [0xe9d7a8, 0xe4cbb0, 0xd9e3c9][v % 3];
    mb.box(0, 0, -sz * 0.25, sx * 0.9, 0.2, sz * 0.28, c, { bays: 5, floors: 2 });
    mb.box(-sx * 0.38, 0, sz * 0.05, sx * 0.14, 0.2, sz * 0.4, c, { bays: 3, floors: 2 });
    mb.box(sx * 0.38, 0, sz * 0.05, sx * 0.14, 0.2, sz * 0.4, c, { bays: 3, floors: 2 });
    parapet(mb, sx * 0.9, sz * 0.28, 0.2, shade(c, 0.85));
    mb.flat(0, 0.004, sz * 0.2, sx * 0.55, sz * 0.5, 0xc7b99a);
    mb.box(sx * 0.1, 0, sz * 0.3, 0.012, 0.22, 0.012, 0xd9d9d9, { noBottom: true });
    mb.box(sx * 0.14, 0.17, sz * 0.3, 0.05, 0.035, 0.004, 0xe8743b, { noBottom: true });
  },
  hospital: ({ mb, sx, sz, levels }) => {
    const h = Math.max(4, Math.min(6, levels + 3)) * FLOOR;
    mb.box(0, 0, 0, sx * 0.9, h, sz * 0.4, 0xf1f0eb, { bays: 5, floors: Math.round(h / FLOOR) });
    mb.box(-sx * 0.3, 0, sz * 0.25, sx * 0.3, h * 0.75, sz * 0.4, 0xe8e7e1, { bays: 3, floors: Math.round((h * 0.75) / FLOOR) });
    mb.box(sx * 0.3, 0, sz * 0.25, sx * 0.3, h * 0.75, sz * 0.4, 0xe8e7e1, { bays: 3, floors: Math.round((h * 0.75) / FLOOR) });
    cross(mb, 0, h * 0.55, sz * 0.2 + 0.001, 0.09);
    mb.box(0, h, 0, sx * 0.4, 0.04, sz * 0.2, 0xd0d0c8, { noBottom: true });
    mb.box(0, 0, sz * 0.46, sx * 0.3, 0.003, 0.05, 0xe9b7b0, { noBottom: true });
  },
  clinic: ({ mb, sx, sz }) => {
    mb.box(0, 0, 0, sx * 0.72, 0.18, sz * 0.6, 0xf1f0eb, { bays: 4, floors: 2 });
    parapet(mb, sx * 0.72, sz * 0.6, 0.18, 0xdcdad2);
    cross(mb, 0, 0.1, sz * 0.3 + 0.002, 0.06);
  },
  station: ({ mb, sx, sz, def, v }) => {
    const grand = def.key === 'lm_central_station';
    mb.box(0, 0, -sz * 0.18, sx * 0.9, grand ? 0.28 : 0.16, sz * 0.4, grand ? 0xc9a889 : 0xd6d3c8, { bays: 5, floors: grand ? 3 : 1 });
    if (grand) { mb.box(0, 0.28, -sz * 0.18, sx * 0.3, 0.14, sz * 0.4, 0xb89a7d, { bays: 3, floors: 1 }); mb.dome(0, 0.42, -sz * 0.18, 0.12, 0xa68d6e, 8, 3); }
    // platform canopy
    mb.box(0, 0.003, sz * 0.2, sx * 0.9, 0.012, sz * 0.4, 0x9c978a, { noBottom: true });
    mb.gable(0, 0.14, sz * 0.2, sx * 0.9, sz * 0.36, 0.05, def.key === 'station_metro' ? 0x3e8fd4 : 0x8d9aa2, 0.01);
    for (let i = 0; i < 4; i++) mb.box(-sx * 0.38 + (sx * 0.76 * i) / 3, 0.0, sz * 0.2, 0.014, 0.14, 0.014, 0x777b7e, { noBottom: true });
    mb.box(0, 0.145, -sz * 0.0, sx * 0.2, 0.03, 0.004, AWNING[v % AWNING.length], { noBottom: true });
    // rails
    mb.box(0, 0, sz * 0.4, sx * 0.96, 0.006, 0.015, 0x555a5e, { noBottom: true });
    mb.box(0, 0, sz * 0.46, sx * 0.96, 0.006, 0.015, 0x555a5e, { noBottom: true });
  },
  terminal: ({ mb, sx, sz, v }) => {
    mb.flat(0, 0.004, 0, sx * 0.96, sz * 0.96, 0x6a6e72);
    mb.box(0, 0.13, -sz * 0.1, sx * 0.92, 0.025, sz * 0.5, 0xe9a53c, { noBottom: true });
    for (let i = 0; i < 5; i++) mb.box(-sx * 0.42 + (sx * 0.84 * i) / 4, 0, -sz * 0.1, 0.016, 0.13, 0.016, 0x777b7e, { noBottom: true });
    mb.box(0, 0, -sz * 0.4, sx * 0.5, 0.1, sz * 0.12, 0xd8d4c8, { bays: 3, floors: 1 });
    for (let i = 0; i < 4; i++) mb.box(-sx * 0.36 + (sx * 0.72 * i) / 3, 0.004, sz * 0.25, 0.012, 0.002, sz * 0.3, 0xe8e6de, { noBottom: true });
    void v;
  },
  depot: ({ mb, sx, sz, def }) => {
    const big = def.key === 'metro_depot' || def.key === 'rail_yard';
    mb.box(0, 0, -sz * 0.1, sx * 0.92, big ? 0.16 : 0.12, sz * 0.6, 0xaeb4b8, { bays: 2, floors: 1 });
    mb.gable(0, big ? 0.16 : 0.12, -sz * 0.1, sx * 0.92, sz * 0.6, 0.04, 0x7b848a, 0.01);
    const bays = Math.max(3, Math.round(sx / 0.4));
    for (let i = 0; i < bays; i++) mb.box(-sx * 0.38 + (sx * 0.76 * i) / (bays - 1), 0, sz * 0.2 + 0.003, 0.14, 0.09, 0.006, 0x2a3036, { noBottom: true });
    mb.flat(0, 0.004, sz * 0.36, sx * 0.9, sz * 0.24, 0x6f7377);
    if (big) for (let i = 0; i < 3; i++) mb.box(0, 0.005, sz * 0.3 + i * 0.07, sx * 0.9, 0.004, 0.012, 0x5a5f63, { noBottom: true });
  },
  temple: ({ mb, sx, sz, v, def }) => {
    const big = def.key === 'lm_temple';
    mb.box(0, 0, 0, sx * 0.94, 0.03, sz * 0.94, 0xd7c9a8, { noBottom: true });
    mb.box(0, 0.03, sz * 0.18, sx * 0.5, 0.1, sz * 0.4, 0xe9ddc0, { bays: 3, floors: 1 });
    const c = [0xd9b36a, 0xe1c58d, 0xcba26a][v % 3];
    let y = 0.03, w = Math.min(sx, sz) * 0.4;
    for (let t = 0; t < 5; t++) { mb.pyramid(0, y, -sz * 0.12, w, w, 0.075, w * 0.78, t % 2 ? shade(c, 0.9) : c); y += 0.075; w *= 0.78; }
    mb.pyramid(0, y, -sz * 0.12, w, w, 0.06, 0.0, 0xcf7a3a);
    mb.cylinder(0, y + 0.06, -sz * 0.12, 0.012, 0.04, 0xf0c64a, 6);
    if (big) for (const x of [-0.3, 0.3]) { mb.pyramid(sx * x, 0.03, sz * 0.3, 0.2, 0.2, 0.16, 0.06, 0xdcb978); }
    mb.flat(0, 0.032, sz * 0.38, sx * 0.14, sz * 0.2, 0xb34a3a);
  },
  mosque: ({ mb, sx, sz }) => {
    mb.box(0, 0, 0, sx * 0.62, 0.15, sz * 0.62, 0xf3eadb, { bays: 3, floors: 1 });
    mb.dome(0, 0.15, 0, Math.min(sx, sz) * 0.22, 0xe4eee8, 12, 5);
    mb.cylinder(0, 0.15 + Math.min(sx, sz) * 0.22, 0, 0.006, 0.05, 0xd9b84a, 4);
    for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36]] as [number, number][]) {
      mb.cylinder(sx * x, 0, sz * z, 0.026, 0.34, 0xf3eadb, 8, 0.022);
      mb.cylinder(sx * x, 0.34, sz * z, 0.034, 0.02, 0xd9b84a, 8);
      mb.dome(sx * x, 0.36, sz * z, 0.026, 0xe4eee8, 6, 2);
    }
    mb.flat(0, 0.003, sz * 0.4, sx * 0.9, sz * 0.2, 0xd6cdb7);
    for (const x of [-0.2, 0, 0.2]) mb.dome(sx * x, 0.15, sz * 0.31, 0.06, 0xe4eee8, 6, 2);
  },
  church: ({ mb, sx, sz }) => {
    mb.box(0, 0, 0, sx * 0.62, 0.14, sz * 0.84, 0xf0eadf, { bays: 3, floors: 1 });
    mb.gable(0, 0.14, 0, sx * 0.62, sz * 0.84, 0.07, 0xa55c43, 0.02);
    mb.box(0, 0, sz * 0.38, 0.1, 0.28, 0.1, 0xf0eadf, { bays: 1, floors: 3 });
    mb.pyramid(0, 0.28, sz * 0.38, 0.11, 0.11, 0.14, 0.0, 0xa55c43);
    mb.box(0, 0.43, sz * 0.38, 0.006, 0.05, 0.006, 0xd9b84a, { noBottom: true });
    mb.box(0, 0.455, sz * 0.38, 0.03, 0.006, 0.006, 0xd9b84a, { noBottom: true });
  },
  gurdwara: ({ mb, sx, sz }) => {
    mb.box(0, 0, 0, sx * 0.72, 0.2, sz * 0.68, 0xf6f2ea, { bays: 4, floors: 2 });
    mb.dome(0, 0.2, 0, Math.min(sx, sz) * 0.2, 0xe5b94a, 12, 5);
    mb.cylinder(0, 0.2 + Math.min(sx, sz) * 0.2, 0, 0.008, 0.06, 0xe5b94a, 4);
    for (const [x, z] of [[-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]] as [number, number][]) mb.dome(sx * x, 0.2, sz * z, 0.06, 0xe5b94a, 6, 2);
    mb.box(sx * 0.42, 0, sz * 0.42, 0.012, 0.4, 0.012, 0xe0e0e0, { noBottom: true });
    mb.box(sx * 0.42 + 0.03, 0.34, sz * 0.42, 0.06, 0.05, 0.004, 0xe98b2a, { noBottom: true });
  },
  plant: ({ mb, sx, sz, def }) => {
    const sm = def.key === 'water_treatment';
    mb.box(0, 0, 0, sx * 0.7, 0.18, sz * 0.5, 0xb8bcc0, { bays: 3, floors: 2 });
    if (!sm) {
      mb.cylinder(sx * 0.3, 0, -sz * 0.3, 0.05, 0.5, 0xe8e0d6, 10, 0.04); mb.cylinder(sx * 0.3, 0.38, -sz * 0.3, 0.045, 0.04, 0xd23b3b, 10);
      mb.cylinder(-sx * 0.3, 0, -sz * 0.3, 0.05, 0.44, 0xe8e0d6, 10, 0.04); mb.cylinder(-sx * 0.3, 0.34, -sz * 0.3, 0.045, 0.04, 0xd23b3b, 10);
      mb.cylinder(0, 0, sz * 0.3, 0.1, 0.2, 0xcfd3d6, 12, 0.07);
    } else {
      for (const x of [-0.25, 0.1]) { mb.cylinder(sx * x, 0, sz * 0.3, 0.11, 0.05, 0x7fb4cc, 14); }
      mb.flat(0, 0.004, sz * 0.3, sx * 0.9, sz * 0.3, 0x93a8a0);
    }
  },
  solar: ({ mb, sx, sz }) => {
    mb.flat(0, 0.003, 0, sx * 0.96, sz * 0.96, 0x8aa070);
    const rows = Math.max(3, Math.round(sz / 0.2));
    for (let r = 0; r < rows; r++) for (let c = 0; c < Math.max(3, Math.round(sx / 0.34)); c++) {
      mb.tilted(-sx * 0.42 + c * 0.32 + 0.16, 0.025, -sz * 0.42 + (sz * 0.84 * r) / Math.max(1, rows - 1), 0.28, 0.11, 0.5, 0x2c4a78);
    }
  },
  wind: ({ mb, sx, sz }) => {
    for (const [x, z] of [[-0.25, -0.2], [0.25, 0.2]] as [number, number][]) {
      mb.cylinder(sx * x, 0, sz * z, 0.016, 0.62, 0xeeeeea, 8, 0.01);
      mb.box(sx * x, 0.6, sz * z, 0.04, 0.03, 0.03, 0xeeeeea, {});
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.4;
        mb.tri([sx * x, 0.615, sz * z + 0.02], [sx * x + Math.cos(a) * 0.01, 0.615 + Math.sin(a) * 0.26, sz * z + 0.02], [sx * x + 0.02, 0.615 + Math.sin(a) * 0.1, sz * z + 0.02], 0xf2f2ee, 1);
      }
    }
  },
  tank: ({ mb, sx, sz, def }) => {
    if (def.key === 'water_tower') {
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mb.box(sx * 0.12 * x, 0, sz * 0.12 * z, 0.012, 0.26, 0.012, 0x8d9296, { noBottom: true });
      mb.cylinder(0, 0.26, 0, 0.16, 0.16, 0x77a8c4, 12, 0.16);
      mb.dome(0, 0.42, 0, 0.16, 0x6f9fba, 10, 3);
    } else {
      mb.box(-sx * 0.15, 0, 0, sx * 0.4, 0.1, sz * 0.4, 0xd8d4c8, { bays: 2, floors: 1 });
      mb.cylinder(sx * 0.2, 0, sz * 0.1, 0.07, 0.14, 0x6fa0bc, 10);
      if (def.key === 'water_pump') mb.box(sx * 0.3, 0.0, -sz * 0.3, 0.04, 0.03, 0.2, 0x555a5e, { noBottom: true });
    }
  },
  pond: ({ mb, sx, sz }) => {
    mb.flat(0, 0.002, 0, sx * 0.96, sz * 0.96, 0x6e8f5a);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; mb.tri([0, 0.004, 0], [Math.cos(a + 0.52) * sx * 0.38, 0.004, Math.sin(a + 0.52) * sz * 0.38], [Math.cos(a) * sx * 0.38, 0.004, Math.sin(a) * sz * 0.38], 0x4a8fb5, 1); }
  },
  park: ({ mb, sx, sz, v, def }) => {
    mb.flat(0, 0.003, 0, sx * 0.98, sz * 0.98, 0x78a85f);
    mb.flat(0, 0.0045, 0, sx * 0.1, sz * 0.98, 0xd5c79d);
    mb.flat(0, 0.0045, 0, sx * 0.98, sz * 0.1, 0xd5c79d);
    const n = Math.max(3, Math.round(sx * sz * 3));
    for (let i = 0; i < n; i++) {
      const x = (rnd(v, i) - 0.5) * sx * 0.85, z = (rnd(v, i + 50) - 0.5) * sz * 0.85;
      if (Math.abs(x) < sx * 0.07 || Math.abs(z) < sz * 0.07) continue;
      mb.cylinder(x, 0, z, 0.012, 0.09, 0x6a4f38, 5);
      mb.dome(x, 0.07, z, 0.075 + rnd(v, i + 9) * 0.04, [0x4f9a4a, 0x5ba655, 0x3f8a45][i % 3], 6, 3);
    }
    if (def.key === 'playground') { mb.box(sx * 0.2, 0, 0, 0.1, 0.05, 0.03, 0xe8743b, { noBottom: true }); mb.box(-sx * 0.25, 0, 0.1, 0.06, 0.06, 0.06, 0x3e8fd4, { noBottom: true }); }
    if (def.key === 'park_big' || def.key === 'lm_central_park') { for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; mb.tri([sx * 0.22, 0.006, sz * 0.2], [sx * 0.22 + Math.cos(a + 0.62) * 0.2, 0.006, sz * 0.2 + Math.sin(a + 0.62) * 0.15], [sx * 0.22 + Math.cos(a) * 0.2, 0.006, sz * 0.2 + Math.sin(a) * 0.15], 0x5a9ec2, 1); } }
  },
  stadium: ({ mb, sx, sz }) => {
    mb.flat(0, 0.004, 0, sx * 0.4, sz * 0.5, 0x4f9a4a);
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      mb.setTransform(Math.cos(a) * sx * 0.38, 0, Math.sin(a) * sz * 0.4, -a + Math.PI / 2);
      mb.box(0, 0, 0, 0.3, 0.2, 0.14, 0xd8d3c6, { bays: 4, floors: 2 });
      mb.setTransform(0, 0, 0, 0);
    }
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { mb.box(sx * 0.46 * x, 0, sz * 0.46 * z, 0.012, 0.38, 0.012, 0xcfd2d4, { noBottom: true }); mb.box(sx * 0.46 * x, 0.38, sz * 0.46 * z, 0.05, 0.02, 0.05, 0xfff2b0, { noBottom: true }); }
  },
  govt: ({ mb, sx, sz, v }) => {
    mb.box(0, 0, 0, sx * 0.9, 0.26, sz * 0.6, 0xe0d2b4, { bays: 6, floors: 3 });
    mb.box(0, 0, sz * 0.34, sx * 0.4, 0.2, 0.1, 0xefe3c4, { bays: 3, floors: 2 });
    for (let i = 0; i < 6; i++) mb.cylinder(-sx * 0.17 + (sx * 0.34 * i) / 5, 0, sz * 0.4, 0.012, 0.2, 0xf4ecd6, 6);
    mb.dome(0, 0.26, 0, 0.14, 0xd9c8a2, 10, 4);
    mb.cylinder(sx * 0.3, 0, -sz * 0.0, 0.02, 0.4, 0xf0f0f0, 6);
    mb.box(sx * 0.3 + 0.03, 0.34, 0, 0.06, 0.04, 0.004, AWNING[v % 7], { noBottom: true });
  },
  small: ({ mb, sx, sz, def }) => {
    if (def.key === 'police') { mb.box(0, 0, 0, sx * 0.7, 0.16, sz * 0.6, 0xdde6ee, { bays: 3, floors: 2 }); mb.box(0, 0.1, sz * 0.31, sx * 0.4, 0.03, 0.01, 0x2f5fa8, { noBottom: true }); mb.box(0, 0.16, 0, 0.12, 0.02, 0.06, 0x2f5fa8, { noBottom: true }); }
    else if (def.key === 'fire') { mb.box(0, 0, 0, sx * 0.88, 0.14, sz * 0.62, 0xd8d4cc, { bays: 4, floors: 1 }); mb.box(-sx * 0.2, 0.0, sz * 0.31, 0.2, 0.1, 0.01, 0xc7392f, { noBottom: true }); mb.box(sx * 0.2, 0.0, sz * 0.31, 0.2, 0.1, 0.01, 0xc7392f, { noBottom: true }); mb.box(sx * 0.35, 0.14, -sz * 0.1, 0.07, 0.15, 0.07, 0xc7392f, { noBottom: true }); }
    else if (def.key === 'substation') { mb.flat(0, 0.003, 0, sx * 0.9, sz * 0.9, 0x8c8f90); for (const x of [-0.2, 0.2]) mb.box(sx * x, 0, 0, 0.14, 0.1, 0.12, 0x9aa0a4, {}); mb.box(0, 0, -sz * 0.3, 0.012, 0.3, 0.012, 0x777b7e, { noBottom: true }); mb.box(0, 0.28, -sz * 0.3, 0.3, 0.012, 0.012, 0x777b7e, { noBottom: true }); }
    else { mb.box(0, 0, 0, sx * 0.7, 0.16, sz * 0.6, 0xe8dcc0, { bays: 3, floors: 2 }); mb.box(0, 0.1, sz * 0.31, sx * 0.4, 0.03, 0.01, 0xe8743b, { noBottom: true }); }
  },
  stand: ({ mb, sx, sz }) => {
    mb.flat(0, 0.003, 0, sx * 0.96, sz * 0.96, 0x5e6266);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mb.box(sx * 0.32 * x, 0, sz * 0.3 * z, 0.012, 0.1, 0.012, 0x6f7377, { noBottom: true });
    mb.box(0, 0.1, 0, sx * 0.8, 0.012, sz * 0.7, 0xf2b24a, { noBottom: true });
    mb.box(0, 0.112, -sz * 0.34, sx * 0.4, 0.04, 0.01, 0x2f8f5a, { noBottom: true });
    for (let i = 0; i < 3; i++) mb.box(-sx * 0.28 + i * sx * 0.28, 0.004, sz * 0.1, 0.012, 0.002, sz * 0.5, 0xf2b24a, { noBottom: true });
  },
  promenade: ({ mb, sx, sz }) => {
    mb.flat(0, 0.006, 0, sx * 0.98, sz * 0.86, 0xc9b290);
    mb.box(0, 0.006, sz * 0.44, sx * 0.98, 0.03, 0.012, 0xbbb7a8, { noBottom: true });
    for (let i = 0; i < 6; i++) { mb.box(-sx * 0.4 + (sx * 0.8 * i) / 5, 0, sz * 0.38, 0.01, 0.1, 0.01, 0x777b7e, { noBottom: true }); mb.box(-sx * 0.4 + (sx * 0.8 * i) / 5, 0.1, sz * 0.38, 0.03, 0.02, 0.03, 0xfff2b0, { noBottom: true }); }
  },
  mixed: (c) => {
    const { mb, sx, sz, levels, v, wall, accent } = c;
    sign(c, 0, 0.078, sz * 0.41 + 0.005, sx * 0.6, 0.03, 2);
    const h = levels * FLOOR;
    mb.box(0, 0, 0, sx * 0.9, FLOOR, sz * 0.82, 0xd6cfc0, { bays: 5, floors: 1 });
    awning(mb, 0, 0.068, sz * 0.41, sx * 0.88, accent);
    mb.box(0, FLOOR, 0, sx * 0.88, h - FLOOR, sz * 0.8, wall, { bays: 5, floors: levels - 1 });
    balconies(mb, sx * 0.88, sz * 0.8, levels, shade(wall, 0.7), v);
    parapet(mb, sx * 0.88, sz * 0.8, h, shade(wall, 0.85));
    tank(mb, -sx * 0.2, h, 0, 0.03);
  },
};
SHAPES.bazaar = SHAPES.bazaar;

function construction(mb: MeshBuilder, sx: number, sz: number, H: number, progress: number) {
  const h = Math.max(0.05, H * (0.12 + 0.88 * progress));
  mb.box(0, 0, 0, sx * 0.86, h, sz * 0.8, 0x9c9a94, { noBottom: true });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mb.box(sx * 0.46 * x, 0, sz * 0.43 * z, 0.01, h + 0.05, 0.01, 0xe0a63a, { noBottom: true });
  mb.box(0, h + 0.05, sz * 0.43, sx * 0.92, 0.008, 0.008, 0xe0a63a, { noBottom: true });
  if (H > 0.3) {
    mb.box(sx * 0.35, 0, 0, 0.02, H + 0.1, 0.02, 0xe8743b, { noBottom: true });
    mb.box(0, H + 0.1, 0, sx * 0.9, 0.012, 0.012, 0xe8743b, { noBottom: true });
    mb.box(-sx * 0.3, H + 0.04, 0, 0.012, 0.06, 0.012, 0x444444, { noBottom: true });
  }
}

export class BuildingView {
  group = new THREE.Group();
  chunks = new Map<number, { sig: string; mesh: THREE.Mesh | null; sign: THREE.Mesh | null }>();
  signMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: signAtlas(), roughness: 0.7, emissive: new THREE.Color(0xffffff), emissiveMap: null, emissiveIntensity: 0 });
  material: THREE.MeshStandardMaterial;
  glowMat: THREE.MeshStandardMaterial;
  version = -1;
  private lastBuild = 0;
  constructor(public world: World, scene: THREE.Scene, material: THREE.MeshStandardMaterial) {
    scene.add(this.group);
    this.material = material;
    this.glowMat = material;
  }
  dispose() { this.group.removeFromParent(); for (const c of this.chunks.values()) c.mesh?.geometry.dispose(); }

  setVisible(v: boolean) { this.group.visible = v; }
  setNight(n: number) { this.signMat.emissiveIntensity = n * 0.55; this.signMat.emissiveMap = this.signMat.map; this.signMat.needsUpdate = false; }

  /** Rebuild chunks whose building set or construction state changed. */
  sync(force = false) {
    const w = this.world;
    for (const [x0, y0, x1, y1] of w.dirtyRects) {
      for (let cy = Math.floor(y0 / CH); cy <= Math.floor(y1 / CH); cy++) for (let cx = Math.floor(x0 / CH); cx <= Math.floor(x1 / CH); cx++) { const c = this.chunks.get(cy * 64 + cx); if (c) c.sig = ''; }
      force = true;
    }
    w.dirtyRects.length = 0;
    const key = w.buildingVersion + w.terrainVersion * 1000;
    const now = performance.now();
    const constructing = [...w.buildings.values()].some((b) => b.progress < 1);
    if (!force && key === this.version && (!constructing || now - this.lastBuild < 1200)) return;
    this.version = key;
    this.lastBuild = now;
    const byChunk = new Map<number, Building[]>();
    for (const b of w.buildings.values()) {
      const k = Math.floor(b.y / CH) * 64 + Math.floor(b.x / CH);
      let a = byChunk.get(k);
      if (!a) byChunk.set(k, (a = []));
      a.push(b);
    }
    for (const [k, c] of this.chunks) if (!byChunk.has(k)) { c.mesh?.geometry.dispose(); if (c.mesh) this.group.remove(c.mesh); if (c.sign) { c.sign.geometry.dispose(); this.group.remove(c.sign); } this.chunks.delete(k); }
    for (const [k, list] of byChunk) {
      const sig = list.map((b) => `${b.id}:${b.level}:${Math.floor(b.progress * 5)}:${b.abandoned ? 1 : 0}:${b.wealth}`).join('|');
      const old = this.chunks.get(k);
      if (old && old.sig === sig) continue;
      if (old?.mesh) { old.mesh.geometry.dispose(); this.group.remove(old.mesh); }
      if (old?.sign) { old.sign.geometry.dispose(); this.group.remove(old.sign); }
      const mb = new MeshBuilder(), sb = new MeshBuilder();
      for (const b of list) this.addBuilding(mb, sb, b);
      const mesh = new THREE.Mesh(mb.build(), this.material);
      mesh.frustumCulled = true;
      this.group.add(mesh);
      let sign: THREE.Mesh | null = null;
      if (sb.vertexCount) { sign = new THREE.Mesh(sb.build(), this.signMat); this.group.add(sign); }
      this.chunks.set(k, { sig, mesh, sign });
    }
  }

  private addBuilding(mb: MeshBuilder, sb: MeshBuilder, b: Building) {
    const w = this.world, t = w.terrain, V = t.n + 1;
    const def = DEFS[b.def];
    if (!def) return;
    let hMax = -1e9, hMin = 1e9;
    for (let j = 0; j <= b.h; j++) for (let i = 0; i <= b.w; i++) { const h = t.heights[(b.y + j) * V + b.x + i]; hMax = Math.max(hMax, h); hMin = Math.min(hMin, h); }
    const gy = hMax * HS + 0.004;
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    const dx = b.ax - cx, dz = b.ay - cz;
    let fx = 0, fz = 1;
    if (b.access) { if (Math.abs(dx) > Math.abs(dz)) { fx = Math.sign(dx); fz = 0; } else { fx = 0; fz = Math.sign(dz) || 1; } }
    const rot = Math.atan2(fx, fz);
    const along = fx !== 0;
    const W = along ? b.h : b.w, D = along ? b.w : b.h;
    // foundation to meet sloping ground
    if (gy - hMin * HS > 0.01) {
      mb.setTransform(cx, hMin * HS - 0.05, cz, 0);
      mb.box(0, 0, 0, b.w * 0.94, gy - hMin * HS + 0.05, b.h * 0.94, 0x77746c, { noBottom: true });
    }
    mb.setTransform(cx, gy, cz, rot);
    sb.setTransform(cx, gy, cz, rot);
    const pal = WALL_PALETTES[(b.variant + (b.wealth === 0 ? 2 : b.wealth === 2 ? 1 : 0)) % WALL_PALETTES.length];
    let wall = pal[b.variant % 4];
    if (b.wealth === 0) wall = shade(desat(wall, 0.85), 0.94);
    const roof = ROOF_COLORS[b.variant % ROOF_COLORS.length];
    let accent = AWNING[(b.variant >> 3) % AWNING.length];
    const dim = b.abandoned;
    if (dim) { wall = shade(desat(wall, 0.4), 0.7); accent = shade(desat(accent, 0.3), 0.7); }
    const levels = Math.max(1, b.level);
    const sx = W - 0.14, sz = D - 0.14;
    if (b.progress < 1 && def.cat !== 'park') {
      const H = (def.cat === 'res' || def.cat === 'mixed' || def.cat === 'office' ? levels : 2) * FLOOR;
      construction(mb, sx, sz, H, b.progress);
    } else {
      const fn = SHAPES[def.shape] ?? SHAPES.small;
      const ctx: Ctx = { mb, sb, W, D, sx, sz, levels, v: b.variant, wealth: b.wealth, def, wall, roof, accent, dim };
      fn(ctx);
    }
    mb.setTransform(0, 0, 0, 0);
    sb.setTransform(0, 0, 0, 0);
  }
}
