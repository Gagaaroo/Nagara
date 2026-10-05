import type { Store } from '../ui/store';
import type { GameView } from './gameView';
import { RoadEdge, Zone, TransitStop } from '../game/types';
import { buildRoad, bulldozeAt, buildingIssue, placeBuilding, placeBusStop, previewRoad, upgradeRoad, zoneRect, zoneUnlock } from '../game/actions';
import { quadBezier, lineSamples } from '../game/roads/geometry';
import { DEFS, ZONE_INFO } from '../data/buildings';
import { addBusStop } from '../game/transportation/transit';
import { Build } from '../game/types';

export interface Pick { x: number; y: number; h: number }

/** Turns pointer gestures into game commands for the active tool. */
export class ToolController {
  zoneStart: { x: number; y: number } | null = null;
  lastMoveKey = '';
  constructor(private view: GameView, private store: Store) {}

  private get w() { return this.store.world!; }

  /** Snap a cursor position to nearby nodes or road centrelines. */
  snap(p: Pick, shift = false): [number, number] {
    const w = this.w;
    const nd = w.net.nearestNode(p.x, p.y, 0.9);
    if (nd) return [nd.x, nd.y];
    const ne = w.net.nearestEdge(p.x, p.y, 0.6, (e) => e.structure === 'ground' || e.structure === 'depressed');
    if (ne && ne.s > 0.25 && ne.s < ne.e.len - 0.25) return [ne.x, ne.y];
    let x = p.x, y = p.y;
    const pts = this.store.roadDraft.pts;
    if (shift && pts.length) {
      const [sx, sy] = pts[pts.length - 1];
      const ang = Math.atan2(y - sy, x - sx), L = Math.hypot(x - sx, y - sy);
      const q = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      x = sx + Math.cos(q) * L; y = sy + Math.sin(q) * L;
    }
    return [x, y];
  }

  // ───────── roads ─────────
  private roadPath(cursor: [number, number]): number[] {
    const { pts } = this.store.roadDraft;
    if (pts.length === 0) return [];
    if (this.store.roadMode === 'curve' && pts.length === 2) return quadBezier(pts[0], pts[1], cursor);
    const start = pts[pts.length - 1];
    return lineSamples(start, cursor);
  }

  private replan(cursor: [number, number]) {
    const s = this.store, d = s.roadDraft;
    if (d.pts.length === 0) { this.view.preview.clear(); return; }
    if (s.roadMode === 'curve' && d.pts.length === 1) {
      // before choosing the bend, show the straight guide
      const path = lineSamples(d.pts[0], cursor);
      const plan = previewRoad(this.w, path, s.roadSpec, s.structure);
      d.path = path; d.plan = plan;
      this.view.preview.road(plan, Math.max(0.25, plan.pieces.length ? (this.view.roadWidthOf(s.roadSpec)) : 0.3), plan.valid);
      return;
    }
    const path = this.roadPath(cursor);
    if (path.length < 4) return;
    const plan = previewRoad(this.w, path, s.roadSpec, s.structure);
    d.path = path; d.plan = plan;
    this.view.preview.road(plan, this.view.roadWidthOf(s.roadSpec), plan.valid && plan.cost <= this.w.money);
  }

  private commitPending() {
    const s = this.store, d = s.roadDraft;
    if (!d.plan) return;
    const r = buildRoad(this.w, d.plan, s.roadSpec);
    if (!r.ok) { s.flash(r.msg); return; }
    const end: [number, number] = [d.path[d.path.length - 2], d.path[d.path.length - 1]];
    s.roadDraft = { pts: [end], plan: null, pending: false, path: [] };
    this.view.preview.clear();
    this.view.markRoadsDirty();
    s.emit();
  }

  confirm() {
    const s = this.store;
    if (s.tool === 'road' && s.roadDraft.pending) this.commitPending();
    else if (s.tool === 'building' && this.view.lastPick) this.click(this.view.lastPick, false);
  }

