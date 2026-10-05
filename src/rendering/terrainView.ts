import * as THREE from 'three';
import type { World } from '../game/world';
import { HEIGHT_SCALE } from '../game/types';
import { NO_WATER } from '../game/terrain/query';
import { REGION_GRASS } from './palette';
import { clamp, smoothstep } from '../utils/math';
import { MeshBuilder } from './meshBuilder';

const mix = (a: number, b: number, t: number) => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return [(ar + (br - ar) * t) / 255, (ag + (bg - ag) * t) / 255, (ab + (bb - ab) * t) / 255];
};
const hash2 = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export class TerrainView {
  group = new THREE.Group();
  geometry!: THREE.BufferGeometry;
  mesh!: THREE.Mesh;
  overlay!: THREE.Mesh;
  overlayMat: THREE.MeshBasicMaterial;
  water?: THREE.Mesh;
  waterMat: THREE.MeshStandardMaterial;
  trees: THREE.InstancedMesh[] = [];
  treeKey = '';
  noise = true;
  private waterBuilt = -1;

  constructor(public world: World, scene: THREE.Scene) {
    scene.add(this.group);
    this.overlayMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0.8 });
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x4a8fb5, transparent: true, opacity: 0.86, roughness: 0.25, metalness: 0.1, depthWrite: false });
    this.build();
  }

  dispose() {
    this.group.removeFromParent();
    this.geometry.dispose();
  }

  build() {
    const w = this.world, t = w.terrain, n = t.n, V = n + 1;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3), uv = new Float32Array(V * V * 2);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i;
      pos[k * 3] = i; pos[k * 3 + 2] = j;
      uv[k * 2] = i / n; uv[k * 2 + 1] = j / n;
    }
    const idx = new Uint32Array(n * n * 6);
    let p = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * V + i, b = (j + 1) * V + i, c = j * V + i + 1, d = (j + 1) * V + i + 1;
      if ((i + j) % 2 === 0) { idx[p++] = a; idx[p++] = b; idx[p++] = c; idx[p++] = c; idx[p++] = b; idx[p++] = d; }
      else { idx[p++] = a; idx[p++] = b; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = c; }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    this.mesh.receiveShadow = true;
    this.overlay = new THREE.Mesh(g, this.overlayMat);
    this.overlay.visible = false;
    this.overlay.renderOrder = 2;
    this.group.add(this.mesh, this.overlay);
    this.refresh();
    // frame the mesh bounds so frustum culling is stable
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(n / 2, 20, n / 2), n);
  }

  /** Update vertex heights, normals and colours (after terraforming or on first build). */
  refresh() {
    const w = this.world, t = w.terrain, n = t.n, V = n + 1;
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const palette = REGION_GRASS[t.params.region] ?? REGION_GRASS.south;
    const dry = t.params.region === 'west' || t.params.terrain === 'plateau' ? 0.35 : t.params.region === 'north' ? 0.18 : 0;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i;
      const h = t.heights[k];
      pos.setY(k, h * HEIGHT_SCALE);
      // tile averages around the vertex
      let sl = 0, fo = 0, c = 0, prot = 0, wetTiles = 0;
      for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
        const x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const tk = y * n + x;
        sl += t.slope[tk]; fo += t.forest[tk]; prot += t.protectedLand[tk]; if (t.waterKind[tk]) wetTiles++;
        c++;
      }
      sl /= c || 1; fo /= (c || 1) * 255; prot /= c || 1;
      const wl = t.waterLevel[k];
      const under = wl > NO_WATER / 2 && h < wl;
      const base = palette[(hash2(i >> 2, j >> 2) * 3) | 0];
      let col3 = mix(base, 0x4f7f45, fo * 0.55 + prot * 0.15);
      const jitter = (hash2(i, j) - 0.5) * 0.05;
      if (dry > 0) col3 = mixRgb(col3, mix(0xb6a468, 0xb6a468, 0), dry * (1 - fo));
      if (sl > 0.1) col3 = mixRgb(col3, mix(0x8d877b, 0x8d877b, 0), smoothstep(0.1, 0.28, sl));
      const alt = smoothstep(95, 190, h);
      if (alt > 0) col3 = mixRgb(col3, mix(0x8a8a82, 0x8a8a82, 0), alt * 0.6);
      if (under) col3 = mixRgb(col3, mix(0x6f7d62, 0x6f7d62, 0), 1);
      else if (wetTiles > 0 || (wl > NO_WATER / 2 && h < wl + 0.8)) col3 = mixRgb(col3, mix(0xd4c391, 0xd4c391, 0), 0.7);
      col.setXYZ(k, clamp(col3[0] + jitter, 0, 1), clamp(col3[1] + jitter, 0, 1), clamp(col3[2] + jitter, 0, 1));
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.waterBuilt = -1;
    this.buildWater();
    this.treeKey = '';
  }

  buildWater() {
    const w = this.world, t = w.terrain, n = t.n, V = n + 1;
    if (this.water) { this.water.geometry.dispose(); this.group.remove(this.water); }
    const mb = new MeshBuilder();
    const lvl = (i: number, j: number, fallback: number) => { const l = t.waterLevel[j * V + i]; return l > NO_WATER / 2 ? l : fallback; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (!t.waterKind[j * n + i]) continue;
      const ls = [t.waterLevel[j * V + i], t.waterLevel[j * V + i + 1], t.waterLevel[(j + 1) * V + i], t.waterLevel[(j + 1) * V + i + 1]].filter((l) => l > NO_WATER / 2);
      const avg = ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : 0;
      const y = (a: number, b: number) => lvl(a, b, avg) * HEIGHT_SCALE + 0.002;
      mb.quad([i, y(i, j + 1), j + 1], [i + 1, y(i + 1, j + 1), j + 1], [i + 1, y(i + 1, j), j], [i, y(i, j), j], 0xffffff);
    }
    if (mb.vertexCount === 0) return;
    const g = mb.build();
    this.water = new THREE.Mesh(g, this.waterMat);
    this.water.renderOrder = 1;
    this.group.add(this.water);
  }

  setWaterColor(c: THREE.Color) { this.waterMat.color.copy(c); }

  /** Rebuild instanced trees when forest data or clearing changes. */
  syncTrees(keyHint: string) {
    if (keyHint === this.treeKey) return;
    this.treeKey = keyHint;
    for (const m of this.trees) { this.group.remove(m); m.dispose(); }
    this.trees = [];
    const w = this.world, t = w.terrain, n = t.n, V = n + 1;
    const region = t.params.region;
    const palmShare = region === 'south' || region === 'coastal' ? 0.45 : region === 'west' ? 0.15 : 0.1;
    const A: THREE.Matrix4[] = [], B: THREE.Matrix4[] = [];
    const colA: THREE.Color[] = [], colB: THREE.Color[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pv = new THREE.Vector3();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const f = t.forest[k];
      if (f < 45 || t.waterKind[k] || w.buildGrid[k]) continue;
      if (w.net.isRoadTile(i, j)) continue;
      const count = f > 200 ? 3 : f > 120 ? 2 : 1;
      for (let c = 0; c < count; c++) {
        const hx = hash2(i * 7 + c, j * 13), hy = hash2(i * 11, j * 5 + c * 3), hr = hash2(i + c * 17, j * 3);
        const x = i + 0.15 + hx * 0.7, y = j + 0.15 + hy * 0.7;
        const h = this.sampleH(x, y);
        const sc = 0.8 + hr * 0.7 + (f / 255) * 0.3;
        const palm = hr < palmShare;
        pv.set(x, h * HEIGHT_SCALE, y);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hr * 6.28);
        s.set(sc, sc * (0.9 + hx * 0.4), sc);
        m.compose(pv, q, s);
        const hue = 0.27 + hr * 0.07 - (region === 'west' ? 0.04 : 0);
        const tint = new THREE.Color().setHSL(hue, 0.35 + hx * 0.2, 0.38 + hy * 0.12);
        if (palm) { B.push(m.clone()); colB.push(tint); } else { A.push(m.clone()); colA.push(tint); }
      }
    }
    void V;
    const mk = (geo: THREE.BufferGeometry, mats: THREE.Matrix4[], cols: THREE.Color[]) => {
      if (!mats.length) return;
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), mats.length);
      mats.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cols[i]); });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false;
      im.frustumCulled = false;
      this.group.add(im);
      this.trees.push(im);
    };
    mk(treeGeoBroad(), A, colA);
    mk(treeGeoPalm(), B, colB);
  }

  sampleH(x: number, y: number) {
    const t = this.world.terrain, V = t.n + 1;
    const fx = clamp(x, 0, t.n - 0.001), fy = clamp(y, 0, t.n - 0.001);
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const h = t.heights;
    return (h[iy * V + ix] * (1 - tx) + h[iy * V + ix + 1] * tx) * (1 - ty) + (h[(iy + 1) * V + ix] * (1 - tx) + h[(iy + 1) * V + ix + 1] * tx) * ty;
  }

  setOverlay(tex: THREE.Texture | null, opacity = 0.78) {
    this.overlay.visible = !!tex;
    this.overlayMat.map = tex;
    this.overlayMat.opacity = opacity;
    this.overlayMat.needsUpdate = true;
  }
}

