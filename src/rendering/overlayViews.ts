import * as THREE from 'three';
import type { World } from '../game/world';
import { HEIGHT_SCALE, ID, RoadEdge, TransitLine, Zone } from '../game/types';
import { MeshBuilder } from './meshBuilder';
import { pointAt, leftNormal, cumLengths } from '../game/roads/geometry';
import { carriageHalf } from '../game/roads/spec';
import { RoadPlan } from '../game/roads/builder';
import { heightAt } from '../game/terrain/query';
import { DEFS } from '../data/buildings';
import { ZONE_INFO } from '../data/buildings';
import { isRoadMode, TRANSIT } from '../game/transportation/transit';

const HS = HEIGHT_SCALE;

function ribbonPoly(mb: MeshBuilder, pts: number[], zs: number[], w: number, dy: number, color: number, shade = 1) {
  let prev: number[][] | null = null;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const ang = Math.atan2(pts[b * 2 + 1] - pts[a * 2 + 1], pts[b * 2] - pts[a * 2]);
    const [nx, ny] = leftNormal(ang);
    const y = (zs[i] ?? 0) * HS + dy;
    const L = [pts[i * 2] + nx * w / 2, y, pts[i * 2 + 1] + ny * w / 2], R = [pts[i * 2] - nx * w / 2, y, pts[i * 2 + 1] - ny * w / 2];
    if (prev) mb.quad(prev[1], R, L, prev[0], color, undefined, shade);
    prev = [L, R];
  }
}

/** Colour-coded transit lines, bus stops, track viaducts. */
export class TransitView {
  group = new THREE.Group();
  mesh: THREE.Mesh | null = null;
  mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
  solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  solidMesh: THREE.Mesh | null = null;
  key = '';
  highlight: ID = 0;
  constructor(public world: World, scene: THREE.Scene) { scene.add(this.group); }

  sync(highlight: ID, draft: { stops: ID[]; color: number; line?: TransitLine | null } | null) {
    const w = this.world;
    const key = `${w.stopVersion}|${w.net.version}|${[...w.lines.values()].map((l) => `${l.id}${l.active}${l.color}${l.headwayMin}`).join(',')}|${highlight}|${draft ? draft.stops.join('-') + draft.color + (draft.line ? draft.line.path.length + draft.line.segAlign.join('') : '') : ''}`;
    if (key === this.key) return;
    this.key = key;
    if (this.mesh) { this.mesh.geometry.dispose(); this.group.remove(this.mesh); }
    if (this.solidMesh) { this.solidMesh.geometry.dispose(); this.group.remove(this.solidMesh); }
    const flat = new MeshBuilder(), solid = new MeshBuilder();
    for (const l of w.lines.values()) {
      if (!l.rt) continue;
      const width = (highlight === l.id ? 0.12 : 0.075);
      const col = l.active ? l.color : 0x777777;
      if (isRoadMode(l.mode)) {
        const idx = Math.max(2, l.path.length / 2);
        void idx;
        ribbonPoly(flat, l.path, l.pathZ.map((z) => z), width, 0.075, col);
      } else {
        this.rail(flat, solid, l, col, width);
      }
    }
    if (draft && draft.line?.rt) {
      if (isRoadMode(draft.line.mode)) ribbonPoly(flat, draft.line.path, draft.line.pathZ, 0.1, 0.12, draft.color);
      else this.rail(flat, solid, draft.line, draft.color, 0.12);
    } else if (draft && draft.stops.length > 1) {
      const pts: number[] = [], zs: number[] = [];
      for (const id of draft.stops) { const s = w.stops.get(id); if (!s) continue; pts.push(s.x, s.y); zs.push(heightAt(w.terrain, s.x, s.y)); }
      ribbonPoly(flat, pts, zs, 0.06, 0.12, draft.color);
    }
    // bus stops
    for (const s of w.stops.values()) {
      if (s.kind !== 'bus') continue;
      const e = w.net.edges.get(s.edge);
      if (!e) continue;
      const p = pointAt(e.pts, e.cum, s.s);
      const [nx, ny] = leftNormal(p.ang);
      const off = carriageHalf(e.spec) + 0.07;
      const z = (e.zs[p.i] ?? 0) * HS + 0.03;
      const used = [...w.lines.values()].find((l) => l.stops.includes(s.id));
      solid.setTransform(p.x + nx * off, z, p.y + ny * off, -p.ang);
      solid.box(0, 0, 0, 0.14, 0.003, 0.05, 0xbfbcb2, { noBottom: true });
      if (s.shelter) { solid.box(0, 0.1, 0, 0.14, 0.01, 0.06, 0x6f7377, { noBottom: true }); for (const x of [-0.06, 0.06]) solid.box(x, 0, 0.02, 0.006, 0.1, 0.006, 0x6f7377, { noBottom: true }); solid.box(0, 0.02, -0.025, 0.12, 0.07, 0.004, 0x9fc4d4, { noBottom: true }); }
      solid.box(0.08, 0, 0.0, 0.006, 0.16, 0.006, 0x4b4f52, { noBottom: true });
      solid.box(0.08, 0.16, 0.0, 0.035, 0.035, 0.01, used ? used.color : 0xf2b24a, { noBottom: true });
      solid.setTransform(0, 0, 0, 0);
    }
    if (flat.vertexCount) { this.mesh = new THREE.Mesh(flat.build(), this.mat); this.mesh.renderOrder = 5; this.mesh.frustumCulled = false; this.group.add(this.mesh); }
    if (solid.vertexCount) { this.solidMesh = new THREE.Mesh(solid.build(), this.solid); this.solidMesh.frustumCulled = false; this.group.add(this.solidMesh); }
  }

