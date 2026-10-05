import { useEffect, useState } from 'react';
import { useStore, Dock, ViewMode } from '../ui/store';
import { Icon } from './Icon';
import { BUILDINGS, DEFS, ZONE_INFO, BuildingDef } from '../data/buildings';
import { PRESETS } from '../game/roads/spec';
import { FEATURE_UNLOCK, ROAD_UNLOCK, specUnlock, zoneUnlock } from '../game/actions';
import { Zone } from '../game/types';
import { fmtMoney, fmtNum } from '../utils/math';
import { OVERLAYS, OVERLAY_BY_KEY } from '../rendering/overlays';
import { SPEEDS } from '../game/simulation/engine';
import { TRANSIT } from '../game/transportation/transit';
import { LAYOUTS } from '../data/layouts';
import { RoadDesigner } from './RoadDesigner';
import { Inspector } from './Inspector';
import { TransitWizard } from './TransitWizard';
import { MobilityPanel, CityPanel, BudgetPanel, LinesPanel, HelpPanel, DebugPanel } from './Panels';
import { SaveList, SettingsScreen } from './Menus';

const DOCKS: { k: Dock; label: string; icon: string }[] = [
  { k: 'roads', label: 'Roads', icon: 'road' },
  { k: 'zones', label: 'Zoning', icon: 'zone' },
  { k: 'layouts', label: 'Layouts', icon: 'city' },
  { k: 'transit', label: 'Transport', icon: 'bus' },
  { k: 'services', label: 'Services', icon: 'service' },
  { k: 'utilities', label: 'Utilities', icon: 'utility' },
  { k: 'parks', label: 'Parks & Culture', icon: 'park' },
  { k: 'buildings', label: 'Markets & Landmarks', icon: 'market' },
];

const weatherIcon = { clear: 'sun', cloudy: 'cloud', rain: 'rain', heavy: 'heavy' } as const;

function Lock({ pop }: { pop?: number }) {
  const s = useStore();
  if (!pop || s.world!.isUnlocked(pop)) return null;
  return <span className="lockline">Unlocks at {pop.toLocaleString('en-IN')} citizens</span>;
}

function BuildItem({ def }: { def: BuildingDef }) {
  const s = useStore();
  const w = s.world!;
  const locked = !w.isUnlocked(def.unlock);
  return (
    <button className={'item' + (locked ? ' locked' : '') + (s.tool === 'building' && s.buildKey === def.key ? ' on' : '')} disabled={locked} onClick={() => s.chooseBuilding(def.key)} title={def.desc}>
      <b>{def.name}</b>
      <span>{def.desc ?? ''}</span>
      <span className="cost">{fmtMoney(def.cost * w.costMultiplier())}{def.upkeep ? ` · ${def.upkeep} L/mo` : ''}</span>
      <Lock pop={def.unlock} />
    </button>
  );
}

