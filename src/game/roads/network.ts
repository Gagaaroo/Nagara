import { ID, RoadEdge, RoadNode, RoadSpec, Structure } from '../types';
import { closestOnPolyline, cumLengths, pointAt, splitPolyline } from './geometry';
import { CATEGORY_RANK, capacityDir, roadWidth, STRUCTURE_CAP, laneCount } from './spec';

/** Indices into RoadEdge.vol per direction (daily assigned volumes). */
export const VI = { two: 0, car: 1, auto: 2, bus: 3, truck: 4, walk: 5, bike: 6 } as const;
export const NV = 7;

const CELL = 6;

export function edgeAllows(e: RoadEdge, dir: number): boolean {
  return (dir === 0 ? e.spec.lanesFwd : e.spec.lanesBwd) > 0;
}

/**
 * The road graph: nodes (junctions) joined by edges (polylines with a RoadSpec).
 * Handles splitting, spatial queries and a tile occupancy mask for buildings.
 */
export class RoadNetwork {
  nodes = new Map<ID, RoadNode>();
  edges = new Map<ID, RoadEdge>();
  version = 0;
  topoVersion = 0;
  mask: Uint8Array;
  private maskDirty = false;
  private cells = new Map<number, ID[]>();
  removedEdges: ID[] = [];

  constructor(public n: number, private newId: () => ID) {
    this.mask = new Uint8Array(n * n);
  }

  touch(topology = false) {
    this.version++;
    if (topology) this.topoVersion++;
  }

  addNode(x: number, y: number, z: number): RoadNode {
    const node: RoadNode = {
      id: this.newId(), x, y, z, control: 'auto', crossings: false, busPriority: false, turnLanes: false, cycle: 70, mainShare: 0.5, banned: {}, edges: [],
    };
    this.nodes.set(node.id, node);
    return node;
  }

  finishEdge(e: RoadEdge) {
    e.cum = cumLengths(e.pts);
    e.len = e.cum[e.cum.length - 1];
    e.width = roadWidth(e.spec);
    const k = STRUCTURE_CAP[e.structure];
    e.cap = Math.max(capacityDir(e.spec, 0), capacityDir(e.spec, 1)) * k;
    e.lanes = Array.from({ length: laneCount(e.spec) }, () => []);
    e.vol = e.vol ?? new Float32Array(NV * 2);
    e.flowVc = e.flowVc ?? [0, 0];
    e.speedNow = [e.spec.speed, e.spec.speed];
    e.tt = [0, 0];
    e.stat = e.stat ?? { car: 0, two: 0, auto: 0, bus: 0, truck: 0, ped: 0, bike: 0, busLines: 0, total: 0 };
    const last = e.pts.length;
    e.heading = Math.atan2(e.pts[last - 1] - e.pts[1], e.pts[last - 2] - e.pts[0]);
    const kin = STRUCTURE_CAP[e.structure];
    e.tt = [
      (e.len * 50) / ((e.spec.speed / 3.6) * kin + 1e-3),
      (e.len * 50) / ((e.spec.speed / 3.6) * kin + 1e-3),
    ];
  }

  addEdge(a: ID, b: ID, spec: RoadSpec, structure: Structure, pts: number[], zs: number[], cost: number, built: number): RoadEdge {
    const e: RoadEdge = { id: this.newId(), a, b, spec, structure, pts, zs, cum: [], len: 0, cost, built };
    this.finishEdge(e);
    this.edges.set(e.id, e);
    this.nodes.get(a)!.edges.push(e.id);
    this.nodes.get(b)!.edges.push(e.id);
    this.indexEdge(e);
    if (structure === 'ground' || structure === 'depressed') this.stampMask(e);
    this.touch(true);
    return e;
  }