  private rail(flat: MeshBuilder, solid: MeshBuilder, l: TransitLine, col: number, width: number) {
    const rt = l.rt!;
    const pts = rt.polyF, zs = rt.polyZ;
    const n = pts.length / 2;
    // split path into legs by stop positions
    const stopS = l.stopPos;
    const cum = cumLengths(pts);
    const legOf = (s: number) => { for (let i = 0; i + 1 < stopS.length; i++) if (s <= stopS[i + 1] + 1e-6) return i; return Math.max(0, stopS.length - 2); };
    let start = 0;
    const segs: { a: number; b: number; al: string }[] = [];
    for (let i = 1; i <= n; i++) {
      const al = l.segAlign[legOf(cum[Math.min(i, n - 1)])] ?? l.alignment;
      const prevAl = l.segAlign[legOf(cum[Math.min(i - 1, n - 1)])] ?? l.alignment;
      if (i === n || al !== prevAl) { segs.push({ a: start, b: Math.min(i, n - 1), al: prevAl }); start = i - 1; }
    }
    for (const sg of segs) {
      const p: number[] = [], z: number[] = [];
      for (let i = sg.a; i <= sg.b; i++) { p.push(pts[i * 2], pts[i * 2 + 1]); z.push(zs[i]); }
      if (p.length < 4) continue;
      if (sg.al === 'underground') {
        // dashed ghost on the surface
        const g = z.map((_, k) => heightAt(this.world.terrain, p[k * 2], p[k * 2 + 1]));
        for (let i = 0; i + 1 < g.length; i += 2) ribbonPoly(flat, p.slice(i * 2, i * 2 + 6), g.slice(i, i + 3), 0.05, 0.05, col, 0.8);
        continue;
      }
      if (sg.al === 'elevated') {
        ribbonPoly(solid, p, z, 0.2, -0.02, 0xb3b0a6, 0.9);
        ribbonPoly(solid, p, z, 0.2, -0.08, 0x8b887e, 0.7);
        for (let i = 2; i + 1 < z.length; i += 3) {
          const g = heightAt(this.world.terrain, p[i * 2], p[i * 2 + 1]) * HS;
          const top = z[i] * HS - 0.08;
          if (top - g > 0.04) { solid.setTransform(p[i * 2], g - 0.02, p[i * 2 + 1], 0); solid.box(0, 0, 0, 0.07, top - g + 0.02, 0.07, 0xa6a398, { noBottom: true }); solid.setTransform(0, 0, 0, 0); }
        }
        ribbonPoly(flat, p, z, 0.07, 0.012, 0x4a4e52);
      } else {
        ribbonPoly(solid, p, z, 0.22, 0.0, 0x8e8a80, 0.85);
        ribbonPoly(flat, p, z, 0.12, 0.012, 0x4b4f52);
      }
      ribbonPoly(flat, p, z, width * 0.6, 0.03, col);
    }
  }
}

