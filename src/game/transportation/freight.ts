import type { World } from '../world';
import { Building, ID, VehicleKind } from '../types';
import { findRoute, nearestNodeOf, Route } from './pathfinding';
import { NV, VI } from '../roads/network';
import { DEFS } from '../../data/buildings';

export interface FreightFlow {
  from: ID; to: ID; fromB: Building | null; toB: Building | null; perDay: number; kind: VehicleKind; route: Route | null; heavy: boolean; label: string;
}

const HEAVY = new Set<VehicleKind>(['lorry', 'container', 'tanker', 'construction']);

/** Builds logistics flows: regional entry → industry → warehouses → shops/markets, plus construction supply. */
export class Freight {
  flows: FreightFlow[] = [];
  lastBuild = -999;
  entryNode: ID = 0;
  dailyTrips = 0;
  heavyTrips = 0;
  noWarehouse = false;

  rebuild(world: World) {
    const flows: FreightFlow[] = [];
    const net = world.net;
    const nodeOf = (b: Building): ID => {
      const e = net.edges.get(b.access);
      return e ? nearestNodeOf(net, e, b.accessS) : 0;
    };
    const entry = this.entryNode && net.nodes.has(this.entryNode) ? this.entryNode : nearestEntry(world);
    this.entryNode = entry;
    const inds: Building[] = [], whs: Building[] = [], coms: Building[] = [], sites: Building[] = [];
    for (const b of world.buildings.values()) {
      if (!b.access) continue;
      const def = DEFS[b.def];
      if (b.progress < 1) { sites.push(b); continue; }
      if (b.abandoned) continue;
      if (def.cat === 'ind') inds.push(b);
      else if (def.cat === 'logistics' || b.def === 'warehouse' || b.def === 'truck_terminal') whs.push(b);
      else if (def.cat === 'com' || def.cat === 'market' || def.cat === 'mixed' || def.cat === 'landmark' && def.jobsPerLevel > 60) coms.push(b);
    }
    const near = (b: Building, list: Building[], maxD = 1e9): Building | null => {
      let best: Building | null = null, bd = maxD;
      for (const o of list) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < bd) { bd = d; best = o; } }
      return best;
    };
    this.noWarehouse = whs.length === 0;
    world.traffic_hasNoWarehouse = this.noWarehouse && inds.length > 0 && coms.length > 0;
    const push = (fromB: Building | null, toB: Building | null, perDay: number, kind: VehicleKind, label: string) => {
      const from = fromB ? nodeOf(fromB) : entry, to = toB ? nodeOf(toB) : entry;
      if (!from || !to || from === to || perDay < 0.15) return;
      flows.push({ from, to, fromB, toB, perDay, kind, route: null, heavy: HEAVY.has(kind), label });
    };
    // raw materials into industry
    for (const b of inds) {
      const def = DEFS[b.def];
      const inbound = b.jobs * (def.key === 'factory' ? 0.22 : 0.08);
      push(null, b, inbound * 0.55, 'container', 'Raw material');
      push(null, b, inbound * 0.15, 'tanker', 'Fuel & chemicals');
      push(null, b, inbound * 0.3, 'lorry', 'Raw material');
      // output
      const out = b.jobs * (def.key === 'factory' ? 0.3 : 0.12);
      const wh = near(b, whs);
      if (wh) push(b, wh, out, def.key === 'factory' ? 'lorry' : 'minitruck', 'Goods to warehouse');
      else {
        // no warehouse: factories truck straight into commercial streets
        const targets = coms.slice().sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y)).slice(0, 4);
        for (const t of targets) push(b, t, out / Math.max(1, targets.length), 'lorry', 'Direct deliveries');
      }
    }
    // warehouses → shops, markets
    let whDemand = 0;
    for (const c of coms) {
      const def = DEFS[c.def];
      const market = def.cat === 'market' || def.cat === 'landmark';
      const dem = Math.max(0.5, c.jobs * (market ? 0.16 : 0.09));
      if (whs.length) {
        const wh = near(c, whs);
        if (wh) {
          if (market) push(wh, c, dem * 0.75, 'lorry', 'Market supply');
          push(wh, c, dem * (market ? 0.25 : 0.55), c.jobs > 14 ? 'van' : 'minitruck', 'Last-mile delivery');
          push(wh, c, dem * (market ? 0 : 0.45), 'van', 'Last-mile delivery');
          whDemand += dem;
        }
      } else if (!inds.length) {
        // imports straight from the regional connection
        push(null, c, dem * 0.5, market ? 'lorry' : 'minitruck', 'Imports');
        push(null, c, dem * 0.5, 'van', 'Imports');
      }
    }
    for (const w of whs) {
      const share = whDemand / Math.max(1, whs.length);
      push(null, w, share * 0.5 + 1, 'container', 'Regional inbound');
    }
    // construction supply
    for (const s of sites) {
      const area = s.w * s.h;
      const src = near(s, whs) ?? near(s, inds) ?? null;
      push(src, s, 1.2 + area * 0.5 + s.level * 0.12, 'construction', 'Construction');
    }
    this.flows = flows;
    this.lastBuild = world.day + world.minute / 1440;
    world.freightDirty = false;
  }

  /** Route flows and write smoothed daily truck volumes onto edges. */
  assign(world: World, budget = 400) {
    const acc = new Map<ID, Float32Array>();
    let trips = 0, heavy = 0, n = 0;
    for (const f of this.flows) {
      if (n++ > budget) break;
      const r = findRoute(world.graph, f.from, f.to, 'heavy') ?? findRoute(world.graph, f.from, f.to, 'car');
      f.route = r;
      if (!r) continue;
      trips += f.perDay; if (f.heavy) heavy += f.perDay;
      for (let i = 0; i < r.edges.length; i++) {
        let a = acc.get(r.edges[i]);
        if (!a) acc.set(r.edges[i], (a = new Float32Array(NV * 2)));
        a[r.dirs[i] * NV + VI.truck] += f.perDay;
        a[(1 - r.dirs[i]) * NV + VI.truck] += f.perDay;
      }
    }
    for (const e of world.net.edges.values()) {
      const a = acc.get(e.id);
      for (let d = 0; d < 2; d++) {
        const nv = a ? a[d * NV + VI.truck] : 0;
        e.vol![d * NV + VI.truck] = e.vol![d * NV + VI.truck] * 0.4 + nv * 0.6;
      }
      // road wear grows with heavy daily traffic
      const wear = (e.vol![VI.truck] + e.vol![NV + VI.truck]) / Math.max(1, e.cap! / 4);
      (e as any).wear = Math.min(1, ((e as any).wear ?? 0) * 0.98 + wear * 0.002);
    }
    this.dailyTrips = trips;
    this.heavyTrips = heavy;
    world.stats.freightTrips = trips;
    const pass = world.stats.trips > 0 ? world.stats.trips * ((1 - (world.stats.modal.walk ?? 0)) * 0.9) : 0;
    world.stats.heavyPct = trips + pass > 0 ? heavy / (trips + pass + 1) : 0;
  }
}

function nearestEntry(world: World): ID {
  const t = world.terrain.entry;
  let best: ID = 0, bd = 1e9;
  for (const n of world.net.nodes.values()) {
    const d = Math.hypot(n.x - t.x, n.y - t.y);
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}
