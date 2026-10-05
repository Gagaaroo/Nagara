import { useState } from 'react';
import { useStore } from '../ui/store';
import { Side } from './Hud';
import { Icon } from './Icon';
import { BIKE_W, CATEGORY_HINT, CATEGORY_LABEL, LABELS, LANE_W, MEDIAN_W, OPTIONS, PARK_W, SIDEWALK_W, capacityDir, carriageHalf, costPerTile, finalizeSpec, roadWidth, walkScore, bikeScore, PRESETS, isOneWay } from '../game/roads/spec';
import { specUnlock } from '../game/actions';
import { RoadSpec, StructureMode } from '../game/types';
import { fmtMoney } from '../utils/math';
import { SURFACE_COLOR } from '../rendering/roadView';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Cross-section drawing of a street, to scale. */
export function CrossSection({ spec, height = 110 }: { spec: RoadSpec; height?: number }) {
  const sp = finalizeSpec(spec);
  const half = carriageHalf(sp);
  const mw = sp.lanesFwd && sp.lanesBwd ? MEDIAN_W[sp.median] : 0;
  const sw = SIDEWALK_W[sp.sidewalk], bw = BIKE_W[sp.bike], pw = PARK_W[sp.parking], dw = sp.drain === 'open' ? 0.04 : 0;
  const total = half * 2 + 2 * (sw + bw + pw + dw);
  const S = 300 / Math.max(total, 1.4); // px per tile
  const W = total * S, H = height;
  const cx = W / 2, groundY = H * 0.62, th = 6;
  const rects: React.ReactNode[] = [];
  let k = 0;
  const R = (x: number, w2: number, y: number, h: number, fill: string, title?: string) => rects.push(<rect key={k++} x={x} y={y} width={Math.max(0.5, w2)} height={h} fill={fill}><title>{title}</title></rect>);
  const asphalt = hex(SURFACE_COLOR[sp.surface]);
  const side = (dir: 1 | -1) => {
    let u = half;
    const draw = (width: number, y: number, h: number, fill: string, t: string) => { if (width <= 0) return; const x0 = cx + (dir > 0 ? -(u + width) : u) * S; R(x0, width * S, y, h, fill, t); u += width; };
    draw(pw, groundY - 1, th, '#4a4f54', 'Parking');
    draw(bw, groundY - 2, th, sp.bike === 'painted' ? '#6aa56a' : '#2f8f6a', 'Cycle infrastructure');
    if (sp.bike === 'protected') { /* kerb */ }
    draw(dw, groundY + 2, th - 2, '#2b2e30', 'Drain');
    draw(sw, groundY - 6, th + 6, '#c9c6bc', 'Footpath');
  };
  // carriageway
  R(cx - half * S, half * 2 * S, groundY, th, asphalt, 'Carriageway');
  side(1); side(-1);
  // lanes with direction arrows
  const arrows: React.ReactNode[] = [];
  const laneEls = (n: number, dir: number) => {
    for (let j = 0; j < n; j++) {
      const off = isOneWay(sp) || !sp.lanesFwd ? (n / 2 - 0.5 - j) * LANE_W : mw / 2 + (n - j - 0.5) * LANE_W; // left of travel
      const x = cx + (dir === 0 ? -off : off) * S; // dir0's left side is the viewer's left
      const bus = (sp.bus === 'busonly') || (sp.bus === 'dedicated' && j === 0);
      if (bus) R(x - LANE_W * S / 2, LANE_W * S, groundY - 0.5, th, '#a4503f', 'Bus lane');
      arrows.push(<text key={`${dir}-${j}`} x={x} y={groundY - 9} textAnchor="middle" fontSize="12" fill={bus ? '#f2b24a' : '#e8e6de'}>{dir === 0 ? '▲' : '▼'}</text>);
      if (j > 0) arrows.push(<line key={`l${dir}-${j}`} x1={x + (dir === 0 ? 1 : -1) * LANE_W * S / 2} x2={x + (dir === 0 ? 1 : -1) * LANE_W * S / 2} y1={groundY} y2={groundY + th} stroke="#e8e6de" strokeWidth="1" strokeDasharray="2 2" />);
    }
  };
  if (sp.lanesFwd) laneEls(sp.lanesFwd, 0);
  if (sp.lanesBwd) laneEls(sp.lanesBwd, 1);
  // median
  if (mw > 0) {
    const col = sp.median === 'painted' ? '#d7b543' : sp.median === 'landscaped' ? '#5f9a52' : sp.median === 'barrier' ? '#a7a79f' : '#b9b6ac';
    const h = sp.median === 'painted' ? th : sp.median === 'barrier' ? th + 7 : th + 4;
    R(cx - mw * S / 2, mw * S, groundY + th - h, h, col, 'Median');
    if (sp.median === 'landscaped') arrows.push(<circle key="mt" cx={cx} cy={groundY - 6} r={Math.max(4, mw * S * 0.6)} fill="#4d8a46" />);
  }
  // furniture
  const fx = (dir: number) => cx + dir * (half + sw + bw + pw + dw - 3) * S;
  const furn: React.ReactNode[] = [];
  if (sp.lights) for (const d of [-1, 1]) furn.push(<g key={`L${d}`}><line x1={fx(d)} x2={fx(d)} y1={groundY - 6} y2={groundY - 34} stroke="#8d9296" strokeWidth="2" /><circle cx={fx(d) - d * 5} cy={groundY - 35} r="3" fill="#ffd98a" /></g>);
  if (sp.trees) for (const d of [-1, 1]) furn.push(<g key={`T${d}`}><rect x={fx(d) - 1.5 + d * 10} y={groundY - 18} width="3" height="12" fill="#6a4f38" /><circle cx={fx(d) + d * 10} cy={groundY - 24} r="9" fill="#4f9a4a" /></g>);
  if (sp.benches && sw >= 0.17) for (const d of [-1, 1]) furn.push(<rect key={`B${d}`} x={fx(d) - d * 14 - 5} y={groundY - 12} width="10" height="3" fill="#8b6a45" />);
  if (sp.signs) furn.push(<g key="S"><rect x={fx(1) - 20} y={groundY - 30} width="10" height="7" fill="#2f6fb5" /><line x1={fx(1) - 15} x2={fx(1) - 15} y1={groundY - 23} y2={groundY - 6} stroke="#8d9296" strokeWidth="1.5" /></g>);
  return (
    <div className="xsec">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        <rect x="0" y={groundY + th} width={W} height={H - groundY - th} fill="#2a2e2c" />
        {rects}{arrows}{furn}
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#8f9a94">{(roadWidth(sp) * 50).toFixed(0)} m wide</text>
      </svg>
    </div>
  );
}