/** Highlights for the current selection and hover. */
export class SelectionView {
  group = new THREE.Group();
  mesh: THREE.Mesh | null = null;
  lines: THREE.LineSegments | null = null;
  key = '';
  constructor(public world: World, scene: THREE.Scene) { scene.add(this.group); }
  clear() { if (this.mesh) { this.mesh.geometry.dispose(); this.group.remove(this.mesh); this.mesh = null; } if (this.lines) { this.lines.geometry.dispose(); this.group.remove(this.lines); this.lines = null; } }

  set(sel: { kind: string; id: number } | null, hover: { kind: string; id: number } | null) {
    const w = this.world;
    const key = `${sel?.kind}:${sel?.id}|${hover?.kind}:${hover?.id}|${w.net.version}|${w.buildingVersion}`;
    if (key === this.key) return;
    this.key = key;
    this.clear();
    const mb = new MeshBuilder();
    const seg: number[] = [];
    const circle = (cx: number, cz: number, r: number, y: number) => {
      const N = 40;
      for (let i = 0; i < N; i++) { const a0 = (i / N) * 6.2832, a1 = ((i + 1) / N) * 6.2832; seg.push(cx + Math.cos(a0) * r, heightAt(w.terrain, cx + Math.cos(a0) * r, cz + Math.sin(a0) * r) * HS + y, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, heightAt(w.terrain, cx + Math.cos(a1) * r, cz + Math.sin(a1) * r) * HS + y, cz + Math.sin(a1) * r); }
    };
    const draw = (s: { kind: string; id: number }, color: number, alpha: number) => {
      void alpha;
      if (s.kind === 'edge') {
        const e = w.net.edges.get(s.id);
        if (!e) return;
        ribbonPoly(mb, e.pts, e.zs, (e.width ?? 0.6) + 0.1, 0.05, color);
      } else if (s.kind === 'node') {
        const n = w.net.nodes.get(s.id);
        if (n) circle(n.x, n.y, 0.55, n.z * HS + 0.1);
      } else if (s.kind === 'building') {
        const b = w.buildings.get(s.id);
        if (!b) return;
        const y = heightAt(w.terrain, b.x + b.w / 2, b.y + b.h / 2) * HS + 0.08;
        const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
        for (let i = 0; i < 4; i++) { const p = pts[i], q = pts[(i + 1) % 4]; seg.push(p[0], y, p[1], q[0], y, q[1]); }
        const r = DEFS[b.def]?.radius;
        if (r) circle(b.x + b.w / 2, b.y + b.h / 2, r, 0.1);
      } else if (s.kind === 'stop') {
        const st = w.stops.get(s.id);
        if (st) circle(st.x, st.y, 0.6, heightAt(w.terrain, st.x, st.y) * HS + 0.1);
      }
    };
    if (hover && (!sel || hover.id !== sel.id)) draw(hover, 0xffffff, 0.35);
    if (sel) draw(sel, 0xf2b24a, 0.9);
    if (mb.vertexCount) {
      this.mesh = new THREE.Mesh(mb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthTest: false }));
      this.mesh.renderOrder = 10; this.mesh.frustumCulled = false;
      this.group.add(this.mesh);
    }
    if (seg.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf2b24a, depthTest: false, transparent: true, opacity: 0.95 }));
      this.lines.renderOrder = 11; this.lines.frustumCulled = false;
      this.group.add(this.lines);
    }
  }
}

