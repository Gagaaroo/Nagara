import { MAP_SIZES, MapParams, Terrain, WaterBody, WaterKind, WATER_NAMES, Build, TILE_M } from '../types';
import { hashSeed, mulberry32, rrange, pick } from '../../utils/rng';
import { clamp, lerp, smoothstep } from '../../utils/math';
import { Noise } from './noise';
import { NO_WATER, classifyTile } from './query';
import { cityName, waterName } from '../../data/names';

interface TerrainProfile {
  base: number; hill: number; mount: number; plateau: number; valley: number; coast: number; lakes: number; wetness: number; dry: number;
}

const PROFILES: Record<string, TerrainProfile> = {
  plains: { base: 22, hill: 7, mount: 0.35, plateau: 0, valley: 0.3, coast: 0, lakes: 0.6, wetness: 0.5, dry: 0 },
  rolling: { base: 30, hill: 20, mount: 0.6, plateau: 0.1, valley: 0.5, coast: 0, lakes: 1, wetness: 0.7, dry: 0 },
  coastal: { base: 18, hill: 11, mount: 0.4, plateau: 0, valley: 0.4, coast: 1, lakes: 0.6, wetness: 0.8, dry: 0 },
  valley: { base: 35, hill: 18, mount: 1.1, plateau: 0, valley: 1, coast: 0, lakes: 0.8, wetness: 0.6, dry: 0 },
  mountain: { base: 45, hill: 24, mount: 1.8, plateau: 0, valley: 0.8, coast: 0, lakes: 0.7, wetness: 0.6, dry: 0 },
  plateau: { base: 40, hill: 12, mount: 0.7, plateau: 1, valley: 0.5, coast: 0, lakes: 0.5, wetness: 0.3, dry: 0.5 },
};

/** Defaults the regional flavour nudges onto the profile. */
function regionTweak(p: TerrainProfile, region: MapParams['region']): TerrainProfile {
  const q = { ...p };
  if (region === 'south') { q.lakes *= 1.6; q.wetness += 0.2; q.hill *= 1.1; }
  if (region === 'north') { q.hill *= 0.7; q.dry += 0.15; q.valley *= 1.2; }
  if (region === 'west') { q.dry += 0.5; q.wetness -= 0.3; q.coast = Math.max(q.coast, 0.6); }
  if (region === 'coastal') { q.coast = 1; q.wetness += 0.25; }
  if (region === 'mountain') { q.mount *= 1.6; q.hill *= 1.3; q.base += 20; }
  return q;
}

