import { useStore } from '../ui/store';
import { Side } from './Hud';
import { Icon } from './Icon';
import { CrossSection } from './RoadDesigner';
import { CATEGORY_LABEL, LABELS, describeSpec, isOneWay, capacityDir } from '../game/roads/spec';
import { FEATURE_UNLOCK, patchNode, patchRoad, reverseRoad, toggleTurnBan, upgradeRoad, bulldozeAt, demolishRoad } from '../game/actions';
import { DEFS } from '../data/buildings';
import { TURN_LEFT, TURN_RIGHT, TURN_STRAIGHT, TURN_U, WATER_NAMES, Build } from '../game/types';
import { fmtMoney, pct } from '../utils/math';
import { TRANSIT, editLine, removeLine } from '../game/actions-transit';
import { VI, NV } from '../game/roads/network';

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="rowline"><span>{k}</span><span>{v}</span></div>;

function EdgeInspector({ id }: { id: number }) {
  const s = useStore();
  const w = s.world!;
  const e = w.net.edges.get(id);
  if (!e) return null;
  const sp = e.spec, st = e.stat!;
  const vc = Math.max(e.flowVc?.[0] ?? 0, e.flowVc?.[1] ?? 0);
  const vcBar = Math.min(1, vc / 1.4);
  const col = vc < 0.6 ? 'var(--green2)' : vc < 0.95 ? 'var(--amber)' : 'var(--red)';
  const lanesPatch = (f: number, b: number) => { const r = patchRoad(w, id, { lanesFwd: f, lanesBwd: b }); s.flash(r.msg || 'Lanes updated'); };
  return (
    <Side title="Road" onClose={() => s.select(null)}>
      <div className="row space"><div><div className="tag">{CATEGORY_LABEL[sp.category]}</div><b style={{ fontSize: 15 }}>{sp.name}</b></div><span className="chip">{e.structure}</span></div>
      <div style={{ margin: '10px 0' }}><CrossSection spec={sp} height={96} /></div>
      <Row k="Lanes" v={describeSpec(sp)} />
      <Row k="Length" v={`${Math.round(e.len * 50)} m`} />
      <Row k="Capacity (per direction)" v={`${Math.round(capacityDir(sp, 0) * (e.cap! / Math.max(1, capacityDir(sp, 0))))} PCU/h`} />
      <div className="field" style={{ marginTop: 10 }}>
        <label>Volume vs capacity <span className="val">{pct(vc)}</span></label>
        <div className="bar-row" style={{ margin: 0 }}><div className="t"><div className="f" style={{ width: `${vcBar * 100}%`, background: col }} /></div></div>
      </div>
      <Row k="Average speed" v={`${Math.round(Math.min(e.speedNow![0], sp.lanesBwd ? e.speedNow![1] : 1e9))} km/h (limit ${sp.speed})`} />
      <hr />
      <div className="lbl" style={{ marginBottom: 4 }}>Traffic now (per hour)</div>
      <Row k="Cars" v={Math.round(st.car)} /><Row k="Motorcycles & scooters" v={Math.round(st.two)} /><Row k="Auto-rickshaws" v={Math.round(st.auto)} />
      <Row k="Buses" v={`${st.bus.toFixed(1)}/h · ${st.busLines} line${st.busLines === 1 ? '' : 's'}`} />
      <Row k="Freight (trucks)" v={`${st.truck.toFixed(1)}/h`} />
      <Row k="Pedestrians" v={`${Math.round(st.ped)}/h`} />
      <Row k="Cyclists" v={`${Math.round(st.bike)}/h`} />
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Quick edit</div>
      <div className="field"><label>Speed limit <span className="val">{sp.speed} km/h</span></label><input type="range" min={10} max={120} step={5} value={sp.speed} onChange={(ev) => patchRoad(w, id, { speed: +ev.target.value })} /></div>
      <div className="row wrap">
        <button className="btn sm" onClick={() => lanesPatch(Math.min(5, sp.lanesFwd + 1), sp.lanesBwd ? Math.min(5, sp.lanesBwd + 1) : 0)}>+ Lane</button>
        <button className="btn sm" disabled={sp.lanesFwd <= 1} onClick={() => lanesPatch(sp.lanesFwd - 1, sp.lanesBwd ? sp.lanesBwd - 1 : 0)}>− Lane</button>
        {isOneWay(sp) && <button className="btn sm" onClick={() => { const r = reverseRoad(w, id); s.flash(r.msg); }}>Reverse direction</button>}
        <button className="btn sm" onClick={() => { const r = patchRoad(w, id, { lanesBwd: isOneWay(sp) ? sp.lanesFwd : 0 }); s.flash(r.msg || (isOneWay(sp) ? 'Two-way' : 'One-way')); }}>{isOneWay(sp) ? 'Make two-way' : 'Make one-way'}</button>
      </div>
      <div className="field" style={{ marginTop: 10 }}><label>Heavy vehicles</label>
        <div className="seg">{(['allowed', 'banned', 'priority'] as const).map((t) => <button key={t} className={sp.trucks === t ? 'on' : ''} disabled={t === 'priority' && !w.isUnlocked(8000)} onClick={() => patchRoad(w, id, { trucks: t })}>{LABELS[t]}</button>)}</div></div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => { const r = upgradeRoad(w, id, s.roadSpec); s.flash(r.msg); }}>Apply “{s.roadPreset}”</button>
        <button className="btn danger" onClick={() => { const r = demolishRoad(w, id); s.flash(r.msg); s.select(null); s.view?.markRoadsDirty(); }}>Demolish</button>
      </div>
    </Side>
  );
}