function Select<T extends string>({ label, value, options, onChange, lockFn }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void; lockFn?: (v: T) => boolean }) {
  return (
    <div className="field"><label>{label}</label>
      <div className="seg" style={{ flexWrap: 'wrap' }}>{options.map((o) => <button key={o} className={value === o ? 'on' : ''} disabled={lockFn?.(o)} onClick={() => onChange(o)}>{LABELS[o] ?? o}</button>)}</div>
    </div>
  );
}

const STRUCT: { k: StructureMode; l: string }[] = [{ k: 'auto', l: 'Auto' }, { k: 'ground', l: 'Ground' }, { k: 'elevated', l: 'Elevated' }, { k: 'depressed', l: 'Depressed' }, { k: 'bridge', l: 'Bridge' }, { k: 'tunnel', l: 'Tunnel' }];

export function RoadDesigner() {
  const s = useStore();
  const w = s.world!;
  const [name, setName] = useState('My Street');
  const spec = finalizeSpec(s.roadSpec);
  const patch = (p: Partial<RoadSpec>) => s.patchRoad(p);
  const oneWay = isOneWay(spec);
  const unlock = specUnlock(spec);
  const locked = !w.isUnlocked(unlock.pop);
  const cap = capacityDir(spec, 0);
  const d = s.roadDraft;
  const lockOpt = (pop: number) => !w.isUnlocked(pop);
  return (
    <Side title={s.tool === 'upgrade' ? 'Upgrade road' : 'Road designer'} onClose={() => s.setTool('select')} wide>
      <div className="row space" style={{ marginBottom: 8 }}>
        <div><div className="tag">{CATEGORY_LABEL[spec.category]}</div><div style={{ fontSize: 15, fontWeight: 600 }}>{s.roadPreset}</div></div>
        <div style={{ textAlign: 'right' }}><div style={{ color: 'var(--amber)', fontWeight: 600 }}>{fmtMoney(costPerTile(spec) * w.costMultiplier())}<span className="dim"> / tile</span></div><div className="dim" style={{ fontSize: 11 }}>{(costPerTile(spec) * w.costMultiplier() / 50 * 100).toFixed(0)} k₹ per metre</div></div>
      </div>
      <CrossSection spec={spec} />
      <div className="muted" style={{ fontSize: 11.5, margin: '8px 0 12px' }}>{CATEGORY_HINT[spec.category]}</div>

      <div className="tabs"><button className="on">Presets</button></div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        {PRESETS.map((p) => <button key={p.name} className={'btn sm' + (s.roadPreset === p.name ? ' on' : '')} disabled={lockOpt(specUnlock(p).pop)} onClick={() => s.choosePreset(p.name)}>{p.name}</button>)}
        {s.templates.map((t) => <span key={t.name} className="row" style={{ gap: 2 }}><button className={'btn sm' + (s.roadPreset === t.name ? ' on' : '')} onClick={() => s.chooseTemplate(t)}>★ {t.name}</button><button className="btn sm icon ghost" title="Delete template" onClick={() => s.deleteTemplate(t.name)}><Icon n="close" size={12} /></button></span>)}
      </div>

      {s.tool === 'road' && (<>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="seg"><button className={s.roadMode === 'line' ? 'on' : ''} onClick={() => { s.roadMode = 'line'; s.roadDraft = { pts: [], plan: null, pending: false, path: [] }; s.emit(); }}><Icon n="line" size={14} /> Straight</button><button className={s.roadMode === 'curve' ? 'on' : ''} onClick={() => { s.roadMode = 'curve'; s.roadDraft = { pts: [], plan: null, pending: false, path: [] }; s.emit(); }}><Icon n="curve" size={14} /> Curve</button></div>
        </div>
        <div className="field"><label>Terrain handling <span className="val">{s.structure === 'auto' ? 'bridges over water, tunnels through hills' : s.structure}</span></label>
          <div className="seg" style={{ flexWrap: 'wrap' }}>{STRUCT.map((x) => <button key={x.k} className={s.structure === x.k ? 'on' : ''} onClick={() => { s.structure = x.k; s.roadDraft.plan = null; s.emit(); }}>{x.l}</button>)}</div></div>
        <hr />
      </>)}

      <div className="field"><label>Direction & lanes <span className="val">{oneWay ? 'one-way' : 'two-way'}</span></label>
        <div className="seg" style={{ marginBottom: 6 }}>
          <button className={!oneWay ? 'on' : ''} onClick={() => patch({ lanesBwd: Math.max(1, spec.lanesFwd) })}>Two-way</button>
          <button className={oneWay ? 'on' : ''} onClick={() => patch({ lanesBwd: 0 })}>One-way</button>
        </div>
        <div className="row">
          <span className="muted" style={{ width: 92 }}>{oneWay ? 'Lanes' : 'Forward lanes'}</span>
          <div className="seg">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={spec.lanesFwd === n ? 'on' : ''} disabled={n >= 3 && lockOpt(3000)} onClick={() => patch({ lanesFwd: n })}>{n}</button>)}</div>
        </div>
        {!oneWay && <div className="row" style={{ marginTop: 5 }}>
          <span className="muted" style={{ width: 92 }}>Return lanes</span>
          <div className="seg">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={spec.lanesBwd === n ? 'on' : ''} disabled={n >= 3 && lockOpt(3000)} onClick={() => patch({ lanesBwd: n })}>{n}</button>)}</div>
        </div>}
      </div>
      <div className="field"><label>Speed limit <span className="val">{spec.speed} km/h</span></label>
        <input type="range" min={10} max={120} step={5} value={spec.speed} onChange={(e) => patch({ speed: +e.target.value })} />
        {spec.speed >= 80 && lockOpt(10000) && <span className="lockline">Above 70 km/h unlocks at 10,000 citizens</span>}</div>
      <Select label="Median" value={spec.median} options={OPTIONS.median} onChange={(v) => patch({ median: v })} lockFn={(v) => v !== 'none' && v !== 'painted' && lockOpt(800)} />
      <Select label="Footpath" value={spec.sidewalk} options={OPTIONS.sidewalk} onChange={(v) => patch({ sidewalk: v })} />
      <Select label="Bicycle infrastructure" value={spec.bike} options={OPTIONS.bike as readonly RoadSpec['bike'][]} onChange={(v) => patch({ bike: v })} lockFn={(v) => (v === 'protected' || v === 'track') && lockOpt(1200)} />
      <Select label="Parking" value={spec.parking} options={OPTIONS.parking} onChange={(v) => patch({ parking: v })} />
      <Select label="Bus infrastructure" value={spec.bus} options={OPTIONS.bus} onChange={(v) => patch({ bus: v })} lockFn={(v) => (v === 'dedicated' || v === 'busonly') && lockOpt(2000)} />
      <div className="field"><label>Street furniture</label>
        <div className="row wrap">
          {([['lights', 'Streetlights'], ['trees', 'Trees'], ['benches', 'Benches'], ['signs', 'Signage']] as const).map(([k, l]) => <button key={k} className={'btn sm' + (spec[k] ? ' on' : '')} onClick={() => patch({ [k]: !spec[k] } as Partial<RoadSpec>)}>{l}</button>)}
        </div></div>
      <Select label="Surface" value={spec.surface} options={OPTIONS.surface} onChange={(v) => patch({ surface: v })} />
      <Select label="Drainage" value={spec.drain} options={OPTIONS.drain} onChange={(v) => patch({ drain: v })} lockFn={(v) => v === 'storm' && lockOpt(5000)} />
      <Select label="Heavy vehicles" value={spec.trucks} options={OPTIONS.trucks} onChange={(v) => patch({ trucks: v })} lockFn={(v) => v === 'priority' && lockOpt(8000)} />

      <div className="card" style={{ marginTop: 6 }}>
        <div className="rowline"><span>Capacity</span><span>{Math.round(cap)} PCU/h per direction</span></div>
        <div className="rowline"><span>Walking quality</span><span>{Math.round(walkScore(spec) * 100)}%</span></div>
        <div className="rowline"><span>Cycling quality</span><span>{Math.round(bikeScore(spec) * 100)}%</span></div>
        <div className="rowline"><span>Width</span><span>{(roadWidth(spec) * 50).toFixed(0)} m</span></div>
      </div>
      {locked && <div className="lockline" style={{ marginTop: 8 }}>Locked until {unlock.pop.toLocaleString('en-IN')} citizens ({unlock.why})</div>}

      <hr />
      <div className="field"><label>Save as template</label>
        <div className="row"><input type="text" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" onClick={() => { s.saveTemplate(name.trim() || 'My Street'); s.flash('Template saved'); }}>Save</button></div>
        <span className="dim" style={{ fontSize: 11.5 }}>Example: Urban Avenue — 2 lanes each way, median, wide footpaths, protected cycle lanes, bus lanes, streetlights.</span></div>
      {s.tool === 'road' && d.plan && !d.pending && (
        <div className="card" style={{ marginTop: 6 }}>
          <b style={{ color: 'var(--amber)' }}>{fmtMoney(d.plan.cost)}</b> <span className="dim">· {(d.plan.length * 50).toFixed(0)} m</span>
          {d.plan.issues.map((x) => <div key={x} className="bad" style={{ fontSize: 12 }}>⚠ {x}</div>)}
          {d.plan.warnings.map((x) => <div key={x} className="warn" style={{ fontSize: 12 }}>{x}</div>)}
        </div>
      )}
    </Side>
  );
}