/** Ghosts for road planning, building placement, zone painting and stop placement. */
export class PreviewView {
  group = new THREE.Group();
  meshes: THREE.Object3D[] = [];
  constructor(public world: World, scene: THREE.Scene) { scene.add(this.group); }
  private gridLines: THREE.LineSegments | null = null;
  private gridKey = '';
  /** Faint tile grid around the cursor so the land and tile size are easy to read. */
  setGrid(p: { x: number; y: number } | null) {
    if (!p) { if (this.gridLines) { this.group.remove(this.gridLines); this.gridLines.geometry.dispose(); this.gridLines = null; this.gridKey = ''; } return; }
    const cx = Math.floor(p.x), cy = Math.floor(p.y), key = cx + ',' + cy;
    if (key === this.gridKey) return;
    this.gridKey = key;
    const t = this.world.terrain, R = 11, V = t.n + 1;
    const pos: number[] = [];
    const h = (x: number, y: number) => t.heights[Math.min(t.n, Math.max(0, y)) * V + Math.min(t.n, Math.max(0, x))] * HS + 0.05;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x < cx + R; x++) if (y >= 0 && y <= t.n && x >= 0 && x < t.n) pos.push(x, h(x, y), y, x + 1, h(x + 1, y), y);
    for (let x = cx - R; x <= cx + R; x++) for (let y = cy - R; y < cy + R; y++) if (x >= 0 && x <= t.n && y >= 0 && y < t.n) pos.push(x, h(x, y), y, x, h(x, y + 1), y + 1);
    if (this.gridLines) { this.group.remove(this.gridLines); this.gridLines.geometry.dispose(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.gridLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
    this.gridLines.frustumCulled = false; this.gridLines.renderOrder = 8;
    this.group.add(this.gridLines);
  }
  clear() { for (const m of this.meshes) { this.group.remove(m); (m as THREE.Mesh).geometry?.dispose(); } this.meshes = []; }
  private add(o: THREE.Object3D) { this.group.add(o); this.meshes.push(o); }

  road(plan: RoadPlan | null, width: number, valid: boolean) {
    this.clear();
    if (!plan) return;
    const mb = new MeshBuilder();
    for (const p of plan.pieces) {
      const color = !valid ? 0xe04a3f : p.structure === 'bridge' ? 0x6fb4e8 : p.structure === 'tunnel' ? 0x9a8fd0 : p.structure === 'elevated' ? 0xe8c46a : p.structure === 'depressed' ? 0xb08a5a : 0x7be08f;
      ribbonPoly(mb, p.pts, p.zs, width, 0.06, color);
    }
    const mesh = new THREE.Mesh(mb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthTest: false }));
    mesh.renderOrder = 9; mesh.frustumCulled = false;
    this.add(mesh);
    const jb = new MeshBuilder();
    for (const j of plan.junctions) {
      const y = heightAt(this.world.terrain, j.x, j.y) * HS + 0.1;
      jb.cylinder(j.x, y, j.y, 0.12, 0.05, j.kind === 'cross' ? 0x4cd964 : j.kind === 'existing' ? 0x4cd964 : 0x9bd0ff, 10);
    }
    if (jb.vertexCount) { const m = new THREE.Mesh(jb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false })); m.renderOrder = 10; m.frustumCulled = false; this.add(m); }
    // demolition markers
    const db = new MeshBuilder();
    for (const id of plan.demolish) { const b = this.world.buildings.get(id); if (b) db.box(b.x + b.w / 2, heightAt(this.world.terrain, b.x, b.y) * HS, b.y + b.h / 2, b.w, 0.4, b.h, 0xe04a3f, {}); }
    if (db.vertexCount) { const m = new THREE.Mesh(db.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthTest: false })); m.renderOrder = 9; m.frustumCulled = false; this.add(m); }
  }

  line(pts: number[], color: number) {
    this.clear();
    if (pts.length < 4) return;
    const mb = new MeshBuilder();
    const zs = pts.filter((_, i) => i % 2 === 0).map((x, i) => heightAt(this.world.terrain, x, pts[i * 2 + 1]));
    ribbonPoly(mb, pts, zs, 0.1, 0.07, color);
    const mesh = new THREE.Mesh(mb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthTest: false }));
    mesh.renderOrder = 9; mesh.frustumCulled = false;
    this.add(mesh);
  }

  rect(x0: number, y0: number, x1: number, y1: number, color: number, valid: boolean[][] | null = null) {
    this.clear();
    const t = this.world.terrain, V = t.n + 1;
    const mb = new MeshBuilder();
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      if (x < 0 || y < 0 || x >= t.n || y >= t.n) continue;
      const h = (k: number) => t.heights[k] * HS + 0.04;
      const ok = valid ? valid[y - ay][x - ax] : true;
      mb.quad([x, h(( y + 1) * V + x), y + 1], [x + 1, h((y + 1) * V + x + 1), y + 1], [x + 1, h(y * V + x + 1), y], [x, h(y * V + x), y], ok ? color : 0xe04a3f);
    }
    if (!mb.vertexCount) return;
    const mesh = new THREE.Mesh(mb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthTest: false }));
    mesh.renderOrder = 9; mesh.frustumCulled = false;
    this.add(mesh);
  }

  building(key: string, x: number, y: number, rot: number, ok: boolean) {
    this.clear();
    const def = DEFS[key];
    if (!def) return;
    const w = rot % 2 ? def.h : def.w, h = rot % 2 ? def.w : def.h;
    const t = this.world.terrain, V = t.n + 1;
    let top = -1e9;
    for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) top = Math.max(top, (t.heights[Math.min(t.n, y + j) * V + Math.min(t.n, x + i)] ?? 0));
    const mb = new MeshBuilder();
    const bh = def.cat === 'park' ? 0.04 : Math.max(0.12, def.maxLevels * 0.08);
    mb.box(x + w / 2, top * HS, y + h / 2, w * 0.96, Math.min(bh, 0.9), h * 0.96, ok ? 0x7be08f : 0xe04a3f, {});
    const mesh = new THREE.Mesh(mb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false }));
    mesh.renderOrder = 9; mesh.frustumCulled = false;
    this.add(mesh);
    if (def.radius) {
      const seg: number[] = [];
      const N = 48;
      const cx = x + w / 2, cz = y + h / 2;
      for (let i = 0; i < N; i++) { const a0 = (i / N) * 6.2832, a1 = ((i + 1) / N) * 6.2832; const p = (a: number) => [cx + Math.cos(a) * def.radius!, heightAt(this.world.terrain, cx + Math.cos(a) * def.radius!, cz + Math.sin(a) * def.radius!) * HS + 0.1, cz + Math.sin(a) * def.radius!]; seg.push(...p(a0), ...p(a1)); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf2b24a, depthTest: false, transparent: true, opacity: 0.8 }));
      l.renderOrder = 10; l.frustumCulled = false;
      this.add(l);
    }
  }

  layout(items: { key: string; x: number; y: number; w: number; h: number }[], ok: boolean[]) {
    this.clear();
    const t = this.world.terrain, V = t.n + 1;
    const mb = new MeshBuilder();
    items.forEach((it, i) => {
      let top = -1e9;
      for (let j = 0; j <= it.h; j++) for (let k = 0; k <= it.w; k++) top = Math.max(top, t.heights[Math.min(t.n, Math.max(0, it.y + j)) * V + Math.min(t.n, Math.max(0, it.x + k))] ?? 0);
      const def = DEFS[it.key];
      const bh = def.cat === 'park' || def.key === 'auto_stand' ? 0.05 : Math.min(0.9, Math.max(0.15, def.maxLevels * 0.07));
      mb.box(it.x + it.w / 2, top * HS, it.y + it.h / 2, it.w * 0.92, bh, it.h * 0.92, ok[i] ? 0x7be08f : 0xe04a3f, {});
    });
    const m = new THREE.Mesh(mb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false }));
    m.renderOrder = 9; m.frustumCulled = false;
    this.add(m);
  }

  marker(x: number, y: number, color: number) {
    this.clear();
    const mb = new MeshBuilder();
    mb.cylinder(x, heightAt(this.world.terrain, x, y) * HS + 0.05, y, 0.16, 0.08, color, 12);
    const m = new THREE.Mesh(mb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }));
    m.renderOrder = 9; m.frustumCulled = false;
    this.add(m);
  }
}

export { Zone, ZONE_INFO, TRANSIT };
export type { RoadEdge };