export function generateTerrain(params: MapParams): Terrain {
  const n = MAP_SIZES[params.size];
  const V = n + 1;
  const seedNum = hashSeed(params.seed || 'nagara');
  const rng = mulberry32(seedNum ^ 0x9e3779b9);
  const nz = new Noise(seedNum);
  const nz2 = new Noise(seedNum ^ 0x51ed270b);
  const nz3 = new Noise(seedNum ^ 0xa341316c);
  const prof = regionTweak(PROFILES[params.terrain], params.region);

  const heights = new Float32Array(V * V);
  const waterLevel = new Float32Array(V * V).fill(NO_WATER);
  const kindV = new Uint8Array(V * V);

  const coastSide = Math.floor(rng() * 4); // 0 N,1 E,2 S,3 W
  const mountDir = rng() * Math.PI * 2;
  const mdx = Math.cos(mountDir), mdy = Math.sin(mountDir);
  const mountAmp = 110 * prof.mount * (0.15 + params.mountains * 1.35);
  const plateauMaskScale = 1.4;

  // ───────── base elevation: rolling hills + mountain ranges + plateaus ─────────
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const nx = i / n, ny = j / n;
      const wx = nx + nz2.fbm(nx * 2.2, ny * 2.2, 3) * 0.12;
      const wy = ny + nz2.fbm(nx * 2.2 + 17, ny * 2.2 - 9, 3) * 0.12;
      let h = prof.base + nz.fbm(wx * 3.1, wy * 3.1, 5) * prof.hill * 1.6;
      h += nz3.fbm(wx * 9, wy * 9, 3) * (1.2 + prof.hill * 0.08);
      // mountains concentrate toward one side of the map
      const along = ((nx - 0.5) * mdx + (ny - 0.5) * mdy) * 1.6 + nz.fbm(wx * 1.5 + 5, wy * 1.5, 3) * 0.5;
      const mask = smoothstep(0.05, 0.75, along + 0.25);
      const ridge = nz.ridged(wx * 3.4 + 40, wy * 3.4 + 12, 5);
      h += mask * ridge * mountAmp + mask * mask * mountAmp * 0.25;
      // scattered hills elsewhere for interest
      h += Math.max(0, nz2.fbm(wx * 4 + 3, wy * 4 + 3, 3)) * prof.hill * 0.7 * (0.4 + params.mountains);
      // plateaus: terrace the terrain where a slow mask is high
      if (prof.plateau > 0) {
        const pm = smoothstep(0.0, 0.35, nz3.fbm(wx * plateauMaskScale + 9, wy * plateauMaskScale, 3)) * prof.plateau;
        const step = 14;
        const q = Math.round(h / step) * step;
        const blend = pm * 0.85;
        h = lerp(h, lerp(q, h, 0.12), blend);
      }
      // keep the map border a touch lower so the map reads as an island of terrain
      heights[j * V + i] = h;
    }
  }

  // ───────── coastline ─────────
  const seaLevel = 0;
  const hasCoast = prof.coast > 0.01 || params.terrain === 'coastal';
  if (hasCoast) {
    const reach = (0.18 + params.water * 0.3) * (0.6 + prof.coast * 0.5);
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const nx = i / n, ny = j / n;
        const d = coastSide === 0 ? ny : coastSide === 2 ? 1 - ny : coastSide === 3 ? nx : 1 - nx;
        const wob = nz.fbm(nx * 4 + 71, ny * 4 + 13, 4) * 0.07 + nz2.fbm(nx * 11, ny * 11, 2) * 0.012;
        const dd = d + wob;
        const k = 1 - smoothstep(reach * 0.5, reach * 1.2, dd);
        if (k > 0) {
          const idx = j * V + i;
          // slope the land down below sea level, flatten the shore
          heights[idx] = lerp(heights[idx], Math.min(heights[idx], 9), smoothstep(0, 0.5, k) * 0.9) - k * k * 38;
        }
      }
    }
  }

  // ───────── main river ─────────
  const riverW = 1.6 + params.water * 2.6; // half width tiles
  const valleyR = 6 + riverW * 2 + prof.valley * 9;
  const bodies: { kind: WaterKind; cx: number; cy: number; r: number; level: number }[] = [];
  const addWaterVertex = (idx: number, level: number, kind: WaterKind) => {
    waterLevel[idx] = Math.max(waterLevel[idx], level);
    if (!kindV[idx] || kind === 5 || kindV[idx] === 1) kindV[idx] = kind;
  };

  if (params.water > 0.04) {
    // river runs between two opposite sides, away from the coast side if there is one
    let sideA = hasCoast ? (coastSide + 2) % 4 : Math.floor(rng() * 4);
    const toward = hasCoast ? coastSide : (sideA + 2) % 4;
    const pos = (side: number, t: number) =>
      side === 0 ? [t * n, 0] : side === 2 ? [t * n, n] : side === 3 ? [0, t * n] : [n, t * n];
    const sT = rrange(rng, 0.25, 0.75);
    const eT = rrange(rng, 0.25, 0.75);
    const [sx, sy] = pos(sideA, sT);
    const [ex, ey] = pos(toward, eT);
    const dx = ex - sx, dy = ey - sy;
    const L = Math.hypot(dx, dy);
    const px = -dy / L, py = dx / L;
    const steps = Math.ceil(L * 2);
    const path: { x: number; y: number }[] = [];
    const ph = rng() * 6;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const env = Math.sin(Math.PI * clamp(t, 0, 1)) * 0.6 + 0.4;
      const off = (nz.fbm(t * 3.2 + 100, 0.5, 3) * n * 0.2 + Math.sin(t * 9 + ph) * n * 0.035) * env;
      path.push({ x: sx + dx * t + px * off, y: sy + dy * t + py * off });
    }
    // water-surface profile: smoothed terrain along path, forced non-increasing downstream
    const raw = path.map((p) => sampleH(heights, V, p.x, p.y));
    const sm = raw.map((_, k) => {
      let s = 0, c = 0;
      for (let d = -14; d <= 14; d++) { const q = raw[clamp(k + d, 0, raw.length - 1)]; s += q; c++; }
      return s / c;
    });
    const surf: number[] = [];
    let cur = Infinity;
    for (let k = 0; k < sm.length; k++) {
      cur = Math.min(cur, sm[k] - 1.2);
      // always descend a little so water has a direction
      surf.push(cur);
      cur -= 0.012;
    }
    if (hasCoast) { for (let k = Math.floor(surf.length * 0.85); k < surf.length; k++) surf[k] = Math.min(surf[k], lerp(surf[k], seaLevel + 0.3, (k - surf.length * 0.85) / (surf.length * 0.15))); }
    const minD = new Float32Array(V * V).fill(1e9);
    const surfAt = new Float32Array(V * V);
    const R = Math.ceil(valleyR) + 1;
    for (let k = 0; k < path.length; k += 1) {
      const p = path[k];
      for (let j = Math.max(0, Math.floor(p.y) - R); j <= Math.min(n, Math.ceil(p.y) + R); j++)
        for (let i = Math.max(0, Math.floor(p.x) - R); i <= Math.min(n, Math.ceil(p.x) + R); i++) {
          const d = Math.hypot(i - p.x, j - p.y);
          const idx = j * V + i;
          if (d < minD[idx]) { minD[idx] = d; surfAt[idx] = surf[k]; }
        }
    }
    const depth = 1.5 + params.water * 1.6;
    for (let idx = 0; idx < V * V; idx++) {
      const d = minD[idx];
      if (d > valleyR) continue;
      const s = surfAt[idx];
      const h = heights[idx];
      if (d < riverW) {
        const f = d / riverW;
        heights[idx] = Math.min(h, s - depth * (1 - f * f));
        addWaterVertex(idx, s, 1);
      } else {
        const bank = s + 0.8 + Math.pow(d - riverW, 1.55) * (0.5 + prof.valley * 0.45);
        heights[idx] = Math.min(h, bank);
        // blend: valley should not leave a sharp trench
        const k = smoothstep(valleyR * 0.55, valleyR, d);
        heights[idx] = lerp(heights[idx], h, k);
      }
    }
  }

  // ───────── lakes, ponds, reservoirs ─────────
  const lakeCount = Math.round((params.water * 2.4 + 0.2) * prof.lakes);
  const pondCount = Math.round(params.water * 6 * (0.6 + prof.wetness * 0.5)) + (params.water > 0.1 ? 1 : 0);
  const reservoirCount = params.water > 0.25 && (params.terrain === 'mountain' || params.terrain === 'valley' || params.terrain === 'rolling' || params.region === 'mountain') ? 1 : 0;
  const carve = (cx: number, cy: number, r: number, level: number, depth: number, kind: WaterKind, berm: boolean) => {
    const R = Math.ceil(r * 1.6) + 1;
    for (let j = Math.max(0, Math.floor(cy) - R); j <= Math.min(n, Math.ceil(cy) + R); j++)
      for (let i = Math.max(0, Math.floor(cx) - R); i <= Math.min(n, Math.ceil(cx) + R); i++) {
        const idx = j * V + i;
        const ang = Math.atan2(j - cy, i - cx);
        const warp = 1 + nz2.fbm(Math.cos(ang) * 1.3 + cx * 0.1, Math.sin(ang) * 1.3 + cy * 0.1, 3) * 0.38;
        const d = Math.hypot(i - cx, j - cy) / (r * warp);
        if (d < 1) {
          heights[idx] = Math.min(heights[idx], level - depth * (1 - d * d));
          addWaterVertex(idx, level, kind);
        } else if (berm && d < 1.55) {
          heights[idx] = Math.max(heights[idx], level + 0.8 + (d - 1) * 14);
        }
      }
  };
  const lowSpot = (minEdge: number) => {
    let best = { x: n / 2, y: n / 2, h: 1e9 };
    for (let t = 0; t < 70; t++) {
      const x = rrange(rng, minEdge, n - minEdge), y = rrange(rng, minEdge, n - minEdge);
      const h = sampleH(heights, V, x, y);
      const mean = (sampleH(heights, V, x + 9, y) + sampleH(heights, V, x - 9, y) + sampleH(heights, V, x, y + 9) + sampleH(heights, V, x, y - 9)) / 4;
      const rel = h - mean;
      const sea = waterLevel[Math.round(y) * V + Math.round(x)] > NO_WATER / 2;
      if (rel < best.h && !sea && h > 2) best = { x, y, h: rel };
    }
    return best;
  };
  for (let k = 0; k < lakeCount; k++) {
    const s = lowSpot(16);
    const r = rrange(rng, 6, 12) * (0.7 + params.water * 0.8);
    const ringH: number[] = [];
    for (let a = 0; a < 16; a++) ringH.push(sampleH(heights, V, s.x + Math.cos(a / 16 * 6.283) * r * 0.9, s.y + Math.sin(a / 16 * 6.283) * r * 0.9));
    ringH.sort((a, b) => a - b);
    carve(s.x, s.y, r, ringH[4] + 0.3, 2.6, 2, false);
    bodies.push({ kind: 2, cx: s.x, cy: s.y, r, level: ringH[4] });
  }
  for (let k = 0; k < pondCount; k++) {
    const s = lowSpot(8);
    const r = rrange(rng, 1.8, 3.6);
    carve(s.x, s.y, r, sampleH(heights, V, s.x, s.y) + 0.4, 1.2, 3, false);
  }
  for (let k = 0; k < reservoirCount; k++) {
    const s = lowSpot(18);
    const r = rrange(rng, 7, 11);
    carve(s.x, s.y, r, sampleH(heights, V, s.x, s.y) + 3, 3.5, 4, true);
  }

  // ───────── sea ─────────
  if (hasCoast) {
    for (let idx = 0; idx < V * V; idx++) if (heights[idx] < seaLevel) addWaterVertex(idx, seaLevel, 5);
  }

  // ───────── tile classification ─────────
  const waterKind = new Uint8Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const vs = [j * V + i, j * V + i + 1, (j + 1) * V + i, (j + 1) * V + i + 1];
      let wet = 0; let kind = 0;
      for (const v of vs) {
        if (waterLevel[v] > NO_WATER / 2 && heights[v] < waterLevel[v] - 0.02) { wet++; if (kindV[v] > kind) kind = kindV[v]; }
      }
      if (wet >= 2) waterKind[j * n + i] = kind || 2;
    }
  // shallow vertices adjacent to wet tiles keep their water level so shores read correctly
  const forest = new Uint8Array(n * n);
  const protectedLand = new Uint8Array(n * n);
  const forestK = params.forest * (0.5 + prof.wetness * 0.55) - prof.dry * 0.35;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (waterKind[k]) continue;
      const nx = i / n, ny = j / n;
      const m = nz3.fbm(nx * 6 + 200, ny * 6 + 200, 4) * 0.5 + 0.5;
      const m2 = nz.fbm(nx * 2.4 + 55, ny * 2.4 + 55, 3) * 0.5 + 0.5;
      const h = heights[j * V + i];
      const alt = 1 - smoothstep(110, 190, h) * 0.7;
      const v = (m * 0.55 + m2 * 0.45 + forestK * 0.9 - 0.76) * 2.7 * alt;
      forest[k] = Math.round(clamp(v, 0, 1) * 255);
    }
  const t: Terrain = {
    n, params, seedNum, heights, baseHeights: new Float32Array(heights), waterLevel, waterKind,
    slope: new Float32Array(n * n), forest, protectedLand, build: new Uint8Array(n * n),
    waterBodies: [], start: { x: n / 2, y: n / 2 }, entry: { x: 0, y: 0, side: 0 }, cityName: '',
  };
  // protected reserves: dense forest cores and high ground
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const core = forest[k] > 215 && nz2.fbm(i * 0.05 + 31, j * 0.05 + 7, 2) > 0.28;
      if (core || heights[j * V + i] > 165) protectedLand[k] = 1;
    }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) classifyTile(t, i, j);

  t.waterBodies = labelWater(t, rng);
  t.start = pickStart(t, rng);
  t.entry = pickEntry(t);
  t.cityName = cityName(rng);
  // clear forest/protection around the start so the player has room to begin
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(i - t.start.x, j - t.start.y);
      if (d < 14) {
        const f = smoothstep(14, 5, d);
        t.forest[j * n + i] = Math.round(t.forest[j * n + i] * (1 - f));
        if (d < 12) { t.protectedLand[j * n + i] = 0; classifyTile(t, i, j); }
      }
    }
  return t;
}

