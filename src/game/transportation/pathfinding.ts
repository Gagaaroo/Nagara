import { ID, RoadEdge, TURN_LEFT, TURN_RIGHT, TURN_STRAIGHT, TURN_U } from '../types';
import { RoadNetwork, edgeAllows } from '../roads/network';
import { CATEGORY_RANK, generalLanes } from '../roads/spec';

export type RouteKind = 'car' | 'two' | 'auto' | 'heavy' | 'bus' | 'walk' | 'bike';

export interface Route {
  edges: number[];
  dirs: number[];
  length: number; // tiles
  time: number; // seconds
}

interface Arc { e: RoadEdge; dir: number; to: number }

/** Compact adjacency snapshot of the road network for fast A*. */
export class RoadGraph {
  version = -1;
  ids: ID[] = [];
  index = new Map<ID, number>();
  adj: Arc[][] = [];
  xs = new Float32Array(0);
  ys = new Float32Array(0);
  private g = new Float32Array(0);
  private parent = new Int32Array(0);
  private parentArc = new Array<Arc | null>();
  private stamp = new Uint32Array(0);
  private closed = new Uint8Array(0);
  private run = 0;

  constructor(public net: RoadNetwork) { this.rebuild(); }

  ensure() { if (this.version !== this.net.topoVersion) this.rebuild(); }

  rebuild() {
    const net = this.net;
    this.ids = [...net.nodes.keys()];
    this.index.clear();
    this.ids.forEach((id, i) => this.index.set(id, i));
    const n = this.ids.length;
    this.adj = Array.from({ length: n }, () => []);
    this.xs = new Float32Array(n); this.ys = new Float32Array(n);
    this.ids.forEach((id, i) => { const nd = net.nodes.get(id)!; this.xs[i] = nd.x; this.ys[i] = nd.y; });
    for (const e of net.edges.values()) {
      const a = this.index.get(e.a), b = this.index.get(e.b);
      if (a === undefined || b === undefined) continue;
      this.adj[a].push({ e, dir: 0, to: b });
      this.adj[b].push({ e, dir: 1, to: a });
    }
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.parentArc = new Array(n).fill(null);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint8Array(n);
    this.version = net.topoVersion;
  }
}

/** Time penalty for passing through a node (seconds). */
export function nodeDelay(net: RoadNetwork, nodeId: ID): number {
  const nd = net.nodes.get(nodeId);
  if (!nd) return 0;
  if (nd.delay !== undefined) return nd.delay;
  const c = net.resolveControl(nd);
  return c === 'signal' ? 14 : c === 'roundabout' ? 4 : c === 'priority' ? 4 : 0;
}

function turnType(net: RoadNetwork, node: ID, from: RoadEdge, fromDir: number, to: RoadEdge, toDir: number): number {
  const a1 = (from.heading ?? 0);
  const inAng = fromDir === 0 ? endAngle(from) : startAngle(from) + Math.PI;
  const outAng = toDir === 0 ? startAngle(to) : endAngle(to) + Math.PI;
  let d = outAng - inAng;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  void a1; void node;
  if (Math.abs(d) > 2.6) return TURN_U;
  if (Math.abs(d) < 0.55) return TURN_STRAIGHT;
  // y-down map: positive angle difference is a right turn (clockwise on screen)
  return d > 0 ? TURN_RIGHT : TURN_LEFT;
}
function startAngle(e: RoadEdge) { return Math.atan2(e.pts[3] - e.pts[1], e.pts[2] - e.pts[0]); }
function endAngle(e: RoadEdge) { const n = e.pts.length; return Math.atan2(e.pts[n - 1] - e.pts[n - 3], e.pts[n - 2] - e.pts[n - 4]); }

export function turnAllowed(net: RoadNetwork, nodeId: ID, from: RoadEdge, fromDir: number, to: RoadEdge, toDir: number): boolean {
  const nd = net.nodes.get(nodeId);
  if (!nd) return true;
  const mask = nd.banned[from.id];
  if (!mask) return true;
  return (mask & turnType(net, nodeId, from, fromDir, to, toDir)) === 0;
}