function Flyout() {
  const s = useStore();
  const w = s.world!;
  const d = s.dock;
  if (d === 'none' || d === 'roads') return null;
  const list = (pred: (b: BuildingDef) => boolean) => BUILDINGS.filter(pred).map((b) => <BuildItem key={b.key} def={b} />);
  let content: React.ReactNode = null;
  if (d === 'layouts') {
    content = (
      <>
        <h4>Preset layouts — place a whole complex in one click</h4>
        <div className="items">
          {LAYOUTS.map((l) => {
            const locked = !w.isUnlocked(l.unlock);
            return (
              <button key={l.key} className={'item' + (locked ? ' locked' : '') + (s.tool === 'layout' && s.layoutKey === l.key ? ' on' : '')} disabled={locked} onClick={() => s.chooseLayout(l.key)}>
                <b>{l.name}</b><span>{l.desc}</span><span className="dim">{l.items.length} buildings · {l.w}×{l.h} tiles</span><Lock pop={l.unlock} />
              </button>
            );
          })}
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Place beside a road on flat land. Green = will be built, red = blocked. Press T to rotate.</div>
      </>
    );
  } else if (d === 'zones') {
    content = (
      <>
        <h4>Paint land use — drag a rectangle beside a road</h4>
        <div className="items">
          {[Zone.ResLow, Zone.ResMed, Zone.ResHigh, Zone.Commercial, Zone.Mixed, Zone.Industrial, Zone.Office].map((z) => {
            const info = ZONE_INFO[z]; const locked = !w.isUnlocked(zoneUnlock(z));
            return (
              <button key={z} className={'item' + (locked ? ' locked' : '') + (s.tool === 'zone' && s.zone === z ? ' on' : '')} disabled={locked} onClick={() => s.chooseZone(z)}>
                <b><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: info.hex, marginRight: 7 }} />{info.name}</b>
                <span>{info.desc}</span><Lock pop={zoneUnlock(z)} />
              </button>
            );
          })}
          <button className={'item' + (s.tool === 'zone' && s.zone === Zone.None ? ' on' : '')} onClick={() => s.chooseZone(Zone.None)}><b>Clear zoning</b><span>Remove the zone from tiles (buildings stay).</span></button>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn sm primary" onClick={() => { s.dock = 'layouts'; s.emit(); }}>Or place a ready-made layout (colony, market, mall, office park…) →</button></div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Buildings grow on zoned tiles within ~3 tiles of a road that also have power and water. Mixed-use and TOD near stations grow denser.</div>
      </>
    );
  } else if (d === 'transit') {
    const T = FEATURE_UNLOCK;
    const wiz = (label: string, desc: string, family: 'bus' | 'metro' | 'rail', mode: Parameters<typeof s.startTransit>[1], pop = 0) => {
      const locked = !w.isUnlocked(pop);
      return <button className={'item' + (locked ? ' locked' : '')} disabled={locked} onClick={() => { s.startTransit(family, mode); s.dock = 'none'; }}><b>{label}</b><span>{desc}</span><Lock pop={pop} /></button>;
    };
    content = (
      <>
        <h4>Buses & autos</h4>
        <div className="items">
          {wiz('New bus route', 'Pick stops, create, name, set frequency, activate', 'bus', 'bus')}
          <button className={'item' + (s.tool === 'busstop' ? ' on' : '')} onClick={() => { s.setTool('busstop'); s.dock = 'none'; s.emit(); }}><b>Bus stop & shelter</b><span>Click a road to place a stop</span><span className="cost">₹ 4.5 L</span></button>
          {list((b) => ['bus_depot', 'bus_terminal', 'auto_stand'].includes(b.key))}
        </div>
        <h4>Metro</h4>
        <div className="items">
          {wiz('New metro line', 'Elevated, at-grade or underground sections', 'metro', 'metro', T.metro)}
          {list((b) => ['station_metro', 'metro_depot'].includes(b.key))}
        </div>
        <h4>Rail</h4>
        <div className="items">
          {wiz('New suburban line', 'Frequent rail to the suburbs', 'rail', 'suburban', T.suburban)}
          {wiz('New regional line', 'Fast intercity-style rail', 'rail', 'regional', T.regional)}
          {list((b) => ['station_suburban', 'station_regional', 'rail_yard'].includes(b.key))}
          <button className="item locked" disabled><b>Freight rail</b><span>Dedicated goods trains</span><span className="lockline">Coming soon</span></button>
        </div>
        <h4>Freight & logistics</h4>
        <div className="items">
          {list((b) => ['warehouse', 'truck_terminal', 'logistics_hub'].includes(b.key))}
          <button className="item" onClick={() => { s.choosePreset('Freight Corridor'); }}><b>Freight corridor</b><span>Heavy-vehicle spine away from homes</span><Lock pop={ROAD_UNLOCK['Freight Corridor']} /></button>
        </div>
      </>
    );
  } else if (d === 'services') content = <><h4>Public services</h4><div className="items">{list((b) => b.cat === 'service')}</div></>;
  else if (d === 'utilities') content = <><h4>Power, water & drainage</h4><div className="items">{list((b) => b.cat === 'utility')}</div><div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Substations and towers must sit within ~22 tiles of a plant or water source. Open <b>City → Utilities</b> to see the balance.</div></>;
  else if (d === 'parks') content = <><h4>Parks</h4><div className="items">{list((b) => b.cat === 'park')}</div><h4>Community & cultural</h4><div className="items">{list((b) => b.cat === 'culture')}</div><div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Community buildings are destinations and landmarks. They give every faith the same effects.</div></>;
  else if (d === 'buildings') content = <><h4>Markets</h4><div className="items">{list((b) => b.cat === 'market')}</div><h4>Landmarks</h4><div className="items">{list((b) => b.cat === 'landmark')}</div></>;
  return <div className="panel flyout">{content}</div>;
}