function sampleH(h: Float32Array, V: number, x: number, y: number): number {
  const fx = clamp(x, 0, V - 1.001), fy = clamp(y, 0, V - 1.001);
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  return (h[iy * V + ix] * (1 - tx) + h[iy * V + ix + 1] * tx) * (1 - ty) + (h[(iy + 1) * V + ix] * (1 - tx) + h[(iy + 1) * V + ix + 1] * tx) * ty;
}

/** Connected-component labelling of water tiles into WaterBody entities. */
function labelWater(t: Terrain, rng: () => number): WaterBody[] {
  const n = t.n;
  const seen = new Uint8Array(n * n);
  const out: WaterBody[] = [];
  let id = 1;
  for (let s = 0; s < n * n; s++) {
    if (!t.waterKind[s] || seen[s]) continue;
    const kind = t.waterKind[s];
    const stack = [s];
    seen[s] = 1;
    let count = 0, sx = 0, sy = 0;
    while (stack.length) {
      const c = stack.pop()!;
      count++;
      const cx = c % n, cy = (c / n) | 0;
      sx += cx; sy += cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const k = y * n + x;
        if (seen[k] || !t.waterKind[k]) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    if (count < 2) continue;
    const kindName = kind === 1 ? 'River' : kind === 5 ? 'Bay' : WATER_NAMES[kind];
    out.push({ id: id++, kind: kind as WaterKind, tiles: count, cx: sx / count, cy: sy / count, level: 0, name: waterName(rng, kindName) });
  }
  return out;
}

/** Finds a flat, dry, buildable settlement site, preferably a few tiles from water. */
function pickStart(t: Terrain, rng: () => number) {
  const n = t.n;
  const R = 9;
  const wdist = new Float32Array(n * n).fill(99);
  // coarse distance to water via bounded BFS
  const q: number[] = [];
  for (let k = 0; k < n * n; k++) if (t.waterKind[k]) { wdist[k] = 0; q.push(k); }
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const d = wdist[c];
    if (d >= 40) continue;
    const cx = c % n, cy = (c / n) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const k = y * n + x;
      if (wdist[k] > d + 1) { wdist[k] = d + 1; q.push(k); }
    }
  }
  let best = { x: n / 2, y: n / 2, score: -1e9 };
  for (let y = R + 6; y < n - R - 6; y += 3)
    for (let x = R + 6; x < n - R - 6; x += 3) {
      let ok = 0, tot = 0, sl = 0;
      for (let j = -R; j <= R; j += 2)
        for (let i = -R; i <= R; i += 2) {
          const k = (y + j) * n + x + i;
          tot++;
          if (t.build[k] === Build.Ok) ok++;
          sl += t.slope[k];
        }
      const flat = ok / tot;
      if (flat < 0.85) continue;
      const wd = wdist[y * n + x];
      const waterScore = wd < 5 ? -3 : wd < 30 ? 1.2 - Math.abs(wd - 12) / 20 : 0;
      const centre = Math.hypot(x - n / 2, y - n / 2) / n;
      const score = flat * 4 - sl / tot * 12 + waterScore - centre * 3 + rng() * 0.4;
      if (score > best.score) best = { x, y, score };
    }
  if (best.score < -1e8) {
    // fall back: flattest area anywhere
    let bs = 1e9;
    for (let y = R; y < n - R; y += 3) for (let x = R; x < n - R; x += 3) { const s = t.slope[y * n + x] + (t.waterKind[y * n + x] ? 9 : 0); if (s < bs) { bs = s; best = { x, y, score: 0 }; } }
  }
  return { x: best.x, y: best.y };
}