export function edgeCost(e: RoadEdge, dir: number, kind: RouteKind): number {
  if (kind === 'walk' || kind === 'bike') {
    const L = e.len * 50;
    const speed = kind === 'walk' ? 1.35 : 4.2;
    const slope = Math.abs((e.zs[e.zs.length - 1] ?? 0) - (e.zs[0] ?? 0)) / Math.max(1, L);
    return L / (speed * Math.max(0.35, 1 - slope * 3.5));
  }
  if (!edgeAllows(e, dir)) return Infinity;
  const sp = e.spec;
  let t = e.tt![dir] || (e.len * 50) / (sp.speed / 3.6);
  if (sp.bus === 'busonly' && kind !== 'bus') return Infinity;
  if (kind === 'bus') {
    if (sp.bus === 'dedicated' || sp.bus === 'busonly') t = Math.min(t, (e.len * 50) / (sp.speed / 3.6) * 1.1);
    return t;
  }
  if (kind === 'heavy') {
    if (sp.trucks === 'banned') return Infinity;
    const cat = CATEGORY_RANK[sp.category];
    if (sp.trucks === 'priority') t *= 0.75;
    else if (cat === 0 && sp.category !== 'service') t *= 1.9;
    else if (cat === 1) t *= 1.15;
    return t;
  }
  if (kind === 'two' && generalLanes(sp, dir) > 0) t *= 0.92;
  return t;
}

const MAX_SPEED_MS = 120 / 3.6;

/** A* over the road graph. Edge-based turn restrictions are applied from the parent arc. */
export function findRoute(graph: RoadGraph, from: ID, to: ID, kind: RouteKind, banEdge?: Set<ID>): Route | null {
  graph.ensure();
  const si = graph.index.get(from), ti = graph.index.get(to);
  if (si === undefined || ti === undefined) return null;
  if (si === ti) return { edges: [], dirs: [], length: 0, time: 0 };
  const net = graph.net;
  const g = (graph as any).g as Float32Array;
  const parent = (graph as any).parent as Int32Array;
  const parentArc = (graph as any).parentArc as (Arc | null)[];
  const stamp = (graph as any).stamp as Uint32Array;
  const closed = (graph as any).closed as Uint8Array;
  const run = ++(graph as any).run;
  const heap: number[] = [];
  const fScore: number[] = [];
  const push = (n: number, f: number) => {
    heap.push(n); fScore.push(f);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fScore[p] <= fScore[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; [fScore[p], fScore[i]] = [fScore[i], fScore[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const lastN = heap.pop()!, lastF = fScore.pop()!;
    if (heap.length) {
      heap[0] = lastN; fScore[0] = lastF;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && fScore[l] < fScore[m]) m = l;
        if (r < heap.length && fScore[r] < fScore[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; [fScore[m], fScore[i]] = [fScore[i], fScore[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (n: number) => (Math.hypot(graph.xs[n] - graph.xs[ti], graph.ys[n] - graph.ys[ti]) * 50) / (kind === 'walk' ? 1.4 : kind === 'bike' ? 4.3 : MAX_SPEED_MS);
  stamp[si] = run; g[si] = 0; parent[si] = -1; parentArc[si] = null; closed[si] = 0;
  push(si, h(si));
  let guard = 0;
  while (heap.length && guard++ < 60000) {
    const u = pop();
    if (u === ti) break;
    if (closed[u] === 1 && stamp[u] === run) continue;
    closed[u] = 1;
    const pa = parentArc[u];
    const uid = graph.ids[u];
    for (const arc of graph.adj[u]) {
      const v = arc.to;
      if (stamp[v] === run && closed[v] === 1) continue;
      if (banEdge && banEdge.has(arc.e.id)) continue;
      let c = edgeCost(arc.e, arc.dir, kind);
      if (!isFinite(c)) continue;
      if (pa) {
        if (pa.e === arc.e) continue; // no immediate U-turn on same edge
        if (kind !== 'walk' && kind !== 'bike' && !turnAllowed(net, uid, pa.e, pa.dir, arc.e, arc.dir)) continue;
      }
      if (kind !== 'walk' && kind !== 'bike') c += nodeDelay(net, graph.ids[v]);
      const ng = g[u] + c;
      if (stamp[v] !== run || ng < g[v]) {
        stamp[v] = run; g[v] = ng; parent[v] = u; parentArc[v] = arc; closed[v] = 0;
        push(v, ng + h(v));
      }
    }
  }
  if (stamp[ti] !== run || parent[ti] === -1) return null;
  const edges: number[] = [], dirs: number[] = [];
  let length = 0, cur = ti;
  while (cur !== si) {
    const arc = parentArc[cur]!;
    edges.push(arc.e.id); dirs.push(arc.dir);
    length += arc.e.len;
    cur = parent[cur];
  }
  edges.reverse(); dirs.reverse();
  return { edges, dirs, length, time: g[ti] };
}

export function nearestNodeOf(net: RoadNetwork, e: RoadEdge, s: number): ID { return s < e.len / 2 ? e.a : e.b; }