  removeEdge(id: ID, keepNodes = false) {
    const e = this.edges.get(id);
    if (!e) return;
    this.edges.delete(id);
    this.removedEdges.push(id);
    this.unindexEdge(e);
    for (const nid of [e.a, e.b]) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      n.edges = n.edges.filter((x) => x !== id);
      delete n.banned[id];
      if (!keepNodes && n.edges.length === 0) this.nodes.delete(nid);
    }
    this.maskDirty = true;
    this.touch(true);
  }

  /** Remove junctions that no longer connect any road. */
  pruneOrphans() {
    for (const [id, n] of this.nodes) if (n.edges.length === 0) this.nodes.delete(id);
  }

  other(e: RoadEdge, nodeId: ID): ID { return e.a === nodeId ? e.b : e.a; }

  /** z (m) along an edge at distance s. */
  zAt(e: RoadEdge, s: number): number {
    const p = pointAt(e.pts, e.cum, s);
    const z0 = e.zs[p.i] ?? 0, z1 = e.zs[p.i + 1] ?? z0;
    return z0 + (z1 - z0) * p.t;
  }

  splitEdge(id: ID, s: number): RoadNode | null {
    const e = this.edges.get(id);
    if (!e) return null;
    if (s < 0.12 || s > e.len - 0.12) return null;
    const [pa, pb] = splitPolyline(e.pts, e.cum, s);
    const z = this.zAt(e, s);
    const zsOf = (pts: number[], s0: number) => {
      const cum = cumLengths(pts);
      return cum.map((c) => this.zAt(e, s0 + c));
    };
    const node = this.addNode(pa[pa.length - 2], pa[pa.length - 1], z);
    const share = s / e.len;
    const bannedA = this.nodes.get(e.a)?.banned[id];
    const bannedB = this.nodes.get(e.b)?.banned[id];
    const na = this.nodes.get(e.a)!, nb = this.nodes.get(e.b)!;
    this.removeEdge(id, true);
    const e1 = this.addEdge(e.a, node.id, e.spec, e.structure, pa, zsOf(pa, 0), e.cost * share, e.built);
    const e2 = this.addEdge(node.id, e.b, e.spec, e.structure, pb, zsOf(pb, s), e.cost * (1 - share), e.built);
    if (bannedA) na.banned[e1.id] = bannedA;
    if (bannedB) nb.banned[e2.id] = bannedB;
    e1.vol!.set(e.vol!); e2.vol!.set(e.vol!);
    return node;
  }

  // ───────── spatial queries ─────────
  private cellKey(cx: number, cy: number) { return cy * 4096 + cx; }
  private indexEdge(e: RoadEdge) {
    const seen = new Set<number>();
    for (let i = 0; i < e.pts.length; i += 2) {
      const cx0 = Math.floor((e.pts[i] - 0.5) / CELL), cx1 = Math.floor((e.pts[i] + 0.5) / CELL);
      const cy0 = Math.floor((e.pts[i + 1] - 0.5) / CELL), cy1 = Math.floor((e.pts[i + 1] + 0.5) / CELL);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const k = this.cellKey(cx, cy);
        if (seen.has(k)) continue;
        seen.add(k);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(e.id);
      }
    }
  }
  private unindexEdge(e: RoadEdge) {
    for (let i = 0; i < e.pts.length; i += 2) {
      const cx0 = Math.floor((e.pts[i] - 0.5) / CELL), cx1 = Math.floor((e.pts[i] + 0.5) / CELL);
      const cy0 = Math.floor((e.pts[i + 1] - 0.5) / CELL), cy1 = Math.floor((e.pts[i + 1] + 0.5) / CELL);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const arr = this.cells.get(this.cellKey(cx, cy));
        if (!arr) continue;
        const ix = arr.indexOf(e.id);
        if (ix >= 0) arr.splice(ix, 1);
      }
    }
  }

  edgesNear(x: number, y: number, r: number): RoadEdge[] {
    const out: RoadEdge[] = [];
    const seen = new Set<ID>();
    for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++)
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
        const arr = this.cells.get(this.cellKey(cx, cy));
        if (!arr) continue;
        for (const id of arr) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = this.edges.get(id);
          if (e) out.push(e);
        }
      }
    return out;
  }

  nearestEdge(x: number, y: number, maxD: number, filter?: (e: RoadEdge) => boolean) {
    let best: { e: RoadEdge; d: number; s: number; x: number; y: number } | null = null;
    for (const e of this.edgesNear(x, y, maxD)) {
      if (filter && !filter(e)) continue;
      const c = closestOnPolyline(e.pts, e.cum, x, y);
      if (c.d <= maxD && (!best || c.d < best.d)) best = { e, d: c.d, s: c.s, x: c.x, y: c.y };
    }
    return best;
  }

  nearestNode(x: number, y: number, maxD: number): RoadNode | null {
    let best: RoadNode | null = null, bd = maxD;
    for (const e of this.edgesNear(x, y, maxD + 1)) {
      for (const id of [e.a, e.b]) {
        const n = this.nodes.get(id)!;
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }

  /** Reuse a node within tol, split an edge if the point lies on one, else create a node. */
  getOrCreateNodeAt(x: number, y: number, z: number, tol = 0.4): RoadNode {
    const n = this.nearestNode(x, y, tol);
    if (n) return n;
    const ne = this.nearestEdge(x, y, 0.25, (e) => e.structure === 'ground' || e.structure === 'depressed');
    if (ne) {
      const s = this.splitEdge(ne.e.id, ne.s);
      if (s) return s;
      // too close to an end: use that end node
      const e = ne.e;
      return this.nodes.get(ne.s < e.len / 2 ? e.a : e.b)!;
    }
    return this.addNode(x, y, z);
  }

  // ───────── occupancy mask ─────────
  private stampMask(e: RoadEdge) {
    const hw = (e.width ?? 0.5) / 2 + 0.06;
    const n = this.n;
    for (let i = 0; i + 3 < e.pts.length; i += 2) {
      const x0 = e.pts[i], y0 = e.pts[i + 1], x1 = e.pts[i + 2], y1 = e.pts[i + 3];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(L / 0.3));
      for (let k = 0; k <= steps; k++) {
        const x = x0 + ((x1 - x0) * k) / steps, y = y0 + ((y1 - y0) * k) / steps;
        for (let ty = Math.floor(y - hw); ty <= Math.floor(y + hw); ty++)
          for (let tx = Math.floor(x - hw); tx <= Math.floor(x + hw); tx++)
            if (tx >= 0 && ty >= 0 && tx < n && ty < n) {
              // only mark when the road corridor really overlaps this tile
              const cx = Math.max(tx, Math.min(x, tx + 1)), cy = Math.max(ty, Math.min(y, ty + 1));
              if (Math.hypot(cx - x, cy - y) <= hw) this.mask[ty * n + tx] = 1;
            }
      }
    }
  }

  ensureMask() {
    if (!this.maskDirty) return;
    this.mask.fill(0);
    for (const e of this.edges.values()) if (e.structure === 'ground' || e.structure === 'depressed') this.stampMask(e);
    this.maskDirty = false;
  }

  isRoadTile(tx: number, ty: number) {
    this.ensureMask();
    if (tx < 0 || ty < 0 || tx >= this.n || ty >= this.n) return false;
    return this.mask[ty * this.n + tx] === 1;
  }

  // ───────── intersection logic ─────────
  resolveControl(node: RoadNode): 'none' | 'priority' | 'signal' | 'roundabout' {
    if (node.control !== 'auto') return node.control === 'none' && node.edges.length >= 3 ? 'priority' : node.control;
    const deg = node.edges.length;
    if (deg <= 2) return 'none';
    let major = 0, lanes = 0;
    for (const id of node.edges) {
      const e = this.edges.get(id);
      if (!e) continue;
      if (CATEGORY_RANK[e.spec.category] >= 2) major++;
      lanes = Math.max(lanes, Math.max(e.spec.lanesFwd, e.spec.lanesBwd));
    }
    if (major >= 2 || (major >= 1 && lanes >= 3 && deg >= 4)) return 'signal';
    return 'priority';
  }

  junctionKind(node: RoadNode): string {
    const d = node.edges.length;
    const c = this.resolveControl(node);
    if (d <= 1) return 'Dead end';
    if (d === 2) return 'Connection';
    const shape = d === 3 ? 'T-junction' : d === 4 ? 'Four-way' : `${d}-way`;
    return c === 'roundabout' ? `Roundabout (${shape})` : c === 'signal' ? `Signalised ${shape.toLowerCase()}` : `Unsignalised ${shape.toLowerCase()}`;
  }

  totalLength(): number {
    let s = 0;
    for (const e of this.edges.values()) s += e.len;
    return s;
  }
}
