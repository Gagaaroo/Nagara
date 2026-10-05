import { useMemo, useState } from 'react';
import { useStore } from '../ui/store';
import { Side } from './Hud';
import { Icon } from './Icon';
import { fmtMoney, fmtNum, pct, clamp } from '../utils/math';
import { TRANSIT } from '../game/transportation/transit';
import { DEFS } from '../data/buildings';
import { MILESTONES } from '../game/simulation/engine';
import { FEATURE_UNLOCK } from '../game/actions';
import { VI } from '../game/roads/network';
import { CATEGORY_RANK } from '../game/roads/spec';
import { World } from '../game/world';

export const MODE_COLORS: Record<string, string> = { walk: '#6fb37b', cycle: '#9bd36a', two: '#e0a63a', car: '#d9564a', auto: '#f2d04a', bus: '#e8743b', metro: '#3e8fd4', rail: '#8b6fcf' };
export const MODE_NAMES: Record<string, string> = { walk: 'Walking', cycle: 'Cycling', two: 'Motorcycle / scooter', car: 'Car', auto: 'Auto-rickshaw', bus: 'Bus', metro: 'Metro', rail: 'Rail' };

function Spark({ data, color = '#f2b24a', h = 34, fill = true }: { data: number[]; color?: string; h?: number; fill?: boolean }) {
  if (data.length < 2) return <div className="dim" style={{ fontSize: 11 }}>Collecting data…</div>;
  const mx = Math.max(...data), mn = Math.min(...data);
  const W = 240;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${h - 3 - ((v - mn) / Math.max(1e-6, mx - mn)) * (h - 8)}`);
  return (
    <svg viewBox={`0 0 ${W} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      {fill && <polygon points={`0,${h} ${pts.join(' ')} ${W},${h}`} fill={color} opacity="0.14" />}
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function Bar({ name, value, color, suffix }: { name: string; value: number; color: string; suffix?: string }) {
  return <div className="bar-row"><div className="n">{name}</div><div className="t"><div className="f" style={{ width: `${clamp(value, 0, 1) * 100}%`, background: color }} /></div><div className="p">{suffix ?? pct(value)}</div></div>;
}

function Kpi({ k, v, s, tone }: { k: string; v: string; s?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return <div className="card"><div className="k">{k}</div><div className={'v ' + (tone ?? '')}>{v}</div>{s && <div className="s">{s}</div>}</div>;
}

/** Plain-language planning advice derived from real simulation state. */
function insights(w: World): string[] {
  const st = w.stats, out: string[] = [];
  if (st.unreachable > 5) out.push('Some people cannot reach their destination — check broken connections and one-way streets.');
  if (st.unserved > 20) out.push('Buildings are missing power or water. Extend substations, towers or add a source.');
  if (st.population > 600 && st.walkAccess < 0.35) out.push('Walking is held back: many streets have no footpaths. Add sidewalks to local streets.');
  if (st.congestion > 0.25) {
    let worst: { n: string; v: number } | null = null;
    for (const e of w.net.edges.values()) { const v = Math.max(e.flowVc?.[0] ?? 0, e.flowVc?.[1] ?? 0); if (!worst || v > worst.v) worst = { n: e.spec.name, v }; }
    if (worst && worst.v > 0.9) out.push(`${worst.n} is over capacity. Add lanes, a parallel route, a bus lane, or move trips onto transit.`);
  }
  if (st.heavyPct > 0.1) out.push('Heavy vehicles are a big share of traffic. Build a freight corridor and ban trucks on local streets.');
  if (w.traffic_hasNoWarehouse) out.push('Factories deliver straight into shopping streets. A warehouse nearby lets small vans handle the last mile.');
  if (st.population > 2500 && st.ptCoverage < 0.3) out.push('Few residents live near a stop. Create bus routes through dense neighbourhoods.');
  for (const l of w.lines.values()) {
    if (l.active && l.mode === 'metro' && l.ridersToday < 400) out.push(`${l.name}: metro without feeders. Add buses, auto stands and footpaths around stations.`);
    if (l.active && l.loadFactor > 1) out.push(`${l.name} is overcrowded — increase frequency.`);
    if (l.active && l.mode !== 'metro' && l.ridersToday < 25 && w.day > 12) out.push(`${l.name} has very low ridership. Pass more homes, jobs and schools.`);
  }
  if (st.lastMile < 0.3 && w.stops.size > 3) out.push('Last-mile access is weak: add auto stands, cycle lanes and footpaths near stops.');
  let tooMany = 0;
  for (const e of w.net.edges.values()) if (CATEGORY_RANK[e.spec.category] >= 2 && e.len < 2 && e.spec.category !== 'highway') tooMany++;
  if (tooMany > 3) out.push('Arterials have many closely-spaced junctions, which cuts their capacity.');
  if (st.sprawl > 0.55) out.push('The city is sprawling: longer commutes, more road upkeep, more car dependence.');
  if (!out.length) out.push('Nothing urgent. Grow where roads, jobs and transit meet.');
  return out.slice(0, 5);
}

export function MobilityPanel() {
  const s = useStore();
  const w = s.world!, st = w.stats;
  const [adv, setAdv] = useState(false);
  const modes = ['car', 'two', 'auto', 'bus', 'metro', 'rail', 'walk', 'cycle'];
  const bott = useMemo(() => {
    const arr = [...w.net.edges.values()].map((e) => ({ e, v: Math.max(e.flowVc?.[0] ?? 0, e.flowVc?.[1] ?? 0) })).filter((x) => x.v > 0.5).sort((a, b) => b.v - a.v).slice(0, 6);
    return arr;
  }, [s.version]);
  const hist = w.history.slice(-60);
  const cong = Math.round(Math.min(1, st.congestion * 1.4) * 100);
  const tip = insights(w);
  // visible traffic share
  const tr = s.sim!.traffic;
  return (
    <Side title="Transportation" onClose={() => s.setPanel('mobility')} wide>
      <div className="lbl" style={{ marginBottom: 6 }}>Modal split — daily trips</div>
      <div className="stack">{modes.map((m) => <div key={m} style={{ width: `${(st.modal[m] ?? 0) * 100}%`, background: MODE_COLORS[m] }} title={`${MODE_NAMES[m]} ${pct(st.modal[m] ?? 0)}`} />)}</div>
      <div className="legend-dots">{modes.map((m) => <span key={m}><i style={{ background: MODE_COLORS[m] }} />{MODE_NAMES[m]} {pct(st.modal[m] ?? 0)}</span>)}</div>
      <div className="kpi" style={{ marginTop: 14 }}>
        <Kpi k="Avg commute" v={`${st.avgCommuteMin.toFixed(0)} min`} s={`${st.avgDistKm.toFixed(1)} km avg trip`} tone={st.avgCommuteMin > 40 ? 'bad' : st.avgCommuteMin > 28 ? 'warn' : 'good'} />
        <Kpi k="Congestion" v={`${cong}%`} s={`avg speed ${Math.round(st.avgSpeed)} km/h`} tone={cong > 55 ? 'bad' : cong > 28 ? 'warn' : 'good'} />
        <Kpi k="Last-mile access" v={pct(st.lastMile)} s="to transit nodes" tone={st.lastMile < 0.3 ? 'warn' : undefined} />
        <Kpi k="PT coverage" v={pct(st.ptCoverage)} s={`${fmtNum(st.ridership)} boardings/day`} />
        <Kpi k="Freight" v={`${fmtNum(st.freightTrips)}/day`} s={`${pct(st.heavyPct)} heavy vehicles`} />
        <Kpi k="Walk · cycle access" v={`${pct(st.walkAccess)} · ${pct(st.bikeAccess)}`} s="footpaths & lanes" />
      </div>
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Trends</div>
      <div className="row"><span className="muted" style={{ width: 70 }}>Citizens</span><div className="grow"><Spark data={hist.map((h) => h.pop)} color="#6b9a6a" /></div></div>
      <div className="row"><span className="muted" style={{ width: 70 }}>Congestion</span><div className="grow"><Spark data={hist.map((h) => h.congestion)} color="#e8743b" /></div></div>
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Bottlenecks — click to inspect</div>
      {bott.length === 0 && <div className="muted">No road is near capacity right now.</div>}
      <div className="list">{bott.map(({ e, v }) => (
        <div key={e.id} className="li" onClick={() => { s.select({ kind: 'edge', id: e.id }); s.panel = 'none'; s.view?.focusOn(e.pts[Math.floor(e.pts.length / 4) * 2], e.pts[Math.floor(e.pts.length / 4) * 2 + 1], 18); }}>
          <span className="sw" style={{ background: v > 1.1 ? '#c4382f' : v > 0.85 ? '#e07a3a' : '#e9c24a' }} /><div className="grow"><b>{e.spec.name}</b><div className="dim" style={{ fontSize: 11 }}>{pct(v)} of capacity · {Math.round(Math.min(e.speedNow![0], e.speedNow![1] || 999))} km/h</div></div><Icon n="arrow" size={14} />
        </div>))}</div>
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Planning insights</div>
      <div className="col" style={{ gap: 6 }}>{tip.map((t) => <div key={t} className="card" style={{ padding: '8px 10px', fontSize: 12.5 }}>{t}</div>)}</div>
      <button className="btn sm ghost" style={{ marginTop: 12 }} onClick={() => setAdv(!adv)}>{adv ? 'Hide' : 'Show'} advanced statistics</button>
      {adv && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="rowline"><span>Trips per day (all modes)</span><span>{fmtNum(st.trips)}</span></div>
          <div className="rowline"><span>Unreachable trips</span><span>{fmtNum(st.unreachable)}</span></div>
          <div className="rowline"><span>Vehicles shown / sampling</span><span>{tr.vehicles.length} · 1 per {tr.debug.kScale.toFixed(1)}</span></div>
          <div className="rowline"><span>Sprawl index</span><span>{pct(st.sprawl)}</span></div>
          <div className="rowline"><span>Employment</span><span>{st.employed} / {st.workers}</span></div>
          <div className="rowline"><span>Air · noise (avg)</span><span>{pct(st.airAvg)} · {pct(st.noiseAvg)}</span></div>
          {[...w.lines.values()].map((l) => <div key={l.id} className="rowline"><span>{l.name}</span><span>{Math.round(l.ridersToday)}/day · {pct(l.loadFactor)}</span></div>)}
        </div>
      )}
    </Side>
  );
}

export function CityPanel() {
  const s = useStore();
  const w = s.world!, st = w.stats;
  const next = MILESTONES.find((m) => w.maxPop < m.pop);
  const D = st.demand;
  const unlocks = [
    [3000, 'Arterial roads, avenues, college'], [10000, 'Highways, university, business parks'], [25000, 'Metro, IT towers, high-density towers, underground utilities'], [35000, 'Suburban rail'], [50000, 'Regional rail, logistics hubs, big landmarks'],
  ] as const;
  return (
    <Side title="City" onClose={() => s.setPanel('city')} wide>
      <div className="row space"><div><div className="tag">Character</div><b style={{ fontSize: 16 }}>{st.city}</b></div><div style={{ textAlign: 'right' }}><div className="tag">Citizens</div><b style={{ fontSize: 16 }}>{st.population.toLocaleString('en-IN')}</b></div></div>
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Demand for development</div>
      <div className="demand">{([['Homes', D.r, '#6b9a6a'], ['Shops', D.c, '#5aa6d6'], ['Industry', D.i, '#b8a064'], ['Offices', D.o, '#8a7fd0']] as const).map(([n, v, c]) => <div key={n}><div className="col"><i style={{ height: `${v * 100}%`, background: c }} /></div><small>{n}</small></div>)}</div>
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Happiness · {pct(st.happiness)}</div>
      {Object.entries(st.happinessParts).map(([k, v]) => <Bar key={k} name={k} value={v} color={v > 0.65 ? '#6b9a6a' : v > 0.4 ? '#e9c24a' : '#d9564a'} />)}
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Jobs & housing</div>
      <div className="kpi">
        <Kpi k="Employed" v={`${st.employed}`} s={`of ${st.workers} workers`} tone={st.workers > 0 && st.employed / st.workers < 0.8 ? 'warn' : undefined} />
        <Kpi k="Jobs available" v={`${st.jobs}`} s={`${Math.max(0, st.jobs - st.employed)} vacant`} />
        <Kpi k="Students" v={`${st.enrolled}/${st.students}`} s="in school" tone={st.students > 0 && st.enrolled / st.students < 0.6 ? 'warn' : undefined} />
        <Kpi k="Land value" v={pct(st.landValueAvg)} s="average" />
      </div>
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Power & water</div>
      <Bar name={`Power ${st.powerDemand.toFixed(1)} / ${st.powerSupply.toFixed(0)} MW`} value={st.powerSupply > 0 ? st.powerDemand / st.powerSupply : 1} color={st.powerDemand > st.powerSupply ? '#d9564a' : '#f2b24a'} />
      <Bar name={`Water ${st.waterDemand.toFixed(1)} / ${st.waterSupply.toFixed(1)} ML`} value={st.waterSupply > 0 ? st.waterDemand / st.waterSupply : 1} color={st.waterDemand > st.waterSupply ? '#d9564a' : '#4a8fb5'} />
      {st.unserved > 0 && <div className="warn" style={{ fontSize: 12 }}>{st.unserved} people live or work without full utilities.</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <label className="row" style={{ color: w.isUnlocked(FEATURE_UNLOCK.undergroundUtilities) ? undefined : 'var(--dim)' }}><input type="checkbox" disabled={!w.isUnlocked(FEATURE_UNLOCK.undergroundUtilities)} checked={w.policies.undergroundUtilities} onChange={(e) => { w.policies.undergroundUtilities = e.target.checked; w.net.touch(false); s.view?.markRoadsDirty(); s.emit(); }} /> Underground utilities (no overhead poles)</label>
      </div>
      {!w.isUnlocked(FEATURE_UNLOCK.undergroundUtilities) && <div className="lockline">Unlocks at 25,000 citizens</div>}
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Environment</div>
      <Bar name="Air pollution" value={st.airAvg * 1.5} color="#a0603a" /><Bar name="Noise" value={st.noiseAvg * 1.5} color="#c28a3a" />
      <div className="rowline"><span>Weather</span><span>{w.weather} · {st.floodedTiles} flooded</span></div>
      <hr />
      <div className="lbl" style={{ marginBottom: 6 }}>Progression</div>
      {next ? <div className="muted" style={{ fontSize: 12.5 }}>Next: <b style={{ color: 'var(--text)' }}>{next.pop.toLocaleString('en-IN')} citizens</b> — {next.text}</div> : <div className="good">You have reached the metropolis stage.</div>}
      <div className="col" style={{ marginTop: 8, gap: 4 }}>{unlocks.map(([p, t]) => <div key={p} className="rowline" style={{ opacity: w.isUnlocked(p) ? 1 : 0.55 }}><span>{p.toLocaleString('en-IN')}</span><span style={{ textAlign: 'right', maxWidth: 260 }}>{w.isUnlocked(p) ? '✓ ' : ''}{t}</span></div>)}</div>
    </Side>
  );
}

export function BudgetPanel() {
  const s = useStore();
  const w = s.world!, st = w.stats;
  const inc = Object.entries(st.breakdown).filter(([k]) => k.startsWith('+')), exp = Object.entries(st.breakdown).filter(([k]) => k.startsWith('−'));
  const net = st.incomeMonth - st.expenseMonth;
  return (
    <Side title="Budget" onClose={() => s.setPanel('budget')}>
      <div className="kpi">
        <Kpi k="Funds" v={fmtMoney(w.money)} tone={w.money < 0 ? 'bad' : undefined} />
        <Kpi k="Net / month" v={`${net >= 0 ? '+' : ''}${fmtMoney(net)}`} tone={net < 0 ? 'bad' : 'good'} s={`in ${fmtMoney(st.incomeMonth)} · out ${fmtMoney(st.expenseMonth)}`} />
      </div>
      <div style={{ margin: '10px 0' }}><Spark data={w.history.slice(-60).map((h) => h.money)} color="#f2b24a" h={40} /></div>
      <div className="lbl" style={{ marginBottom: 4 }}>Income (monthly)</div>
      {inc.map(([k, v]) => <div className="rowline" key={k}><span>{k.slice(2)}</span><span className="good">{fmtMoney(v)}</span></div>)}
      <div className="lbl" style={{ margin: '10px 0 4px' }}>Expenses (monthly)</div>
      {exp.map(([k, v]) => <div className="rowline" key={k}><span>{k.slice(2)}</span><span className="bad">{fmtMoney(v)}</span></div>)}
      <hr />
      <div className="field"><label>Tax rate <span className="val">{Math.round(w.policies.tax * 100)}%</span></label><input type="range" min={0.04} max={0.16} step={0.01} value={w.policies.tax} onChange={(e) => { w.policies.tax = +e.target.value; s.emit(); }} />
        <span className="dim" style={{ fontSize: 11.5 }}>Higher taxes raise income and lower happiness.</span></div>
      <div className="field"><label>Bus fare <span className="val">₹{w.policies.fare}</span></label><input type="range" min={0} max={40} step={1} value={w.policies.fare} onChange={(e) => { w.policies.fare = +e.target.value; w.assignDirty = true; s.emit(); }} />
        <span className="dim" style={{ fontSize: 11.5 }}>Cheaper fares shift trips to transit but reduce revenue.</span></div>
    </Side>
  );
}

export function LinesPanel() {
  const s = useStore();
  const w = s.world!;
  const lines = [...w.lines.values()];
  return (
    <Side title="Transit lines" onClose={() => s.setPanel('lines')}>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="btn sm primary" onClick={() => { s.startTransit('bus', 'bus'); }}>+ Bus route</button>
        <button className="btn sm" disabled={!w.isUnlocked(FEATURE_UNLOCK.metro)} onClick={() => s.startTransit('metro', 'metro')}>+ Metro line</button>
        <button className="btn sm" disabled={!w.isUnlocked(FEATURE_UNLOCK.suburban)} onClick={() => s.startTransit('rail', 'suburban')}>+ Rail line</button>
      </div>
      {lines.length === 0 && <div className="muted">No lines yet. Build a bus depot, then create a route through busy streets. You get a depot to start with.</div>}
      <div className="list">{lines.map((l) => (
        <div key={l.id} className="li" onClick={() => { s.panel = 'none'; s.select({ kind: 'line', id: l.id }); }}>
          <span className="sw" style={{ background: '#' + l.color.toString(16).padStart(6, '0') }} />
          <div className="grow"><b>{l.name}</b><div className="dim" style={{ fontSize: 11 }}>{TRANSIT[l.mode].name} · {l.stops.length} stops · every {l.headwayMin} min</div></div>
          <div style={{ textAlign: 'right' }}><div className="mono">{Math.round(l.ridersToday)}</div><div className={'dim ' + (l.loadFactor > 1 ? 'bad' : '')} style={{ fontSize: 10.5 }}>{pct(l.loadFactor)} full</div></div>
        </div>))}</div>
    </Side>
  );
}

export function HelpPanel() {
  const s = useStore();
  return (
    <Side title="How to play" onClose={() => s.setPanel('help')} wide>
      <p style={{ marginTop: 0 }}>You are designing a city <i>and how it moves</i>. Roads, junctions, buses, autos, footpaths and freight decide where people live, work and shop.</p>
      <div className="lbl" style={{ marginBottom: 4 }}>First ten minutes</div>
      <ol style={{ paddingLeft: 18, lineHeight: 1.6, margin: '0 0 10px' }}>
        <li><b>Roads → pick a type</b> and customise lanes, median, footpaths, cycle lanes, bus lanes. Click start, click end, review cost, confirm.</li>
        <li><b>Zoning</b>: drag rectangles next to roads. Homes, shops and workplaces grow if power & water reach.</li>
        <li>Watch <b>Traffic</b> and <b>Mobility</b>. Click any road or junction to inspect or retune it.</li>
        <li><b>Transport → New bus route</b>: pick a depot, click stops, set frequency, activate. Place <b>auto stands</b> near stops for last-mile trips.</li>
        <li>Grow. At 25,000 citizens the metro unlocks. Compact, mixed-use, transit-rich cities need fewer car lanes.</li>
      </ol>
      <div className="lbl" style={{ marginBottom: 4 }}>Controls</div>
      <div className="card" style={{ lineHeight: 1.9 }}>
        <div><kbd>Wheel</kbd> zoom · <kbd>Right-drag</kbd> rotate & tilt · <kbd>Middle/Shift-drag</kbd> pan</div>
        <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> pan · <kbd>Q</kbd><kbd>E</kbd> rotate · <kbd>R</kbd><kbd>F</kbd> tilt</div>
        <div><kbd>Space</kbd> pause · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> speed · <kbd>Esc</kbd> cancel · <kbd>Enter</kbd> confirm · <kbd>T</kbd> rotate building</div>
      </div>
      <div className="lbl" style={{ margin: '12px 0 4px' }}>Ideas to try</div>
      <ul style={{ paddingLeft: 18, lineHeight: 1.55, margin: 0 }}>
        <li>Separate trucks from homes with a freight corridor and a warehouse.</li>
        <li>Replace a busy signal with a roundabout and watch queues.</li>
        <li>Give a street wide footpaths and trees and watch walking rise.</li>
        <li>Put a bus lane on a congested avenue. Buses ignore the jam.</li>
        <li>Build only highways and watch sprawl and car dependence climb.</li>
      </ul>
    </Side>
  );
}

export function DebugPanel() {
  const s = useStore();
  const w = s.world!, sim = s.sim!, tr = sim.traffic, st = w.stats;
  const c = tr.counts();
  const A = tr.assigner;
  return (
    <div className="panel debug">
      <div style={{ color: '#f2b24a' }}>DEBUG</div>
      <div>FPS {s.view?.fps.toFixed(0)} · sim {sim.debug.simMs.toFixed(2)} ms/frame</div>
      <div>Sim time day {w.day.toFixed(1)} {w.timeLabel()} · x{sim.speed}</div>
      <div>Vehicles {c.vehicles} (heavy {c.heavy}) · Peds {c.peds} · Trains {c.trains}</div>
      <div>Population {st.population} · households {st.households} · buildings {w.buildings.size}</div>
      <div>Traffic: sample 1:{tr.debug.kScale.toFixed(1)} · spawned {tr.debug.spawned} · despawn {tr.debug.despawned}</div>
      <div>Reroutes {tr.debug.rerouted} · gridlock fixes {tr.debug.gridlock} · spawn blocked {tr.debug.spawnFail}</div>
      <div>Pathfinding: {tr.debug.pathCalls} calls · {tr.debug.pathMs.toFixed(3)} ms avg</div>
      <div>Assignment: {A.trips.length} trips · pass {A.passes} · cursor {A.cursor}</div>
      <div>Routes: {[...w.lines.values()].filter((l) => l.active).length} active lines · {w.stops.size} stops</div>
      <div>Network: {w.net.nodes.size} nodes · {w.net.edges.size} edges · {w.net.totalLength().toFixed(0)} tiles</div>
      <div>Congestion {st.congestion.toFixed(2)} · avg speed {st.avgSpeed.toFixed(0)} km/h · sprawl {st.sprawl.toFixed(2)}</div>
      <div>Field jobs ms: {Object.entries(sim.debug.jobMs).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ')}</div>
      <div>Weather {w.weather} · rain {w.rain.toFixed(2)} · flooded {st.floodedTiles}</div>
      <div className="row" style={{ marginTop: 6 }}><button className="btn sm" onClick={() => { w.money += 2000; s.emit(); }}>+₹20 Cr</button><button className="btn sm" onClick={() => { w.unlockAll = !w.unlockAll; s.emit(); }}>{w.unlockAll ? 'Lock' : 'Unlock all'}</button></div>
    </div>
  );
}
export { DEFS, VI };
