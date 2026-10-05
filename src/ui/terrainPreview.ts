import { Terrain, Build } from '../game/types';

export type PreviewMode = 'terrain' | 'elevation' | 'buildable';

/** Hillshaded 2D rendering of a generated terrain for the map generator. */
export function drawTerrainPreview(canvas: HTMLCanvasElement, t: Terrain, mode: PreviewMode, maxPx = 640) {
  const n = t.n, V = n + 1;
  const scale = Math.max(2, Math.floor(maxPx / n));
  canvas.width = n * scale; canvas.height = n * scale;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(n * scale, n * scale);
  const H = (i: number, j: number) => t.heights[Math.min(n, Math.max(0, j)) * V + Math.min(n, Math.max(0, i))];
  let hmin = 1e9, hmax = -1e9;
  for (let i = 0; i < t.heights.length; i++) { hmin = Math.min(hmin, t.heights[i]); hmax = Math.max(hmax, t.heights[i]); }
  const lerp = (a: number[], b: number[], u: number) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const hyps = [[82, 140, 96], [160, 178, 98], [194, 164, 96], [150, 124, 100], [236, 232, 222]];
  const lx = -0.6, ly = -0.7;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    const h = (H(i, j) + H(i + 1, j) + H(i, j + 1) + H(i + 1, j + 1)) / 4;
    const dx = (H(i + 2, j) - H(i - 1, j)) / 3, dy = (H(i, j + 2) - H(i, j - 1)) / 3;
    const shade = Math.max(-0.5, Math.min(0.5, (dx * lx + dy * ly) / 22));
    let c: number[];
    if (t.waterKind[k]) {
      const depth = Math.min(1, Math.max(0, (t.waterLevel[j * V + i] - H(i, j)) / 6));
      c = t.waterKind[k] === 5 ? lerp([88, 150, 196], [48, 96, 148], depth) : lerp([96, 160, 196], [58, 112, 160], depth);
    } else if (mode === 'elevation') {
      const u = Math.min(1, Math.max(0, (h - hmin) / Math.max(1, hmax - hmin))) * (hyps.length - 1);
      const a = Math.min(hyps.length - 2, Math.floor(u));
      c = lerp(hyps[a], hyps[a + 1], u - a);
      if (Math.floor(h / 10) !== Math.floor(H(i + 1, j) / 10) || Math.floor(h / 10) !== Math.floor(H(i, j + 1) / 10)) c = [c[0] * 0.65, c[1] * 0.65, c[2] * 0.65];
    } else if (mode === 'buildable') {
      const b = t.build[k];
      c = b === Build.Ok ? [92, 170, 106] : b === Build.Difficult ? [226, 196, 82] : b === Build.Expensive ? [226, 134, 70] : [196, 70, 62];
      if (t.protectedLand[k]) c = [150, 60, 90];
    } else {
      const f = t.forest[k] / 255;
      const base = t.params.region === 'west' || t.params.terrain === 'plateau' ? [176, 164, 100] : t.params.region === 'north' ? [146, 164, 94] : [108, 158, 88];
      c = lerp(base, [58, 110, 62], f * 0.8);
      const sl = Math.min(1, t.slope[k] / 0.25);
      c = lerp(c, [138, 132, 120], sl * 0.7);
      c = lerp(c, [220, 216, 206], Math.max(0, Math.min(1, (h - 140) / 90)) * 0.7);
    }
    const sh = 1 + shade * (t.waterKind[k] ? 0.15 : 0.85);
    const r = Math.max(0, Math.min(255, c[0] * sh)), g = Math.max(0, Math.min(255, c[1] * sh)), b = Math.max(0, Math.min(255, c[2] * sh));
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const p = ((j * scale + y) * n * scale + i * scale + x) * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // settlement + regional connection markers
  const mark = (x: number, y: number, col: string, r: number) => { ctx.beginPath(); ctx.arc(x * scale, y * scale, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke(); };
  ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(243,239,230,.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(t.entry.x * scale, t.entry.y * scale); ctx.lineTo(t.start.x * scale, t.start.y * scale); ctx.stroke(); ctx.setLineDash([]);
  mark(t.entry.x + 0.5, t.entry.y + 0.5, '#4a8fb5', scale * 1.1);
  mark(t.start.x, t.start.y, '#f2b24a', scale * 1.8);
}