function RoadFlyout() {
  const s = useStore();
  if (s.dock !== 'roads') return null;
  const w = s.world!;
  return (
    <div className="panel flyout">
      <h4>Road types — pick one, tune it in the designer</h4>
      <div className="items">
        {PRESETS.map((p) => {
          const lock = Math.max(ROAD_UNLOCK[p.name] ?? 0, specUnlock(p).pop);
          const locked = !w.isUnlocked(lock);
          return (
            <button key={p.name} className={'item' + (locked ? ' locked' : '') + (s.tool === 'road' && s.roadPreset === p.name ? ' on' : '')} disabled={locked} onClick={() => { s.choosePreset(p.name); }}>
              <b>{p.name}</b>
              <span>{p.lanesBwd === 0 ? `${p.lanesFwd}-lane one-way` : `${p.lanesFwd}+${p.lanesBwd} lanes`} · {p.speed} km/h</span>
              <Lock pop={lock} />
            </button>
          );
        })}
        {s.templates.map((t) => (
          <button key={'t' + t.name} className={'item' + (s.tool === 'road' && s.roadPreset === t.name ? ' on' : '')} onClick={() => s.chooseTemplate(t)}>
            <b>★ {t.name}</b><span>Your template</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function GameHud() {
  const s = useStore();
  const w = s.world!, sim = s.sim!, st = w.stats;
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const cong = Math.round(Math.min(1, st.congestion * 1.4) * 100);
  const happy = Math.round(st.happiness * 100);
  const recent = w.messages.filter((m) => m.id >= s.toastSeen && Date.now() - m.t < 6500).slice(-3);
  useEffect(() => { const t = setInterval(() => s.emit(), 450); return () => clearInterval(t); }, []);

  const rightPanel = (() => {
    switch (s.panel) {
      case 'mobility': return <MobilityPanel />;
      case 'city': return <CityPanel />;
      case 'budget': return <BudgetPanel />;
      case 'lines': return <LinesPanel />;
      case 'help': return <HelpPanel />;
      case 'save': return (
        <Side title="Save city" onClose={() => s.setPanel('save')}><SaveList mode="save" /><div className="dim" style={{ marginTop: 8 }}>{s.saveNote}</div></Side>
      );
      default: break;
    }
    if (s.transitDraft) return <TransitWizard />;
    if (s.tool === 'road' || s.tool === 'upgrade') return <RoadDesigner />;
    if (s.selection) return <Inspector />;
    if (s.tool === 'building' && s.buildKey) return <BuildInfo />;
    return null;
  })();

  const lens = (key: ViewMode, label: string, icon: string) => (
    <button className={'ov' + (s.viewMode === key ? ' on' : '')} onClick={() => s.setViewMode(key)}><Icon n={icon} size={15} /><span>{label}</span></button>
  );
  const od = s.overlay !== 'none' ? OVERLAY_BY_KEY[s.overlay] : null;
  const groups = ['Mobility', 'City', 'Terrain', 'Utilities'] as const;

  return (
    <div className="hud">
      <div className="panel topbar">
        <div className="logo" onClick={() => setMenu(true)} title="Menu">NAGARA</div>
        <div className="city"><b>{w.cityName}</b><span>{st.city}</span></div>
        <div className="stat" onClick={() => s.setPanel('city')} title="City overview"><span className="ico"><Icon n="pop" size={20} /></span><div><div className="k">Citizens</div><div className="v mono">{fmtNum(st.population)}</div></div></div>
        <div className="stat" onClick={() => s.setPanel('budget')} title="Budget"><span className="ico"><Icon n="money" size={20} /></span><div><div className="k">Funds</div><div className="v mono" style={{ color: w.money < 0 ? 'var(--red)' : undefined }}>{fmtMoney(w.money)}</div></div></div>
        <div className="stat" onClick={() => s.setPanel('city')} title="Happiness"><span className="ico"><Icon n="smile" size={20} /></span><div><div className="k">Happiness</div><div className="v mono">{happy}%</div></div></div>
        <div className="stat" onClick={() => s.setPanel('mobility')} title="Mobility dashboard"><span className="ico"><Icon n="traffic" size={20} /></span><div><div className="k">Traffic</div><div className="v mono" style={{ color: cong > 60 ? 'var(--red)' : cong > 30 ? 'var(--amber)' : undefined }}>{cong}%</div></div></div>
        <div className="grow" />
        <div className="stat" style={{ cursor: 'default' }}><span className="ico"><Icon n={weatherIcon[w.weather]} size={20} /></span><div><div className="k">{w.dateLabel()}</div><div className="v mono">{w.timeLabel()}</div></div></div>
        <div className="seg speed">
          {SPEEDS.map((v, i) => <button key={i} className={sim.speedIndex === i ? 'on' : ''} title={['Pause (Space)', 'Normal (1)', 'Fast (2)', 'Very fast (3)'][i]} onClick={() => { sim.setSpeed(i); s.emit(); }}><Icon n={['pause', 'play', 'ff', 'fff'][i]} size={14} /></button>)}
        </div>
        <button className={'btn icon' + (s.designMode ? ' on' : '')} title="Transportation design mode" onClick={() => s.toggleDesignMode()}><Icon n="transit" /></button>
        <button className="btn icon" title="Save" onClick={() => s.setPanel('save')}><Icon n="save" /></button>
        <button className="btn icon" title="Menu" onClick={() => setMenu(true)}><Icon n="map" /></button>
      </div>

      <div className="rail">
        <div className="panel group">
          <div className="gh">Camera view</div>
          {lens('city', 'City', 'city')}{lens('transport', 'Transportation', 'road')}{lens('terrain', 'Terrain', 'terrain')}{lens('transit', 'Transit', 'bus')}
        </div>
        <div className="panel group">
          <button className="ov" onClick={() => s.setPanel('mobility')}><Icon n="chart" size={15} /><span>Mobility</span></button>
          <button className="ov" onClick={() => s.setPanel("city")}><Icon n="city" size={15} /><span>City stats</span></button>
          <button className="ov" onClick={() => s.setPanel('budget')}><Icon n="budget" size={15} /><span>Budget</span></button>
          <button className="ov" onClick={() => s.setPanel('lines')}><Icon n="lines" size={15} /><span>Transit lines</span></button>
          <button className="ov" onClick={() => s.setPanel('help')}><Icon n="help" size={15} /><span>Help</span></button>
        </div>
        <div className="panel group">
          <button className={'ov' + (s.lensesOpen || s.overlay !== 'none' ? ' on' : '')} onClick={() => { s.lensesOpen = !s.lensesOpen; s.emit(); }}><Icon n="layers" size={15} /><span>Map lenses {s.lensesOpen ? '▾' : '▸'}</span></button>
          {s.overlay !== 'none' && !s.lensesOpen && <button className="ov" onClick={() => s.setOverlay(s.overlay)}><Icon n="close" size={14} /><span>Clear lens</span></button>}
          {s.lensesOpen && groups.map((g) => (
            <div key={g}>
              <div className="gh">{g}</div>
              {OVERLAYS.filter((o) => o.group === g).map((o) => <button key={o.key} className={'ov' + (s.overlay === o.key ? ' on' : '')} onClick={() => s.setOverlay(o.key)} title={o.hint}><i className="sw" /><span>{o.label}</span></button>)}
            </div>
          ))}
        </div>
      </div>

      {od && od.stops.length > 0 && (
        <div className="panel legend">
          <b>{od.label}</b>
          <div className="bar" style={{ background: `linear-gradient(90deg, ${od.stops.join(',')})` }} />
          <div className="ends"><span>{od.low}</span><span>{od.high}</span></div>
          <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{od.hint}</div>
        </div>
      )}
      {s.overlay === 'zones' && (
        <div className="panel legend"><b>Zoning</b>{[Zone.ResLow, Zone.ResMed, Zone.ResHigh, Zone.Commercial, Zone.Mixed, Zone.Industrial, Zone.Office].map((z) => <div key={z} className="row" style={{ fontSize: 11.5, marginTop: 3 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: ZONE_INFO[z].hex, display: 'inline-block' }} />{ZONE_INFO[z].name}</div>)}</div>
      )}

      {rightPanel}
      {s.checklistOpen && <Checklist />}
      {s.debug && <DebugPanel />}

      <div className="toasts">{recent.map((m) => <div key={m.id} className={'toast ' + m.kind}>{m.text}</div>)}{s.message && <div className="toast">{s.message}</div>}</div>
      <Hints />
      <ConfirmBar />

      <div className="panel dock">
        <button className={'dock-btn' + (s.tool === 'select' && s.dock === 'none' ? ' on' : '')} onClick={() => { s.setTool('select'); s.dock = 'none'; s.emit(); }}><Icon n="select" />Inspect</button>
        <button className={'dock-btn' + (s.tool === 'bulldoze' ? ' on' : '')} onClick={() => { s.setTool('bulldoze'); s.dock = 'none'; s.emit(); }}><Icon n="bulldoze" />Demolish</button>
        <button className={'dock-btn' + (s.tool === 'upgrade' ? ' on' : '')} onClick={() => { s.setTool('upgrade'); s.dock = 'none'; s.emit(); }}><Icon n="upgrade" />Upgrade road</button>
        <div className="sep" />
        {DOCKS.map((d) => <button key={d.k} className={'dock-btn' + (s.dock === d.k ? ' on' : '')} onClick={() => { s.openDock(d.k); if (d.k === 'roads' && s.tool !== 'road') { /* keep tool until a preset is chosen */ } }}><Icon n={d.icon} />{d.label}</button>)}
      </div>
      <Flyout />
      <RoadFlyout />

      <div className="panel status">
        {s.hover ? (<>
          <span><b>{s.hover.area}</b></span>
          <span>Elev <b>{Math.round(s.hover.h)} m</b></span>
          <span>Slope <b>{Math.round(s.hover.slope * 100)}%</b></span>
          <span>{s.hover.water ? 'Water' : ['Buildable', 'Difficult', 'Expensive', 'Blocked'][s.hover.build]}</span>
          {s.hover.building && <span><b>{s.hover.building}</b></span>}
        </>) : <span>Move the cursor over the map</span>}
      </div>
      <div className="panel cam">
        <button className="btn icon" title="Zoom in" onClick={() => s.view?.zoomBy(0.8)}><Icon n="plus" /></button>
        <button className="btn icon" title="Zoom out" onClick={() => s.view?.zoomBy(1.25)}><Icon n="minus" /></button>
        <button className="btn icon" title="Rotate left (Q)" onClick={() => s.view?.rotateBy(-0.4)}><Icon n="rotl" /></button>
        <button className="btn icon" title="Rotate right (E)" onClick={() => s.view?.rotateBy(0.4)}><Icon n="rotr" /></button>
        <button className="btn icon" title="Tilt up (R)" onClick={() => s.view?.tiltBy(0.15)}><Icon n="tiltu" /></button>
        <button className="btn icon" title="Tilt down (F)" onClick={() => s.view?.tiltBy(-0.15)}><Icon n="tiltd" /></button>
        <button className="btn icon" title="Centre on city" onClick={() => s.view?.focusOn(w.terrain.start.x, w.terrain.start.y, 36)}><Icon n="pin" /></button>
      </div>

      {menu && (
        <div className="modal-back" onClick={() => setMenu(false)}>
          <div className="panel modal" onClick={(e) => e.stopPropagation()} style={{ width: 380 }}>
            <div className="brand" style={{ fontSize: 15, marginBottom: 12 }}>NAGARA</div>
            <div className="col">
              <button className="btn" onClick={() => setMenu(false)}>Resume</button>
              <button className="btn" onClick={() => { setMenu(false); s.setPanel('save'); }}>Save city</button>
              <button className="btn" onClick={() => { setMenu(false); setSettings(true); }}>Settings</button>
              <button className="btn" onClick={() => { setMenu(false); s.panel = 'help'; s.emit(); }}>How to play</button>
              <button className="btn danger" onClick={() => { s.exitToMenu(); }}>Exit to main menu</button>
            </div>
          </div>
        </div>
      )}
      {settings && <SettingsScreen inGame onClose={() => setSettings(false)} />}
    </div>
  );
}

export function Side({ title, onClose, children, wide, actions }: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean; actions?: React.ReactNode }) {
  return (
    <div className={'panel side' + (wide ? ' wide' : '')}>
      <div className="sh"><h3>{title}</h3>{actions}{onClose && <button className="btn icon ghost" onClick={onClose}><Icon n="close" size={16} /></button>}</div>
      <div className="sb">{children}</div>
    </div>
  );
}

function BuildInfo() {
  const s = useStore();
  const def = DEFS[s.buildKey!];
  if (!def) return null;
  const cost = def.cost * s.world!.costMultiplier();
  const rect = def.w !== def.h;
  return (
    <Side title={def.name} onClose={() => s.setTool('select')}>
      <p className="muted" style={{ marginTop: 0 }}>{def.desc}</p>
      <div className="rowline"><span>Cost</span><span>{fmtMoney(cost)}</span></div>
      <div className="rowline"><span>Upkeep</span><span>{def.upkeep} L / month</span></div>
      <div className="rowline"><span>Footprint</span><span>{def.w}×{def.h} tiles</span></div>
      {def.radius && <div className="rowline"><span>Service radius</span><span>{def.radius} tiles ({def.radius * 50} m)</span></div>}
      {def.capacity ? <div className="rowline"><span>Capacity</span><span>{def.capacity}{def.service === 'power' ? ' MW' : def.service === 'water' ? ' ML/day' : ''}</span></div> : null}
      {def.jobsPerLevel ? <div className="rowline"><span>Jobs</span><span>~{def.jobsPerLevel}</span></div> : null}
      {s.buildIssue ? <div className="bad" style={{ marginTop: 10 }}>⚠ {s.buildIssue}</div> : <div className="good" style={{ marginTop: 10 }}>✓ Click to place</div>}
      {def.key === 'station_metro' && (
        <div className="field" style={{ marginTop: 12 }}><label>Station type</label>
          <div className="seg">{(['elevated', 'surface', 'underground'] as const).map((a) => <button key={a} className={s.stationAlign === a ? 'on' : ''} onClick={() => { s.stationAlign = a; s.emit(); }}>{a[0].toUpperCase() + a.slice(1)}</button>)}</div></div>
      )}
      <div className="row" style={{ marginTop: 12 }}>{rect && <button className="btn" onClick={() => { s.buildRot = (s.buildRot + 1) % 4; s.emit(); }}>Rotate (T)</button>}<button className="btn" onClick={() => s.setTool('select')}>Done</button></div>
    </Side>
  );
}

function Checklist() {
  const s = useStore();
  const w = s.world!;
  const zoned = w.zones.reduce((a, v) => a + (v ? 1 : 0), 0);
  const steps = [
    { done: w.net.edges.size > s.baseline.edges, text: 'Build a road', sub: 'Roads → pick Local Street → click start, click end. Join it to an existing road.', act: () => s.openDock('roads') },
    { done: zoned > s.baseline.zoned, text: 'Zone land beside it', sub: 'Zoning → drag a box next to the road, or use Layouts for ready-made complexes.', act: () => s.openDock('zones') },
    { done: w.buildings.size > s.baseline.buildings + 3, text: 'Watch buildings appear', sub: 'Make sure the game is playing (▶).', act: () => { s.sim?.setSpeed(1); s.emit(); } },
    { done: w.lines.size > 0, text: 'Start a bus route', sub: 'Transport → New bus route.', act: () => s.openDock('transit') },
  ];
  const next = steps.findIndex((x) => !x.done);
  return (
    <div className="panel tutorial" style={{ flexDirection: 'column', gap: 6, maxWidth: 330 }}>
      <div className="row space"><div className="tag">Getting started</div><button className="btn icon ghost sm" onClick={() => { s.checklistOpen = false; s.emit(); }}><Icon n="close" size={14} /></button></div>
      {steps.map((st, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-start', opacity: st.done || i === next ? 1 : 0.55 }}>
          <span className="chip" style={{ background: st.done ? 'var(--green)' : i === next ? 'var(--amber)' : undefined, color: st.done || i === next ? '#16130a' : undefined, minWidth: 24, justifyContent: 'center' }}>{st.done ? '✓' : i + 1}</span>
          <div className="grow"><b>{st.text}</b>{i === next && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{st.sub}</div>}{i === next && <button className="btn sm primary" style={{ marginTop: 6 }} onClick={st.act}>Show me</button>}</div>
        </div>
      ))}
      {next === -1 && <div className="good">Nice work — keep growing and watch the Mobility panel.</div>}
    </div>
  );
}

function Intro() {
  const s = useStore();
  const w = s.world!;
  return (
    <div className="panel tutorial">
      <div style={{ flex: 1 }}>
        <div className="tag">Welcome to {w.cityName}</div>
        <div style={{ fontSize: 16, fontWeight: 600, margin: '3px 0 6px' }}>You are designing an Indian city — and deciding how it moves.</div>
        <div className="muted" style={{ lineHeight: 1.5 }}>
          <b style={{ color: 'var(--text)' }}>1.</b> Draw a street (Roads) and tune its lanes, footpaths and bus lane.&nbsp;
          <b style={{ color: 'var(--text)' }}>2.</b> Zone land beside it (Zoning).&nbsp;
          <b style={{ color: 'var(--text)' }}>3.</b> Watch autos, scooters and buses appear, then add a bus route (Transport).
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary sm" onClick={() => { s.intro = false; s.openDock('roads'); }}>Start with a road</button>
          <button className="btn sm" onClick={() => { s.intro = false; s.panel = 'help'; s.emit(); }}>How to play</button>
          <button className="btn sm ghost" onClick={() => { s.intro = false; s.emit(); }}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

function Hints() {
  const s = useStore();
  const w = s.world!;
  if (!s.settings.hints) return null;
  let text: React.ReactNode = null;
  if (s.tool === 'road') {
    const d = s.roadDraft;
    if (d.pending) text = <>Review the cost, then <kbd>Enter</kbd> or press <b>Build</b>. Click elsewhere to move the end point.</>;
    else if (d.pts.length === 0) text = <>Click to start a road. <kbd>Shift</kbd> snaps angle. Connect to a road to make a junction.</>;
    else if (s.roadMode === 'curve' && d.pts.length === 1) text = <>Click to set the bend of the curve.</>;
    else text = <>Click to place the end. <kbd>Esc</kbd> to stop.</>;
  } else if (s.tool === 'zone') text = <>Drag a rectangle along a road to zone it. Needs power & water to grow.</>;
  else if (s.tool === 'busstop') text = <>Click a road to place a bus stop.</>;
  else if (s.tool === 'linepick') text = s.transitDraft?.family === 'bus' ? <>Click roads or existing stops, in order, to build the route. Click the last stop again to remove it.</> : <>Click stations in order to lay the line.</>;
  else if (s.tool === 'bulldoze') text = <>Click a building, stop or road to demolish it.</>;
  else if (s.tool === 'upgrade') text = <>Click a road to apply the current road design to it.</>;
  else if (s.tool === 'building') text = <>Click to place. <kbd>T</kbd> rotates.</>;
  else if (s.tool === 'layout') text = <>Click to place the whole layout beside a road. <kbd>T</kbd> rotates. Green = buildable.</>;
  else if (w.stats.population < 700 && w.day < 6 && s.dock === 'none' && !s.selection) text = <>Open <b>Roads</b> to draw a street, <b>Zoning</b> to grow homes and shops, and <b>Transport</b> to add buses. Right-drag to rotate · wheel to zoom.</>;
  if (!text) return null;
  return <div className="panel hint">{text}</div>;
}

function ConfirmBar() {
  const s = useStore();
  const d = s.roadDraft;
  if (s.tool !== 'road' || !d.pending || !d.plan) return null;
  const p = d.plan, w = s.world!;
  const ok = p.valid && p.cost <= w.money;
  return (
    <div className="panel confirm-bar">
      <div>
        <div className="cost">{fmtMoney(p.cost)}</div>
        <div className="dim" style={{ fontSize: 11.5 }}>{(p.length * 50).toFixed(0)} m{p.bridgeLen ? ` · bridge ${(p.bridgeLen * 50).toFixed(0)} m` : ''}{p.tunnelLen ? ` · tunnel ${(p.tunnelLen * 50).toFixed(0)} m` : ''} · max grade {(p.maxGrade * 100).toFixed(0)}%</div>
        {p.issues.map((x) => <div key={x} className="bad" style={{ fontSize: 12 }}>⚠ {x}</div>)}
        {p.cost > w.money && <div className="bad" style={{ fontSize: 12 }}>⚠ Not enough funds</div>}
        {p.warnings.map((x) => <div key={x} className="warn" style={{ fontSize: 12 }}>{x}</div>)}
      </div>
      <button className="btn" onClick={() => { s.roadDraft.pending = false; s.emit(); }}>Cancel</button>
      <button className="btn primary" disabled={!ok} onClick={() => s.view?.tools.confirm()}>Build ✓</button>
    </div>
  );
}
export { TRANSIT };
