import { useStore } from '../ui/store';
import { Side } from './Hud';
import { TRANSIT, LINE_COLORS, TransitStopLabel } from './transitUi';
import { makeLine, FEATURE_UNLOCK, railCostPreview } from '../game/actions';
import { Alignment, TransitMode } from '../game/types';
import { fmtMoney } from '../utils/math';
import { DEFS } from '../data/buildings';
import { setLineFrequency } from '../game/transportation/transit';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Seven-step route creation: vehicle → depot → stops → route → name → frequency → activate. */
export function TransitWizard() {
  const s = useStore();
  const w = s.world!;
  const d = s.transitDraft!;
  const bus = d.family === 'bus';
  const depotKey = bus ? 'bus_depot' : d.family === 'metro' ? 'metro_depot' : 'rail_yard';
  const depots = [...w.buildings.values()].filter((b) => b.def === depotKey && b.progress >= 0);
  const modes: TransitMode[] = bus ? ['bus', 'ebus', 'artibus', 'minibus'] : d.family === 'metro' ? ['metro'] : ['suburban', 'regional'];
  const pv = s.draftPreview;
  const line = pv.line;
  const spec = TRANSIT[d.mode];
  const stepNames = bus ? ['Vehicle', 'Depot', 'Stops', 'Route', 'Name', 'Frequency', 'Activate'] : ['Mode', 'Depot', 'Stations', 'Track', 'Name', 'Trains', 'Activate'];
  const unlock = (m: TransitMode) => m === 'ebus' ? FEATURE_UNLOCK.ebus : m === 'artibus' ? FEATURE_UNLOCK.articulated : m === 'metro' ? FEATURE_UNLOCK.metro : m === 'suburban' ? FEATURE_UNLOCK.suburban : m === 'regional' ? FEATURE_UNLOCK.regional : 0;
  const upd = (p: Partial<typeof d>) => { Object.assign(d, p); s.refreshDraft(); s.emit(); };
  const cost = line ? pv.cost : 0;
  const vehicles = line ? line.vehicles : 0;
  const cycleMin = line?.rt ? line.rt.cycleSec / 60 : 0;
  const canActivate = !!line && !!d.depot && w.money >= cost;
  const stationsExist = [...w.stops.values()].filter((x) => x.kind !== 'bus' && x.kind !== 'terminal').length;
  const activate = () => {
    const r = makeLine(w, { name: d.name, mode: d.mode, stops: d.stops, headwayMin: d.headwayMin, color: d.color, depot: d.depot, segAlign: d.segAlign, alignment: d.defaultAlign });
    s.flash(r.msg);
    if (r.ok) { s.transitDraft = null; s.draftPreview = { line: null, err: '', cost: 0 }; s.tool = 'select'; if (r.id) s.select({ kind: 'line', id: r.id }); s.emit(); }
  };
  const row = (n: number, title: string, body: React.ReactNode) => (
    <div className="card" style={{ marginBottom: 8, opacity: d.step >= n ? 1 : 0.6 }}>
      <div className="row" style={{ marginBottom: 6 }}><span className="chip" style={{ background: d.step > n ? 'var(--green)' : d.step === n ? 'var(--amber)' : undefined, color: d.step >= n ? '#16130a' : undefined }}>{n}</span><b>{title}</b></div>
      {body}
    </div>
  );
  return (
    <Side title={bus ? 'New bus route' : d.family === 'metro' ? 'New metro line' : 'New rail line'} onClose={() => s.cancelTransit()} wide>
      <div className="steps">{stepNames.map((_, i) => <i key={i} className={d.step === i + 1 ? 'on' : d.step > i + 1 ? 'done' : ''} />)}</div>
      {row(1, bus ? '1 · Select vehicle' : '1 · Select mode',
        <div className="seg" style={{ flexWrap: 'wrap' }}>{modes.map((m) => <button key={m} className={d.mode === m ? 'on' : ''} disabled={!w.isUnlocked(unlock(m))} onClick={() => upd({ mode: m })}>{TRANSIT[m].name}</button>)}</div>)}
      <div className="dim" style={{ fontSize: 11.5, margin: '-2px 0 8px 4px' }}>{spec.name}: {spec.capacity} passengers · {spec.speedKph} km/h · {fmtMoney(spec.vehicleCost)} each · {spec.opCost} L/month</div>
      {row(2, '2 · Select depot', depots.length ? (
        <select value={d.depot} onChange={(e) => upd({ depot: +e.target.value, step: Math.max(d.step, 3) })}>{!d.depot && <option value={0}>Choose a depot…</option>}{depots.map((b) => <option key={b.id} value={b.id}>{DEFS[b.def].name} — {w.areaName(b.x, b.y)}</option>)}</select>
      ) : <div><div className="warn">No {DEFS[depotKey].name.toLowerCase()} yet.</div><button className="btn sm" style={{ marginTop: 6 }} onClick={() => { s.transitDraft = null; s.chooseBuilding(depotKey); }}>Place a {DEFS[depotKey].name.toLowerCase()}</button></div>)}
      {row(3, bus ? '3 · Click stops on the map' : '3 · Click stations on the map',
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{bus ? 'Click roads to add stops in order (existing stops can be reused). Click the last stop again to undo it.' : stationsExist ? 'Click stations in the order trains should call.' : 'Place stations first (Transport → station), then click them here.'}</div>
          {!bus && <button className="btn sm" style={{ marginBottom: 6 }} onClick={() => { const key = d.family === 'metro' ? 'station_metro' : d.mode === 'regional' ? 'station_regional' : 'station_suburban'; s.chooseBuilding(key); }}>+ Place a station</button>}
          <div className="list">{d.stops.map((id, i) => <div key={id} className="li"><span className="muted mono">{i + 1}</span><TransitStopLabel id={id} /></div>)}</div>
        </div>)}
      {!bus && d.stops.length >= 2 && row(4, '4 · Draw track — choose each section', (
        <div>{d.stops.slice(1).map((_, i) => (
          <div className="row space" key={i} style={{ marginBottom: 5 }}><span className="muted" style={{ fontSize: 12 }}>Section {i + 1}</span>
            <div className="seg">{(['elevated', 'surface', 'underground'] as Alignment[]).map((a) => <button key={a} className={(d.segAlign[i] ?? d.defaultAlign) === a ? 'on' : ''} onClick={() => { const sa = d.stops.slice(1).map((_, k) => d.segAlign[k] ?? d.defaultAlign); sa[i] = a; upd({ segAlign: sa }); }}>{a === 'surface' ? 'At grade' : a[0].toUpperCase() + a.slice(1)}</button>)}</div></div>
        ))}
          <div className="row"><span className="muted" style={{ fontSize: 12 }}>All sections</span>
            <div className="seg">{(['elevated', 'surface', 'underground'] as Alignment[]).map((a) => <button key={a} onClick={() => upd({ defaultAlign: a, segAlign: d.stops.slice(1).map(() => a) })}>{a === 'surface' ? 'At grade' : a[0].toUpperCase() + a.slice(1)}</button>)}</div></div>
        </div>))}
      {bus && row(4, '4 · Route', line ? (
        <div><div className="good" style={{ marginBottom: 4 }}>Route found along {d.stops.length} stops</div>
          <div className="rowline"><span>Length</span><span>{(line.lengthTiles * 0.05).toFixed(1)} km one way</span></div>
          <div className="rowline"><span>Round trip</span><span>{cycleMin.toFixed(0)} min</span></div></div>
      ) : <div className="muted">{pv.err || 'Pick at least two stops.'}</div>)}
      {!bus && line && <div className="card" style={{ marginBottom: 8 }}><div className="rowline"><span>Length</span><span>{(line.lengthTiles * 0.05).toFixed(1)} km</span></div><div className="rowline"><span>Round trip</span><span>{cycleMin.toFixed(0)} min</span></div></div>}
      {!bus && pv.err && d.stops.length >= 2 && <div className="bad">{pv.err}</div>}
      {row(5, '5 · Name & colour', (
        <div className="row"><input type="text" value={d.name} onChange={(e) => { d.name = e.target.value; s.emit(); }} />
          <div className="row" style={{ gap: 3 }}>{LINE_COLORS.map((c) => <button key={c} title="Route colour" onClick={() => upd({ color: c })} style={{ width: 18, height: 18, borderRadius: 5, border: d.color === c ? '2px solid #fff' : '1px solid #0006', background: hex(c), padding: 0 }} />)}</div></div>))}
      {row(6, bus ? '6 · Frequency' : '6 · Assign trains · frequency', (
        <div><div className="field" style={{ marginBottom: 6 }}><label>Service every <span className="val">{d.headwayMin} min</span></label>
          <input type="range" min={2} max={30} step={1} value={d.headwayMin} onChange={(e) => { d.headwayMin = +e.target.value; s.refreshDraft(); s.emit(); }} /></div>
          <div className="rowline"><span>Vehicles needed</span><span>{vehicles || '—'}</span></div>
          <div className="rowline"><span>Operating cost</span><span>{line ? (vehicles * spec.opCost).toFixed(1) : '—'} L / month</span></div></div>))}
      {row(7, '7 · Activate', (
        <div><div className="row space" style={{ marginBottom: 8 }}><span className="muted">Build cost</span><b style={{ color: 'var(--amber)', fontSize: 17 }}>{line ? fmtMoney(cost) : '—'}</b></div>
          {!d.depot && <div className="warn" style={{ fontSize: 12, marginBottom: 6 }}>Choose a depot to supply vehicles.</div>}
          {line && w.money < cost && <div className="bad" style={{ fontSize: 12, marginBottom: 6 }}>Not enough funds</div>}
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!canActivate} onClick={activate}>Activate line ✓</button></div>))}
      <div className="dim" style={{ fontSize: 11.5 }}>Tip: connect lines at shared stops to create interchanges. Feeder autos, footpaths and bus stops raise ridership (last-mile).</div>
    </Side>
  );
}
export { setLineFrequency, railCostPreview };
