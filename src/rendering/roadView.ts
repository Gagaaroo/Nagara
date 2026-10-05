import * as THREE from 'three';
import type { World } from '../game/world';
import { RoadEdge, RoadNode, HEIGHT_SCALE, ID } from '../game/types';
import { MeshBuilder } from './meshBuilder';
import { pointAt, leftNormal } from '../game/roads/geometry';
import { BIKE_W, LANE_W, MEDIAN_W, PARK_W, SIDEWALK_W, carriageHalf } from '../game/roads/spec';
import { heightAt, waterSurfaceAt, NO_WATER } from '../game/terrain/query';

const HS = HEIGHT_SCALE;
const LIFT = 0.034;
export const SURFACE_COLOR = { asphalt: 0x3a3e43, concrete: 0x9c9a92, decorative: 0x9a7762 } as const;

interface EdgeGeo {
  sig: string;
  pos: Float32Array; nor: Float32Array; col: Float32Array; uv: Float32Array; idx: Uint32Array;
  carriage: [number, number]; // vertex range of drivable surface
  lamps: number[]; trees: number[]; benches: number[]; signs: number[]; poles: number[]; wires: number[];
}

export interface Furniture { lamps: number[]; trees: number[]; benches: number[]; signs: number[]; poles: number[]; wires: number[]; signals: { node: ID; edge: ID; x: number; y: number; z: number; ang: number }[] }

export class RoadView {
  group = new THREE.Group();
  mesh: THREE.Mesh | null = null;
  tunnels: THREE.Mesh | null = null;
  wireLines: THREE.LineSegments | null = null;
  cache = new Map<ID, EdgeGeo>();
  nodeCache = new Map<ID, { sig: string; mb: MeshBuilder; signals: { edge: ID; x: number; y: number; z: number; ang: number }[] }>();
  ranges = new Map<ID, [number, number]>();
  baseColors: Float32Array = new Float32Array(0);
  furniture: Furniture = { lamps: [], trees: [], benches: [], signs: [], poles: [], wires: [], signals: [] };
  version = -1;
  material: THREE.MeshStandardMaterial;
  recolored = false;

  constructor(public world: World, scene: THREE.Scene, material: THREE.MeshStandardMaterial) {
    scene.add(this.group);
    this.material = material;
  }

  dispose() { this.group.removeFromParent(); this.mesh?.geometry.dispose(); }

  groundY(x: number, y: number) { return heightAt(this.world.terrain, x, y) * HS; }

  private trimFor(node: RoadNode | undefined, e: RoadEdge): number {
    if (!node || node.edges.length < 3) return 0;
    const ctrl = this.world.net.resolveControl(node);
    let m = 0;
    for (const id of node.edges) {
      if (id === e.id) continue;
      const o = this.world.net.edges.get(id);
      if (o) m = Math.max(m, carriageHalf(o.spec));
    }
    const base = m + 0.1;
    return ctrl === 'roundabout' ? Math.max(base, 0.62) : base;
  }