  cancel() {
    const s = this.store;
    if (s.tool === 'select' && s.dock !== 'none') { s.dock = 'none'; s.emit(); return; }
    if (s.tool === 'select' && !s.selection && s.panel !== 'none') { s.panel = 'none'; s.emit(); return; }
    if (s.tool === 'road') {
      if (s.roadDraft.pending) { s.roadDraft.pending = false; s.emit(); return; }
      if (s.roadDraft.pts.length > 0) { s.roadDraft = { pts: [], plan: null, pending: false, path: [] }; this.view.preview.clear(); s.emit(); return; }
    }
    if (s.tool === 'linepick' && s.transitDraft) { s.cancelTransit(); return; }
    if (s.tool !== 'select') { s.setTool('select'); this.view.preview.clear(); return; }
    if (s.selection) s.select(null);
  }

  // ───────── pointer events ─────────
  move(p: Pick | null, shift: boolean) {
    const s = this.store;
    this.view.lastPick = p;
    if (!p) return;
    const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${s.tool},${s.roadDraft.pts.length},${s.buildRot},${s.buildKey}`;
    if (key === this.lastMoveKey) return;
    this.lastMoveKey = key;
    switch (s.tool) {
      case 'road': {
        if (s.roadDraft.pending) return;
        const c = this.snap(p, shift);
        if (s.roadDraft.pts.length) this.replan(c);
        else this.view.preview.marker(c[0], c[1], 0x9bd0ff);
        break;
      }
      case 'building': {
        if (!s.buildKey) break;
        const def = DEFS[s.buildKey];
        const w = s.buildRot % 2 ? def.h : def.w, h = s.buildRot % 2 ? def.w : def.h;
        const x = Math.floor(p.x - w / 2 + 0.5), y = Math.floor(p.y - h / 2 + 0.5);
        const issue = buildingIssue(this.w, s.buildKey, x, y, s.buildRot);
        if (issue !== s.buildIssue) { s.buildIssue = issue; s.emit(); }
        this.view.preview.building(s.buildKey, x, y, s.buildRot, !issue);
        break;
      }
      case 'zone': {
        if (this.zoneStart) {
          const x0 = this.zoneStart.x, y0 = this.zoneStart.y, x1 = Math.floor(p.x), y1 = Math.floor(p.y);
          this.paintPreview(x0, y0, x1, y1);
        } else this.paintPreview(Math.floor(p.x), Math.floor(p.y), Math.floor(p.x), Math.floor(p.y));
        break;
      }
      case 'busstop': case 'linepick': {
        const ne = this.w.net.nearestEdge(p.x, p.y, 1.1, (e) => e.structure !== 'tunnel' && e.spec.category !== 'highway');
        const st = this.nearStop(p.x, p.y, s.tool === 'linepick' && s.transitDraft?.family !== 'bus' ? 'station' : 'any');
        if (st) this.view.preview.marker(st.x, st.y, 0xffffff);
        else if (ne && (s.tool === 'busstop' || s.transitDraft?.family === 'bus')) this.view.preview.marker(ne.x, ne.y, 0xf2b24a);
        else this.view.preview.clear();
        break;
      }
      case 'bulldoze': this.view.setHoverPick(p, 'bulldoze'); this.view.preview.clear(); break;
      case 'upgrade': case 'select': this.view.setHoverPick(p, s.tool); this.view.preview.clear(); break;
    }
  }

  private paintPreview(x0: number, y0: number, x1: number, y1: number) {
    const s = this.store, w = this.w;
    const ax = Math.min(x0, x1), ay = Math.min(y0, y1), bx = Math.max(x0, x1), by = Math.max(y0, y1);
    if ((bx - ax + 1) * (by - ay + 1) > 2500) return;
    const valid: boolean[][] = [];
    for (let y = ay; y <= by; y++) { const row: boolean[] = []; for (let x = ax; x <= bx; x++) row.push(s.zone === Zone.None ? true : w.tileFree(x, y)); valid.push(row); }
    const color = s.zone === Zone.None ? 0xcccccc : ZONE_INFO[s.zone]?.color ?? 0x88aa88;
    this.view.preview.rect(ax, ay, bx, by, color, valid);
  }

  private nearStop(x: number, y: number, kind: 'any' | 'station'): TransitStop | null {
    let best: TransitStop | null = null, bd = 1.1;
    for (const st of this.w.stops.values()) {
      if (kind === 'station' && st.kind === 'bus') continue;
      const d = Math.hypot(st.x - x, st.y - y);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  down(p: Pick | null) {
    const s = this.store;
    if (!p) return;
    if (s.tool === 'zone') { this.zoneStart = { x: Math.floor(p.x), y: Math.floor(p.y) }; this.paintPreview(this.zoneStart.x, this.zoneStart.y, this.zoneStart.x, this.zoneStart.y); }
  }

  up(p: Pick | null) {
    const s = this.store;
    if (s.tool === 'zone' && this.zoneStart && p) {
      const r = zoneRect(this.w, this.zoneStart.x, this.zoneStart.y, Math.floor(p.x), Math.floor(p.y), s.zone);
      s.flash(r.msg);
      this.zoneStart = null;
      this.view.preview.clear();
      this.view.markZonesDirty();
    }
    this.zoneStart = null;
  }

  click(p: Pick | null, shift: boolean) {
    const s = this.store, w = this.w;
    if (!p) return;
    switch (s.tool) {
      case 'select': this.selectAt(p); break;
      case 'bulldoze': { const r = bulldozeAt(w, p.x, p.y); s.flash(r.msg); this.view.markRoadsDirty(); break; }
      case 'upgrade': {
        const ne = w.net.nearestEdge(p.x, p.y, 0.7);
        if (!ne) { s.flash('Click a road to upgrade'); break; }
        const r = upgradeRoad(w, ne.e.id, s.roadSpec);
        s.flash(r.msg || (r.ok ? 'Upgraded' : 'Cannot upgrade'));
        break;
      }
      case 'road': {
        const c = this.snap(p, shift);
        const d = s.roadDraft;
        if (d.pending) { this.replan(c); s.emit(); return; }
        if (d.pts.length === 0) { d.pts = [c]; s.emit(); return; }
        if (s.roadMode === 'curve' && d.pts.length === 1) { d.pts = [d.pts[0], c]; s.emit(); return; }
        this.replan(c);
        if (!d.plan) return;
        if (s.settings.confirmRoads) { d.pending = true; s.emit(); }
        else this.commitPending();
        break;
      }
      case 'building': {
        if (!s.buildKey) break;
        const def = DEFS[s.buildKey];
        const ww = s.buildRot % 2 ? def.h : def.w, hh = s.buildRot % 2 ? def.w : def.h;
        const x = Math.floor(p.x - ww / 2 + 0.5), y = Math.floor(p.y - hh / 2 + 0.5);
        const r = placeBuilding(w, s.buildKey, x, y, s.buildRot, s.stationAlign);
        s.flash(r.msg || (r.ok ? 'Placed' : 'Cannot place'));
        if (r.ok) { this.view.markBuildingsDirty(); this.lastMoveKey = ''; }
        break;
      }
      case 'busstop': {
        const r = placeBusStop(w, p.x, p.y, true);
        s.flash(r.msg);
        break;
      }
      case 'linepick': this.pickForLine(p); break;
      case 'zone': break;
    }
  }

  private pickForLine(p: Pick) {
    const s = this.store, d = s.transitDraft;
    if (!d) return;
    const w = this.w;
    let st = this.nearStop(p.x, p.y, d.family === 'bus' ? 'any' : 'station');
    if (st && d.family === 'bus' && st.kind !== 'bus' && st.kind !== 'terminal') st = null;
    if (!st && d.family === 'bus') {
      const ne = w.net.nearestEdge(p.x, p.y, 1.1, (e) => e.structure !== 'tunnel' && e.spec.category !== 'highway');
      if (ne) {
        const r = addBusStop(w, ne.e.id, ne.s, true);
        if (typeof r === 'string') { s.flash(r); return; }
        st = r;
      }
    }
    if (!st) { s.flash(d.family === 'bus' ? 'Click a road to add a stop' : 'Click a station'); return; }
    // toggle
    const i = d.stops.indexOf(st.id);
    if (i >= 0 && i === d.stops.length - 1) d.stops.pop();
    else if (i < 0) d.stops.push(st.id);
    else { s.flash('That stop is already on the route'); return; }
    d.segAlign = d.stops.slice(1).map((_, k) => d.segAlign[k] ?? d.defaultAlign);
    d.step = d.stops.length >= 2 ? 4 : 3;
    s.refreshDraft();
    s.emit();
  }

  private selectAt(p: Pick) {
    const s = this.store, w = this.w;
    const hit = this.view.hitTest(p);
    if (hit) s.select(hit);
    else s.select({ kind: 'tile', id: 0, x: Math.floor(p.x), y: Math.floor(p.y) });
    void w;
  }
}

export { Build, zoneUnlock };
export type { RoadEdge };
