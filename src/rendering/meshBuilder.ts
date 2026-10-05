import * as THREE from 'three';

/** Accumulates coloured, flat-shaded geometry with an optional local→world transform. */
export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  private ox = 0; private oy = 0; private oz = 0; private cs = 1; private sn = 0;

  setTransform(ox: number, oy: number, oz: number, rotY = 0) {
    this.ox = ox; this.oy = oy; this.oz = oz; this.cs = Math.cos(rotY); this.sn = Math.sin(rotY);
  }
  get vertexCount() { return this.pos.length / 3; }

  private tp(x: number, y: number, z: number): [number, number, number] {
    return [this.ox + x * this.cs + z * this.sn, this.oy + y, this.oz - x * this.sn + z * this.cs];
  }
  private tn(x: number, y: number, z: number): [number, number, number] {
    return [x * this.cs + z * this.sn, y, -x * this.sn + z * this.cs];
  }

  /** Flat quad from four local points (counter-clockwise seen from the normal side). */
  quad(a: number[], b: number[], c: number[], d: number[], color: number, uvs?: number[], shade = 1) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = this.vertexCount;
    const r = ((color >> 16) & 255) / 255 * shade, g = ((color >> 8) & 255) / 255 * shade, bl = (color & 255) / 255 * shade;
    const n = this.tn(nx, ny, nz);
    for (const p of [a, b, c, d]) {
      const q = this.tp(p[0], p[1], p[2]);
      this.pos.push(q[0], q[1], q[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(r, g, bl);
    }
    if (uvs) this.uv.push(...uvs); else this.uv.push(0.5, 0.02, 0.5, 0.02, 0.5, 0.02, 0.5, 0.02);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Box centred at (cx, base y, cz). Side faces get a window UV mapping when `bays`/`floors` given.
   */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: number, o: { bays?: number; floors?: number; top?: number; sideShade?: number; noBottom?: boolean; wallColor2?: number } = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = y0 + sy;
    const bays = o.bays ?? 0, floors = o.floors ?? 0;
    const win = (w: number) => (bays && floors ? [0, floors, w, floors, w, 0, 0, 0] : undefined);
    const wx = bays ? Math.max(1, Math.round(sx * bays)) : 0;
    const wz = bays ? Math.max(1, Math.round(sz * bays)) : 0;
    // +z face (front), -z, +x, -x
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, win(wx) && [0, 0, wx, 0, wx, floors, 0, floors], 1);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, win(wx) && [0, 0, wx, 0, wx, floors, 0, floors], 0.88);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, win(wz) && [0, 0, wz, 0, wz, floors, 0, floors], 0.94);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, win(wz) && [0, 0, wz, 0, wz, floors, 0, floors], 0.82);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], o.top ?? color, undefined, 1.04);
    if (!o.noBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0x222222);
  }

  /** Gable roof over a rectangle; ridge runs along local x. */
  gable(cx: number, y0: number, cz: number, sx: number, sz: number, h: number, color: number, overhang = 0.02) {
    const x0 = cx - sx / 2 - overhang, x1 = cx + sx / 2 + overhang, z0 = cz - sz / 2 - overhang, z1 = cz + sz / 2 + overhang, ym = y0 + h;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, ym, cz], [x0, ym, cz], color, undefined, 1.0);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, ym, cz], [x1, ym, cz], color, undefined, 0.86);
    // gable ends
    this.tri([x0, y0, z0], [x0, y0, z1], [x0, ym, cz], color, 0.8);
    this.tri([x1, y0, z1], [x1, y0, z0], [x1, ym, cz], color, 0.9);
  }

  tri(a: number[], b: number[], c: number[], color: number, shade = 1) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const n = this.tn(nx, ny, nz);
    const base = this.vertexCount;
    const r = ((color >> 16) & 255) / 255 * shade, g = ((color >> 8) & 255) / 255 * shade, bl = (color & 255) / 255 * shade;
    for (const p of [a, b, c]) { const q = this.tp(p[0], p[1], p[2]); this.pos.push(q[0], q[1], q[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(r, g, bl); this.uv.push(0.5, 0.02); }
    this.idx.push(base, base + 1, base + 2);
  }

  /** Four-sided pyramid / frustum (top size can be 0). */
  pyramid(cx: number, y0: number, cz: number, sx: number, sz: number, h: number, topS: number, color: number) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, ym = y0 + h;
    const tx0 = cx - topS / 2, tx1 = cx + topS / 2, tz0 = cz - topS / 2, tz1 = cz + topS / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [tx1, ym, tz1], [tx0, ym, tz1], color, undefined, 1);
    this.quad([x1, y0, z0], [x0, y0, z0], [tx0, ym, tz0], [tx1, ym, tz0], color, undefined, 0.85);
    this.quad([x1, y0, z1], [x1, y0, z0], [tx1, ym, tz0], [tx1, ym, tz1], color, undefined, 0.93);
    this.quad([x0, y0, z0], [x0, y0, z1], [tx0, ym, tz1], [tx0, ym, tz0], color, undefined, 0.8);
    if (topS > 0) this.quad([tx0, ym, tz1], [tx1, ym, tz1], [tx1, ym, tz0], [tx0, ym, tz0], color, undefined, 1.05);
  }

  cylinder(cx: number, y0: number, cz: number, r: number, h: number, color: number, seg = 10, rTop?: number, cap = true) {
    const rt = rTop ?? r;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const sh = 0.82 + 0.2 * Math.cos((a0 + a1) / 2 - 0.9);
      this.quad([cx + c0 * r, y0, cz + s0 * r], [cx + c1 * r, y0, cz + s1 * r], [cx + c1 * rt, y0 + h, cz + s1 * rt], [cx + c0 * rt, y0 + h, cz + s0 * rt], color, undefined, sh);
      if (cap && rt > 0) this.tri([cx, y0 + h, cz], [cx + c0 * rt, y0 + h, cz + s0 * rt], [cx + c1 * rt, y0 + h, cz + s1 * rt], color, 1.05);
    }
  }
  /** Horizontal cylinder along x. */
  cylinderX(cx: number, cy: number, cz: number, r: number, len: number, color: number, seg = 10) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const y0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r, y1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
      const sh = 0.85 + 0.2 * Math.cos((a0 + a1) / 2);
      this.quad([cx - len / 2, cy + y0, cz + z0], [cx + len / 2, cy + y0, cz + z0], [cx + len / 2, cy + y1, cz + z1], [cx - len / 2, cy + y1, cz + z1], color, undefined, sh);
    }
  }

  dome(cx: number, y0: number, cz: number, r: number, color: number, seg = 10, rings = 4) {
    for (let k = 0; k < rings; k++) {
      const p0 = (k / rings) * Math.PI / 2, p1 = ((k + 1) / rings) * Math.PI / 2;
      const r0 = Math.cos(p0) * r, r1 = Math.cos(p1) * r, h0 = Math.sin(p0) * r, h1 = Math.sin(p1) * r;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const sh = 0.85 + 0.2 * Math.sin(p0 + 0.3) * Math.cos((a0 + a1) / 2 - 0.9);
        if (k === rings - 1) this.tri([cx, y0 + h1, cz], [cx + Math.cos(a1) * r0, y0 + h0, cz + Math.sin(a1) * r0], [cx + Math.cos(a0) * r0, y0 + h0, cz + Math.sin(a0) * r0], color, sh);
        else this.quad([cx + Math.cos(a1) * r0, y0 + h0, cz + Math.sin(a1) * r0], [cx + Math.cos(a0) * r0, y0 + h0, cz + Math.sin(a0) * r0], [cx + Math.cos(a0) * r1, y0 + h1, cz + Math.sin(a0) * r1], [cx + Math.cos(a1) * r1, y0 + h1, cz + Math.sin(a1) * r1], color, undefined, sh);
      }
    }
  }

  /** Upward-facing tilted panel (solar arrays). */
  tilted(cx: number, y0: number, cz: number, sx: number, sz: number, tilt: number, color: number) {
    const h = Math.sin(tilt) * sz;
    this.quad([cx - sx / 2, y0, cz + sz / 2], [cx + sx / 2, y0, cz + sz / 2], [cx + sx / 2, y0 + h, cz - sz / 2], [cx - sx / 2, y0 + h, cz - sz / 2], color, undefined, 1.0);
  }

  /** Horizontal ground quad. */
  flat(cx: number, y: number, cz: number, sx: number, sz: number, color: number) {
    this.quad([cx - sx / 2, y, cz + sz / 2], [cx + sx / 2, y, cz + sz / 2], [cx + sx / 2, y, cz - sz / 2], [cx - sx / 2, y, cz - sz / 2], color);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function windowTexture(): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const mk = (lit: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = lit ? '#000' : '#fff';
    g.fillRect(0, 0, 128, 128);
    // 4×4 windows per texture; slight variation per cell
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const on = rnd() < 0.5;
      if (lit) { if (!on) continue; g.fillStyle = rnd() < 0.5 ? '#ffd88a' : '#fff0c8'; }
      else g.fillStyle = '#4b5b6b';
      g.fillRect(i * 32 + 6, j * 32 + 6, 20, 18);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: mk(false), glow: mk(true) };
}