  rebuild() {
    const w = this.world, net = w.net;
    // drop stale cache entries
    for (const id of [...this.cache.keys()]) if (!net.edges.has(id)) this.cache.delete(id);
    for (const id of [...this.nodeCache.keys()]) if (!net.nodes.has(id)) this.nodeCache.delete(id);
    const parts: EdgeGeo[] = [];
    this.furniture = { lamps: [], trees: [], benches: [], signs: [], poles: [], wires: [], signals: [] };
    const underground = w.policies.undergroundUtilities;
    for (const e of net.edges.values()) {
      const trimA = this.trimFor(net.nodes.get(e.a), e), trimB = this.trimFor(net.nodes.get(e.b), e);
      const sig = `${JSON.stringify(e.spec)}|${e.structure}|${e.pts.length}|${e.pts[0].toFixed(2)},${e.pts[1].toFixed(2)}|${e.zs[0].toFixed(1)}|${trimA.toFixed(2)}|${trimB.toFixed(2)}|${underground}|${w.terrainVersion}`;
      let g = this.cache.get(e.id);
      if (!g || g.sig !== sig) { g = this.buildEdge(e, trimA, trimB, sig, underground); this.cache.set(e.id, g); }
      parts.push(g);
      this.furniture.lamps.push(...g.lamps); this.furniture.trees.push(...g.trees); this.furniture.benches.push(...g.benches);
      this.furniture.signs.push(...g.signs); this.furniture.poles.push(...g.poles); this.furniture.wires.push(...g.wires);
    }
    // junctions
    const nodeMbs: MeshBuilder[] = [];
    for (const n of net.nodes.values()) {
      if (n.edges.length < 2) continue;
      const ctrl = net.resolveControl(n);
      const sig = n.edges.map((id) => { const e = net.edges.get(id); return e ? `${id}:${JSON.stringify(e.spec.lanesFwd)}${e.spec.lanesBwd}${e.spec.median}${e.spec.surface}` : ''; }).join(',') + `|${ctrl}|${n.crossings}|${n.z.toFixed(1)}|${w.terrainVersion}`;
      let nc = this.nodeCache.get(n.id);
      if (!nc || nc.sig !== sig) { nc = this.buildNode(n, ctrl, sig); this.nodeCache.set(n.id, nc); }
      nodeMbs.push(nc.mb);
      for (const s of nc.signals) this.furniture.signals.push({ node: n.id, ...s });
    }
    // merge
    let vTot = 0, iTot = 0;
    for (const p of parts) { vTot += p.pos.length / 3; iTot += p.idx.length; }
    for (const mb of nodeMbs) { vTot += mb.vertexCount; iTot += mb.idx.length; }
    const pos = new Float32Array(vTot * 3), nor = new Float32Array(vTot * 3), col = new Float32Array(vTot * 3), uv = new Float32Array(vTot * 2);
    const idx = new Uint32Array(iTot);
    let vo = 0, io = 0;
    this.ranges.clear();
    const edgeList = [...net.edges.values()];
    parts.forEach((p, k) => {
      pos.set(p.pos, vo * 3); nor.set(p.nor, vo * 3); col.set(p.col, vo * 3); uv.set(p.uv, vo * 2);
      for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
      this.ranges.set(edgeList[k].id, [vo + p.carriage[0], vo + p.carriage[1]]);
      vo += p.pos.length / 3; io += p.idx.length;
    });
    for (const mb of nodeMbs) {
      pos.set(mb.pos, vo * 3); nor.set(mb.nor, vo * 3); col.set(mb.col, vo * 3); uv.set(mb.uv, vo * 2);
      for (let i = 0; i < mb.idx.length; i++) idx[io + i] = mb.idx[i] + vo;
      vo += mb.vertexCount; io += mb.idx.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(w.n / 2, 10, w.n / 2), w.n);
    this.baseColors = col.slice();
    if (this.mesh) { this.mesh.geometry.dispose(); this.group.remove(this.mesh); }
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.group.add(this.mesh);
    // overhead wires
    if (this.wireLines) { this.wireLines.geometry.dispose(); this.group.remove(this.wireLines); this.wireLines = null; }
    if (this.furniture.wires.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(this.furniture.wires, 3));
      this.wireLines = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.7 }));
      this.wireLines.frustumCulled = false;
      this.group.add(this.wireLines);
    }
    this.version = net.version;
    this.recolored = false;
  }

  /** Recolour drivable surfaces. `fn` returns an RGB triple or null for the base colour. */
  recolor(fn: ((id: ID) => [number, number, number] | null) | null) {
    if (!this.mesh) return;
    const col = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    if (!fn) {
      if (this.recolored) { arr.set(this.baseColors); col.needsUpdate = true; this.recolored = false; }
      return;
    }
    for (const [id, [a, b]] of this.ranges) {
      const c = fn(id);
      for (let v = a; v < b; v++) {
        if (c) { arr[v * 3] = c[0]; arr[v * 3 + 1] = c[1]; arr[v * 3 + 2] = c[2]; }
        else { arr[v * 3] = this.baseColors[v * 3]; arr[v * 3 + 1] = this.baseColors[v * 3 + 1]; arr[v * 3 + 2] = this.baseColors[v * 3 + 2]; }
      }
    }
    col.needsUpdate = true;
    this.recolored = true;
  }

  // ───────── per-edge geometry ─────────
  private buildEdge(e: RoadEdge, trimA: number, trimB: number, sig: string, underground: boolean): EdgeGeo {
    const sp = e.spec;
    const mb = new MeshBuilder();
    const net = this.world.net;
    void net;
    const L = e.len;
    const half = carriageHalf(sp);
    const mw = (sp.lanesFwd && sp.lanesBwd) ? MEDIAN_W[sp.median] : 0;
    const surf = SURFACE_COLOR[sp.surface];
    const struct = e.structure;
    const lamps: number[] = [], trees: number[] = [], benches: number[] = [], signs: number[] = [], poles: number[] = [], wires: number[] = [];
    const zAt = (s: number) => { const p = pointAt(e.pts, e.cum, s); const z0 = e.zs[p.i] ?? 0, z1 = e.zs[p.i + 1] ?? z0; return z0 + (z1 - z0) * p.t; };
    const lift = struct === 'tunnel' ? -0.02 : LIFT;
    const pp = { x: 0, y: 0, ang: 0, i: 0, t: 0 };
    const ribbon = (s0: number, s1: number, uL: number, uR: number, dy: number, color: number, shade = 1, ds = 0.45) => {
      if (s1 - s0 < 0.04) return;
      const steps = Math.max(1, Math.ceil((s1 - s0) / ds));
      let prev: number[][] | null = null;
      for (let k = 0; k <= steps; k++) {
        const s = s0 + ((s1 - s0) * k) / steps;
        pointAt(e.pts, e.cum, s, pp);
        const [nx, ny] = leftNormal(pp.ang);
        const z = zAt(s) * HS + lift + dy;
        const Lp = [pp.x + nx * uL, z, pp.y + ny * uL], Rp = [pp.x + nx * uR, z, pp.y + ny * uR];
        if (prev) mb.quad(prev[1], Rp, Lp, prev[0], color, undefined, shade);
        prev = [Lp, Rp];
      }
    };
    const wall = (s0: number, s1: number, u: number, y0: number, y1: number, color: number, ds = 0.5, shade = 0.85) => {
      // vertical strip along the edge at lateral offset u from height y0 to y1 (relative to road surface)
      const steps = Math.max(1, Math.ceil((s1 - s0) / ds));
      let prev: number[] | null = null;
      for (let k = 0; k <= steps; k++) {
        const s = s0 + ((s1 - s0) * k) / steps;
        pointAt(e.pts, e.cum, s, pp);
        const [nx, ny] = leftNormal(pp.ang);
        const z = zAt(s) * HS + lift;
        const cur = [pp.x + nx * u, z + y0, pp.y + ny * u, z + y1];
        if (prev) {
          if (u > 0) mb.quad([prev[0], prev[1], prev[2]], [cur[0], cur[1], cur[2]], [cur[0], cur[3], cur[2]], [prev[0], prev[3], prev[2]], color, undefined, shade);
          else mb.quad([cur[0], cur[1], cur[2]], [prev[0], prev[1], prev[2]], [prev[0], prev[3], prev[2]], [cur[0], cur[3], cur[2]], color, undefined, shade);
        }
        prev = cur;
      }
    };
    const carriageStart = mb.vertexCount;
    // carriageway (full length node to node)
    if (struct !== 'tunnel') {
      ribbon(0, L, -half, half, 0, surf);
    }
    const carriageEnd = mb.vertexCount;
    if (struct === 'tunnel') {
      // faint trace of the tunnel on the surface is drawn elsewhere; nothing visible here
      return this.finish(mb, sig, [0, 0], lamps, trees, benches, signs, poles, wires, e);
    }
    // bus lanes
    if (sp.bus === 'busonly') ribbon(0, L, -half, half, 0.002, 0xa4503f, 1);
    else if (sp.bus === 'dedicated') {
      if (sp.lanesFwd) ribbon(0, L, half - LANE_W, half, 0.002, 0xa4503f);
      if (sp.lanesBwd) ribbon(0, L, -half, -half + LANE_W, 0.002, 0xa4503f);
    } else if (sp.bus === 'shared') {
      if (sp.lanesFwd) ribbon(0, L, half - LANE_W, half, 0.0015, 0x4a4244);
      if (sp.lanesBwd) ribbon(0, L, -half, -half + LANE_W, 0.0015, 0x4a4244);
    }
    // median
    if (mw > 0) {
      const mt = Math.max(trimA, 0), mt2 = Math.max(trimB, 0);
      if (sp.median === 'painted') ribbon(0, L, -mw / 2, mw / 2, 0.003, 0xd7b543);
      else if (sp.median === 'raised') { ribbon(mt, L - mt2, -mw / 2, mw / 2, 0.02, 0xb9b6ac); }
      else if (sp.median === 'landscaped') { ribbon(mt, L - mt2, -mw / 2, mw / 2, 0.02, 0x5f9a52); ribbon(mt, L - mt2, -mw / 2 - 0.01, -mw / 2, 0.021, 0xb9b6ac); ribbon(mt, L - mt2, mw / 2, mw / 2 + 0.01, 0.021, 0xb9b6ac); }
      else if (sp.median === 'barrier') { ribbon(mt, L - mt2, -mw / 2, mw / 2, 0.03, 0xa7a79f); }
    } else if (sp.lanesFwd && sp.lanesBwd) {
      // centre line
      ribbon(0, L, -0.012, -0.004, 0.003, 0xd7b543, 1, 0.9);
      ribbon(0, L, 0.004, 0.012, 0.003, 0xd7b543, 1, 0.9);
    }
    // lane lines
    const lineW = 0.005;
    const nF = sp.lanesFwd, nB = sp.lanesBwd;
    if (nF && nB) {
      for (let k = 1; k < nF; k++) ribbon(0, L, mw / 2 + k * LANE_W - lineW, mw / 2 + k * LANE_W + lineW, 0.003, 0xe8e6de, 1, 0.8);
      for (let k = 1; k < nB; k++) ribbon(0, L, -(mw / 2 + k * LANE_W) - lineW, -(mw / 2 + k * LANE_W) + lineW, 0.003, 0xe8e6de, 1, 0.8);
    } else {
      const nL = nF + nB;
      for (let k = 1; k < nL; k++) ribbon(0, L, -half + k * LANE_W - lineW, -half + k * LANE_W + lineW, 0.003, 0xe8e6de, 1, 0.8);
    }
    // sidewalks, bike lanes, parking, drains — both sides, trimmed at junctions
    const sA = trimA, sB = L - trimB;
    const sw = SIDEWALK_W[sp.sidewalk], bw = BIKE_W[sp.bike], pw = PARK_W[sp.parking];
    for (const side of [1, -1]) {
      let u = half;
      const f = (a: number, b: number) => (side > 0 ? [b, a] : [-a, -b]);
      if (pw > 0) { const [uL, uR] = f(u, u + pw); ribbon(sA, sB, uL, uR, 0.0015, 0x4a4f54); ribbon(sA, sB, uL, uL + 0.0, 0.002, 0xdedbd2); u += pw; }
      if (bw > 0) {
        const [uL, uR] = f(u, u + bw);
        const color = sp.bike === 'painted' ? 0x6aa56a : sp.bike === 'protected' ? 0x4f9a63 : 0x2f8f6a;
        ribbon(sA, sB, uL, uR, 0.004, color);
        if (sp.bike === 'protected') { const [a, b] = f(u - 0.012, u); ribbon(sA, sB, a, b, 0.02, 0xb5b3a9); }
        u += bw;
      } else if (sp.bike === 'shared') { /* sharrow marks */ }
      if (sp.drain === 'open') { const [uL, uR] = f(u, u + 0.04); ribbon(sA, sB, uL, uR, -0.004, 0x2b2e30); u += 0.04; }
      if (sw > 0) {
        const [uL, uR] = f(u, u + sw);
        ribbon(sA, sB, uL, uR, 0.018, sp.surface === 'decorative' ? 0xc9a98a : 0xc9c6bc);
        const [kA, kB] = f(u, u + 0.008);
        ribbon(sA, sB, kA, kB, 0.02, 0x9a978d);
        if (sp.drain === 'covered' || sp.drain === 'storm') { const [gA, gB] = f(u + sw - 0.02, u + sw); ribbon(sA, sB, gA, gB, 0.0185, 0x8a8f94, 0.9, 0.6); }
        u += sw;
      }
      // furniture
      const edgeU = (u - 0.025) * side;
      const place = (spacing: number, offset: number, fn: (x: number, y: number, z: number, ang: number, s: number) => void) => {
        if (sB - sA < spacing * 0.6) return;
        for (let s = sA + offset; s < sB - 0.2; s += spacing) {
          pointAt(e.pts, e.cum, s, pp);
          const [nx, ny] = leftNormal(pp.ang);
          fn(pp.x + nx * edgeU, zAt(s) * HS + lift, pp.y + ny * edgeU, pp.ang, s);
        }
      };
      const ang0 = (a: number) => a + (side > 0 ? 0 : Math.PI);
      if (sp.lights) place(2.4, side > 0 ? 0.6 : 1.8, (x, y, z, a) => lamps.push(x, y, z, ang0(a) + Math.PI / 2));
      if (sp.trees) place(1.7, side > 0 ? 1.0 : 1.9, (x, y, z) => trees.push(x, y, z, 0.7 + (Math.sin(x * 12.9 + z * 7.1) * 0.5 + 0.5) * 0.4));
      if (sp.benches && sw >= 0.17) place(4.6, side > 0 ? 2.2 : 3.4, (x, y, z, a) => benches.push(x, y, z, a));
      if (sp.signs) place(6.5, side > 0 ? 3.0 : 4.8, (x, y, z, a) => signs.push(x, y, z, ang0(a) + Math.PI / 2));
      if (!underground && !sp.lights && (sp.category === 'local' || sp.category === 'collector') && side > 0) {
        let prev: number[] | null = null;
        place(3.2, 1.3, (x, y, z) => {
          poles.push(x, y, z, 0);
          if (prev) for (const dy of [0.17, 0.2]) wires.push(prev[0], prev[1] + dy, prev[2], x, y + dy, z);
          prev = [x, y, z];
        });
      }
    }
    // structures
    if (struct === 'bridge' || struct === 'elevated') {
      const halfW = e.width! / 2 + 0.01;
      wall(0, L, halfW, -0.07, 0.0, 0xaaa79d);
      wall(0, L, -halfW, -0.07, 0.0, 0xaaa79d);
      // underside
      ribbon(0, L, -halfW, halfW, -0.07, 0x8d8a82, 0.7);
      // railings
      wall(0, L, halfW - 0.005, 0.0, 0.05, 0xd9d6cc, 0.5, 0.95);
      wall(0, L, -halfW + 0.005, 0.0, 0.05, 0xd9d6cc, 0.5, 0.95);
      // piers
      const spacing = struct === 'bridge' ? 2.4 : 2.0;
      for (let s = spacing * 0.5; s < L; s += spacing) {
        pointAt(e.pts, e.cum, s, pp);
        const z = zAt(s) * HS - 0.07 + lift;
        let g = heightAt(this.world.terrain, pp.x, pp.y) * HS;
        const ws = waterSurfaceAt(this.world.terrain, pp.x, pp.y);
        if (ws > NO_WATER / 2) g = Math.min(g, ws * HS - 0.05);
        if (z - g < 0.05) continue;
        mb.setTransform(pp.x, g - 0.05, pp.y, -pp.ang);
        mb.box(0, 0, 0, 0.08, z - g + 0.05, Math.min(halfW * 1.4, 0.4), 0xa6a398, { noBottom: true });
        mb.setTransform(0, 0, 0, 0);
      }
    } else if (struct === 'depressed') {
      wall(0, L, half + 0.0, -0.09, 0.0, 0x8e8b82, 0.5, 0.8);
      wall(0, L, -half, -0.09, 0.0, 0x8e8b82, 0.5, 0.8);
    }
    return this.finish(mb, sig, [carriageStart, carriageEnd], lamps, trees, benches, signs, poles, wires, e);
  }

  private finish(mb: MeshBuilder, sig: string, carriage: [number, number], lamps: number[], trees: number[], benches: number[], signs: number[], poles: number[], wires: number[], e: RoadEdge): EdgeGeo {
    // tunnel portals at transitions: drawn when the edge itself is a tunnel
    if (e.structure === 'tunnel') {
      for (const end of [0, 1]) {
        const s = end === 0 ? 0 : e.len;
        const p = pointAt(e.pts, e.cum, s);
        const z = (e.zs[end === 0 ? 0 : e.zs.length - 1] ?? 0) * HS;
        const half = carriageHalf(e.spec);
        const w = e.width! + 0.16;
        mb.setTransform(p.x, z - 0.02, p.y, -p.ang + (end === 0 ? Math.PI : 0));
        mb.box(0.0, 0, 0, 0.2, 0.2, w, 0x8d8a82, { noBottom: true });
        // dark opening
        mb.quad([0.101, 0.0, -half], [0.101, 0.0, half], [0.101, 0.15, half], [0.101, 0.15, -half], 0x111314);
        mb.setTransform(0, 0, 0, 0);
      }
    }
    return {
      sig, pos: new Float32Array(mb.pos), nor: new Float32Array(mb.nor), col: new Float32Array(mb.col), uv: new Float32Array(mb.uv), idx: new Uint32Array(mb.idx),
      carriage, lamps, trees, benches, signs, poles, wires,
    };
  }

  // ───────── junctions ─────────
  private buildNode(n: RoadNode, ctrl: string, sig: string) {
    const w = this.world, net = w.net;
    const mb = new MeshBuilder();
    const signals: { edge: ID; x: number; y: number; z: number; ang: number }[] = [];
    let R = 0.1;
    let surf: number = SURFACE_COLOR.asphalt;
    let crossingsW = 0.08;
    const arms: { e: RoadEdge; ang: number; half: number }[] = [];
    for (const id of n.edges) {
      const e = net.edges.get(id);
      if (!e) continue;
      const half = carriageHalf(e.spec);
      R = Math.max(R, half);
      const toward = e.a === n.id ? 0 : e.len;
      const p0 = pointAt(e.pts, e.cum, toward);
      const p1 = pointAt(e.pts, e.cum, e.a === n.id ? Math.min(e.len, 0.5) : Math.max(0, e.len - 0.5));
      arms.push({ e, ang: Math.atan2(p1.y - p0.y, p1.x - p0.x), half });
      surf = SURFACE_COLOR[e.spec.surface];
      void p0;
    }
    const y = n.z * HS + LIFT;
    const roundabout = ctrl === 'roundabout';
    const Rr = roundabout ? Math.max(R * 1.6, 0.62) : R + 0.03;
    const seg = 18;
    const disc = (r: number, dy: number, color: number, shade = 1) => {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        mb.tri([n.x, y + dy, n.y], [n.x + Math.cos(a1) * r, y + dy, n.y + Math.sin(a1) * r], [n.x + Math.cos(a0) * r, y + dy, n.y + Math.sin(a0) * r], color, shade);
      }
    };
    if (n.edges.length >= 3 || roundabout) disc(Rr, 0.0006, surf);
    if (roundabout) {
      disc(Rr * 0.5 + 0.03, 0.02, 0xb9b6ac);
      disc(Rr * 0.5, 0.024, 0x5f9a52);
      // little tree
    }
    // crossings and signals per arm
    for (const arm of arms) {
      const e = arm.e;
      const fromA = e.a === n.id;
      const trim = Math.max(0.12, this.trimFor(n, e));
      const s = fromA ? trim * 0.92 : e.len - trim * 0.92;
      const p = pointAt(e.pts, e.cum, Math.max(0, Math.min(e.len, s)));
      const ang = fromA ? p.ang : p.ang + Math.PI; // pointing away from the node
      const z = (e.zs[Math.min(e.zs.length - 1, Math.max(0, Math.round((s / e.len) * (e.zs.length - 1))))] ?? n.z) * HS + LIFT + 0.004;
      if (n.crossings && ctrl !== 'none') {
        mb.setTransform(p.x, z, p.y, -ang);
        const stripes = Math.max(4, Math.round(arm.half * 2 / 0.045));
        for (let k = 0; k < stripes; k++) {
          const u = -arm.half + (arm.half * 2 * (k + 0.5)) / stripes;
          mb.box(0, 0, u, 0.06, 0.002, 0.022, 0xefece2, { noBottom: true });
        }
        mb.setTransform(0, 0, 0, 0);
      } else if (ctrl === 'signal' || ctrl === 'priority') {
        // stop line
        mb.setTransform(p.x, z, p.y, -ang);
        mb.box(-0.03, 0, -arm.half / 2, 0.012, 0.002, arm.half * 0.98, 0xefece2, { noBottom: true });
        mb.setTransform(0, 0, 0, 0);
      }
      void crossingsW;
      if (ctrl === 'signal') {
        const [nx, ny] = leftNormal(ang + Math.PI); // approaching traffic's left side
        const off = arm.half + 0.05;
        signals.push({ edge: e.id, x: p.x + nx * off, y: p.y + ny * off, z: z - 0.004, ang });
      }
    }
    return { sig, mb, signals };
  }
}