function mixRgb(a: number[], b: number[], t: number) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

let _broad: THREE.BufferGeometry | null = null, _palm: THREE.BufferGeometry | null = null;
function treeGeoBroad() {
  if (_broad) return _broad;
  const mb = new MeshBuilder();
  mb.cylinder(0, 0, 0, 0.018, 0.1, 0x5a4330, 5, 0.014);
  mb.dome(0, 0.07, 0, 0.12, 0xffffff, 7, 3);
  mb.dome(0.04, 0.12, 0.03, 0.08, 0xdcf0c8, 6, 2);
  return (_broad = mb.build());
}
function treeGeoPalm() {
  if (_palm) return _palm;
  const mb = new MeshBuilder();
  mb.cylinder(0, 0, 0, 0.014, 0.22, 0x8a7152, 5, 0.009);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    mb.tri([0, 0.22, 0], [dx * 0.13 - dz * 0.025, 0.2, dz * 0.13 + dx * 0.025], [dx * 0.13 + dz * 0.025, 0.2, dz * 0.13 - dx * 0.025], 0xffffff, 1);
    mb.tri([0, 0.22, 0], [dx * 0.13 + dz * 0.025, 0.2, dz * 0.13 - dx * 0.025], [dx * 0.13 - dz * 0.025, 0.2, dz * 0.13 + dx * 0.025], 0xd5eec2, 0.9);
  }
  return (_palm = mb.build());
}