/** Where the regional highway meets the map edge: the dry edge tile closest to the start. */
function pickEntry(t: Terrain) {
  const n = t.n;
  let best = { x: 2, y: 2, side: 0, d: 1e9 };
  const consider = (x: number, y: number, side: number) => {
    const k = Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x));
    if (t.build[k] === Build.No) return;
    const d = Math.hypot(x - t.start.x, y - t.start.y) + t.slope[k] * 40;
    if (d < best.d) best = { x, y, side, d };
  };
  for (let i = 3; i < n - 3; i += 2) { consider(i, 2, 0); consider(i, n - 3, 2); consider(2, i, 3); consider(n - 3, i, 1); }
  return { x: best.x, y: best.y, side: best.side };
}

export const TERRAIN_DESCRIPTIONS: Record<string, string> = {
  plains: 'Wide flat land with gentle relief. Easy to build, easy to sprawl.',
  rolling: 'Rolling hills and soft valleys. A balanced start with scenic lakes.',
  coastal: 'A coastline with sheltered bays. Waterfront growth, port potential.',
  valley: 'A broad river valley between ridges. Natural corridors, tricky crossings.',
  mountain: 'Steep ranges and narrow valleys. Tunnels and switchbacks reward careful planning.',
  plateau: 'High terraced tableland with sharp escarpments. Dry and open.',
};

export function randomSeedText(): string {
  const w = ['Kaveri', 'Aravalli', 'Malabar', 'Konkan', 'Deccan', 'Nilgiri', 'Sahyadri', 'Vindhya', 'Ganga', 'Thar', 'Coromandel', 'Satpura'];
  return `${pick(Math.random, w)}-${Math.floor(Math.random() * 9000 + 1000)}`;
}