function NodeInspector({ id }: { id: number }) {
  const s = useStore();
  const w = s.world!;
  const n = w.net.nodes.get(id);
  if (!n) return null;
  const ctrl = w.net.resolveControl(n);
  const set = (p: Parameters<typeof patchNode>[2]) => { const r = patchNode(w, id, p); if (!r.ok) s.flash(r.msg); else s.emit(); };
  const locked = !w.isUnlocked(FEATURE_UNLOCK.signals);
  const edges = n.edges.map((eid) => w.net.edges.get(eid)!).filter(Boolean);
  return (
    <Side title="Intersection" onClose={() => s.select(null)}>
      <div className="row space"><b style={{ fontSize: 15 }}>{w.net.junctionKind(n)}</b><span className="chip">{edges.length} approaches</span></div>
      <div className="muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>Auto: arterials meeting get signals; smaller roads use priority rules. Change it to see traffic react.</div>
      <div className="field"><label>Traffic control</label>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {([['auto', 'Auto'], ['priority', 'Unsignalised'], ['signal', 'Signals'], ['roundabout', 'Roundabout']] as const).map(([k, l]) => <button key={k} className={n.control === k ? 'on' : ''} disabled={(k === 'signal' || k === 'roundabout') && locked} onClick={() => set({ control: k })}>{l}</button>)}
        </div>
        {locked && <span className="lockline">Signals & roundabouts unlock at {FEATURE_UNLOCK.signals.toLocaleString('en-IN')} citizens</span>}
      </div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <button className={'btn sm' + (n.crossings ? ' on' : '')} onClick={() => set({ crossings: !n.crossings })}>Pedestrian crossings</button>
        <button className={'btn sm' + (n.turnLanes ? ' on' : '')} onClick={() => set({ turnLanes: !n.turnLanes })}>Dedicated turn lanes</button>
        <button className={'btn sm' + (n.busPriority ? ' on' : '')} onClick={() => set({ busPriority: !n.busPriority })}>Bus priority</button>
      </div>
      {ctrl === 'signal' && (<>
        <div className="field"><label>Signal cycle <span className="val">{n.cycle} s</span></label><input type="range" min={40} max={140} step={5} value={n.cycle} onChange={(e) => set({ cycle: +e.target.value })} /></div>
        <div className="field"><label>Green for the major road <span className="val">{Math.round(n.mainShare * 100)}%</span></label><input type="range" min={0.3} max={0.7} step={0.05} value={n.mainShare} onChange={(e) => set({ mainShare: +e.target.value })} /></div>
      </>)}
      <div className="card">
        <Row k="Control" v={ctrl === 'none' ? 'None' : ctrl === 'priority' ? 'Priority to major road' : ctrl[0].toUpperCase() + ctrl.slice(1)} />
        <Row k="Average delay" v={`${(n.delay ?? 0).toFixed(1)} s`} />
        <Row k="Congestion (queue)" v={`${n.queue ?? 0} veh`} />
      </div>
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Turn restrictions {!w.isUnlocked(FEATURE_UNLOCK.turnRestrict) && <span className="lockline">unlocks at {FEATURE_UNLOCK.turnRestrict.toLocaleString('en-IN')}</span>}</div>
      {edges.map((e) => {
        const mask = n.banned[e.id] ?? 0;
        return (
          <div key={e.id} className="row space" style={{ marginBottom: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>From {e.spec.name}</span>
            <div className="seg">
              {([['L', TURN_LEFT], ['S', TURN_STRAIGHT], ['R', TURN_RIGHT], ['U', TURN_U]] as const).map(([l, bit]) => (
                <button key={l} className={(mask & bit) ? 'on' : ''} style={(mask & bit) ? { background: '#5a2e2a', color: '#f4c2bb' } : undefined} title={(mask & bit) ? 'Banned — click to allow' : 'Allowed — click to ban'} onClick={() => { const r = toggleTurnBan(w, id, e.id, bit); if (!r.ok) s.flash(r.msg); else s.emit(); }}>{l}{(mask & bit) ? '✕' : ''}</button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="dim" style={{ fontSize: 11.5 }}>L left · S straight · R right · U U-turn. Vehicles reroute around bans (traffic keeps left).</div>
    </Side>
  );
}

function BuildingInspector({ id }: { id: number }) {
  const s = useStore();
  const w = s.world!;
  const b = w.buildings.get(id);
  if (!b) return null;
  const def = DEFS[b.def];
  return (
    <Side title={b.name} onClose={() => s.select(null)}>
      <p className="muted" style={{ marginTop: 0 }}>{def.desc ?? ''}</p>
      <Row k="Type" v={def.cat} />
      {b.progress < 1 && <Row k="Construction" v={`${Math.round(b.progress * 100)}%`} />}
      <Row k="Floors" v={b.level} />
      {b.residents > 0 && <Row k="Residents" v={b.residents} />}
      {b.jobs > 0 && <Row k="Jobs" v={`${b.workers} / ${b.jobs}`} />}
      <Row k="Power" v={b.powered ? <span className="good">Connected</span> : <span className="bad">No power</span>} />
      <Row k="Water" v={b.watered ? <span className="good">Connected</span> : <span className="bad">No water</span>} />
      <Row k="Road access" v={b.access ? 'Yes' : <span className="bad">None — build a road nearby</span>} />
      {b.abandoned && <div className="bad" style={{ marginTop: 8 }}>Abandoned: restore power and water.</div>}
      <Row k="Land value" v={pct(w.fields.landValue[w.idx(b.x + b.w / 2, b.y + b.h / 2)])} />
      {def.upkeep ? <Row k="Upkeep" v={`${def.upkeep} L / month`} /> : null}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => s.view?.focusOn(b.x + b.w / 2, b.y + b.h / 2, 18)}>Focus</button>
        <button className="btn danger" onClick={() => { const r = bulldozeAt(w, b.x + 0.5, b.y + 0.5); s.flash(r.msg); s.select(null); s.view?.markBuildingsDirty(); }}>Demolish</button>
      </div>
    </Side>
  );
}

function StopInspector({ id }: { id: number }) {
  const s = useStore();
  const w = s.world!;
  const st = w.stops.get(id);
  if (!st) return null;
  const lines = [...w.lines.values()].filter((l) => l.stops.includes(id));
  return (
    <Side title={st.name} onClose={() => s.select(null)}>
      <Row k="Type" v={st.kind === 'bus' ? 'Bus stop' : st.kind[0].toUpperCase() + st.kind.slice(1)} />
      <Row k="Boardings / day" v={Math.round(st.waiting)} />
      <div className="lbl" style={{ margin: '10px 0 4px' }}>Lines serving this stop</div>
      {lines.length === 0 && <div className="muted">None yet. Create a route that uses this stop.</div>}
      <div className="list">{lines.map((l) => <div key={l.id} className="li" onClick={() => s.select({ kind: 'line', id: l.id })}><span className="sw" style={{ background: '#' + l.color.toString(16).padStart(6, '0') }} /><b>{l.name}</b><span className="muted" style={{ marginLeft: 'auto' }}>every {l.headwayMin} min</span></div>)}</div>
      {st.kind === 'bus' && <button className="btn danger" style={{ marginTop: 12 }} onClick={() => { w.removeStop(id); s.select(null); }}>Remove stop</button>}
    </Side>
  );
}

export function LineInspector({ id }: { id: number }) {
  const s = useStore();
  const w = s.world!;
  const l = w.lines.get(id);
  if (!l) return null;
  const spec = TRANSIT[l.mode];
  return (
    <Side title={l.name} onClose={() => s.select(null)}>
      <div className="row space"><span className="chip"><i style={{ width: 9, height: 9, borderRadius: 3, background: '#' + l.color.toString(16).padStart(6, '0') }} />{spec.name}</span><span className={'chip ' + (l.active ? 'good' : 'bad')}>{l.active ? 'Running' : 'Inactive'}</span></div>
      <div className="field" style={{ marginTop: 12 }}><label>Name</label><input type="text" value={l.name} onChange={(e) => { editLine(w, id, { name: e.target.value }); s.emit(); }} /></div>
      <div className="field"><label>Frequency <span className="val">every {l.headwayMin} min · {l.vehicles} vehicles</span></label>
        <input type="range" min={2} max={30} step={1} value={l.headwayMin} onChange={(e) => { const r = editLine(w, id, { headwayMin: +e.target.value }); if (!r.ok) s.flash(r.msg); s.emit(); }} /></div>
      <Row k="Riders / day" v={Math.round(l.ridersToday).toLocaleString('en-IN')} />
      <Row k="Crowding" v={<span className={l.loadFactor > 1 ? 'bad' : l.loadFactor > 0.75 ? 'warn' : 'good'}>{pct(l.loadFactor)}</span>} />
      <Row k="Fare revenue" v={`${l.revenue.toFixed(1)} L / month`} />
      <Row k="Operating cost" v={`${(l.vehicles * spec.opCost).toFixed(1)} L / month`} />
      <Row k="Length" v={`${(l.lengthTiles * 0.05).toFixed(1)} km`} />
      <div className="lbl" style={{ margin: '10px 0 4px' }}>Stops</div>
      <div className="list">{l.stops.map((sid, i) => { const st = w.stops.get(sid); return st ? <div key={sid} className="li" onClick={() => s.view?.focusOn(st.x, st.y, 20)}><span className="muted mono">{i + 1}</span><span>{st.name}</span></div> : null; })}</div>
      {!l.active && <div className="warn" style={{ marginTop: 8 }}>This line has no valid path — a road or stop was removed. Delete and rebuild it.</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className={'btn ' + (l.active ? '' : 'green')} onClick={() => { editLine(w, id, { active: !l.active }); s.emit(); }}>{l.active ? 'Suspend' : 'Resume'}</button>
        <button className="btn danger" onClick={() => { removeLine(w, id); s.select(null); }}>Delete line</button>
      </div>
    </Side>
  );
}

function TileInspector({ x, y }: { x: number; y: number }) {
  const s = useStore();
  const w = s.world!, t = w.terrain, k = w.idx(x, y);
  const h = (t.heights[y * (t.n + 1) + x] + t.heights[y * (t.n + 1) + x + 1] + t.heights[(y + 1) * (t.n + 1) + x] + t.heights[(y + 1) * (t.n + 1) + x + 1]) / 4;
  const reason = t.waterKind[k] ? WATER_NAMES[t.waterKind[k]] : t.protectedLand[k] ? 'Protected land' : t.build[k] === Build.No ? 'Too steep' : t.build[k] === Build.Expensive ? 'Steep — expensive' : t.build[k] === Build.Difficult ? 'Sloping — costly' : 'Flat, buildable';
  const F = w.fields;
  return (
    <Side title={`Tile ${x}, ${y}`} onClose={() => s.select(null)}>
      <Row k="District" v={w.areaName(x, y)} />
      <Row k="Elevation" v={`${h.toFixed(0)} m`} /><Row k="Slope" v={pct(t.slope[k])} /><Row k="Buildability" v={reason} />
      <Row k="Forest cover" v={pct(t.forest[k] / 255)} />
      <hr />
      <Row k="Land value" v={pct(F.landValue[k])} /><Row k="Air pollution" v={pct(F.air[k])} /><Row k="Noise" v={pct(F.noise[k])} />
      <Row k="Public transport" v={pct(F.pt[k])} /><Row k="Walkability" v={pct(F.walk[k])} /><Row k="Cycling" v={pct(F.bike[k])} /><Row k="Last-mile access" v={pct(F.lastMile[k])} />
      <Row k="Power" v={F.power[k] > 0 ? 'Yes' : 'No'} /><Row k="Water" v={F.water[k] > 0 ? 'Yes' : 'No'} />
      <Row k="Flood depth" v={`${(w.floodDepth[k] * 100).toFixed(0)} cm`} />
    </Side>
  );
}

export function Inspector() {
  const s = useStore();
  const sel = s.selection;
  if (!sel) return null;
  if (sel.kind === 'edge') return <EdgeInspector id={sel.id} />;
  if (sel.kind === 'node') return <NodeInspector id={sel.id} />;
  if (sel.kind === 'building') return <BuildingInspector id={sel.id} />;
  if (sel.kind === 'stop') return <StopInspector id={sel.id} />;
  if (sel.kind === 'line') return <LineInspector id={sel.id} />;
  return <TileInspector x={sel.x ?? 0} y={sel.y ?? 0} />;
}
export { fmtMoney, VI, NV };
