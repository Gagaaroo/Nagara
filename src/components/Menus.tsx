import { useEffect, useRef, useState } from 'react';
import { useStore, defaultParams, Settings } from '../ui/store';
import { drawTerrainPreview, PreviewMode } from '../ui/terrainPreview';
import { MapParams, MAP_SIZES, Region, TerrainType, WATER_NAMES } from '../game/types';
import { TERRAIN_DESCRIPTIONS } from '../game/terrain/generate';
import { SLOTS, SaveMeta, getStore } from '../game/save/save';
import { Icon } from './Icon';
import { fmtMoney } from '../utils/math';

const TERRAINS: { k: TerrainType; n: string }[] = [
  { k: 'plains', n: 'Plains' }, { k: 'rolling', n: 'Rolling hills' }, { k: 'coastal', n: 'Coastal' }, { k: 'valley', n: 'River valley' }, { k: 'mountain', n: 'Mountain' }, { k: 'plateau', n: 'Plateau' },
];
const REGIONS: { k: Region; n: string; d: string }[] = [
  { k: 'south', n: 'South-inspired', d: 'Lush greenery, lakes, rolling terrain, strong monsoon. Tech-district friendly.' },
  { k: 'north', n: 'North-inspired', d: 'Continental vegetation, wider open land, dense urban districts.' },
  { k: 'west', n: 'West-inspired', d: 'Dry and warm landscape, dense development, coastal possibilities.' },
  { k: 'coastal', n: 'Coastal', d: 'Humid vegetation, beaches and waterfront development.' },
  { k: 'mountain', n: 'Mountain', d: 'Steep terrain, valleys and hillside development.' },
];

function MenuBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d')!;
    c.width = 640; c.height = 640;
    // an abstract street-grid motif drawn from a hash, not a real city
    ctx.fillStyle = '#151a18'; ctx.fillRect(0, 0, 640, 640);
    let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 90; i++) {
      const x = r() * 640, y = r() * 640, w = 20 + r() * 60, h = 14 + r() * 46;
      ctx.fillStyle = ['#2a3a31', '#31443a', '#243229', '#3a4a3c'][i % 4]; ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = '#f2b24a'; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
    for (const [a, b, c2, d] of [[0, 120, 640, 200], [120, 0, 260, 640], [0, 430, 640, 360], [470, 0, 400, 640]]) { ctx.beginPath(); ctx.moveTo(a, b); ctx.bezierCurveTo((a + c2) / 2, b - 60, (a + c2) / 2, d + 60, c2, d); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.strokeStyle = '#4a8fb5'; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(-10, 520); ctx.bezierCurveTo(200, 420, 420, 600, 660, 480); ctx.stroke();
    ctx.fillStyle = '#f2b24a'; for (const [x, y] of [[260, 200], [400, 360], [120, 430], [470, 100]]) { ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill(); }
  }, []);
  return <canvas ref={ref} />;
}

export function MainMenu() {
  const s = useStore();
  return (
    <div className="screen">
      <div className="menu-wrap">
        <div className="menu-left">
          <h1 className="menu-title">NAGARA</h1>
          <div className="menu-sub">City &amp; Mobility Simulator</div>
          <p className="menu-tag">Design a city. Design how it moves. Shape how people live.</p>
          <button className="menu-btn primary" onClick={() => { s.regenTerrain(); s.go('newcity'); }}>New City <small>generate a map</small></button>
          <button className="menu-btn" disabled={!s.hasAutosave} onClick={() => s.continueLatest()}>Continue <small>{s.hasAutosave ? 'latest save' : 'no saves yet'}</small></button>
          <button className="menu-btn" onClick={() => s.go('load')}>Load City <small>5 slots + autosave</small></button>
          <button className="menu-btn" onClick={() => { s.regenTerrain(); s.go('newcity'); }}>Map Generator <small>seeded terrain</small></button>
          <button className="menu-btn" onClick={() => s.go('settings')}>Settings</button>
          <div className="dim" style={{ marginTop: 22, fontSize: 11.5, maxWidth: 330, lineHeight: 1.5 }}>All cities are fictional. Terrain is deterministic: the same seed always draws the same land.</div>
        </div>
        <div className="menu-art"><MenuBackdrop /></div>
      </div>
    </div>
  );
}

export function MapGenerator() {
  const s = useStore();
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<PreviewMode>('terrain');
  const p = s.params;
  useEffect(() => { if (!s.previewTerrain) s.regenTerrain(); }, []);
  useEffect(() => { if (s.previewTerrain && ref.current) drawTerrainPreview(ref.current, s.previewTerrain, mode); }, [s.previewTerrain, mode, s.version]);
  const set = (patch: Partial<MapParams>) => { s.params = { ...s.params, ...patch }; s.regenTerrain(); };
  const t = s.previewTerrain;
  const wk = [0, 0, 0, 0, 0, 0];
  const bc = [0, 0, 0, 0];
  if (t) { t.waterKind.forEach((v) => wk[v]++); t.build.forEach((v) => bc[v]++); }
  const tot = t ? t.n * t.n : 1;
  const money = { lean: 'Lean ₹26 Cr', standard: 'Standard ₹46 Cr', rich: 'Generous ₹80 Cr' };
  return (
    <div className="screen">
      <div className="screen-head">
        <button className="btn" onClick={() => s.go('menu')}>← Back</button>
        <div><div className="brand" style={{ fontSize: 13 }}>NAGARA</div><div className="muted" style={{ fontSize: 12 }}>New city · Map generator</div></div>
        <div className="grow" />
        <button className="btn primary" onClick={() => s.startNew()}>Start city →</button>
      </div>
      <div className="gen-wrap">
        <div className="panel" style={{ padding: 16, alignSelf: 'start' }}>
          <div className="field">
            <label>Map seed <span className="val">same seed → same terrain</span></label>
            <div className="row">
              <input type="text" value={p.seed} onChange={(e) => set({ seed: e.target.value })} spellCheck={false} />
              <button className="btn icon" title="New random seed" onClick={() => s.randomSeed()}><Icon n="rotr" /></button>
            </div>
          </div>
          <div className="field"><label>Map size <span className="val">{MAP_SIZES[p.size]}×{MAP_SIZES[p.size]} tiles · {(MAP_SIZES[p.size] * 0.05).toFixed(1)} km</span></label>
            <div className="seg">{(['small', 'medium', 'large'] as const).map((z) => <button key={z} className={p.size === z ? 'on' : ''} onClick={() => set({ size: z })}>{z[0].toUpperCase() + z.slice(1)}</button>)}</div></div>
          <div className="field"><label>Terrain type</label>
            <div className="opt-grid">{TERRAINS.map((x) => <button key={x.k} className={'opt' + (p.terrain === x.k ? ' on' : '')} onClick={() => set({ terrain: x.k })}><b>{x.n}</b></button>)}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{TERRAIN_DESCRIPTIONS[p.terrain]}</div></div>
          <div className="field"><label>Regional flavour</label>
            <select value={p.region} onChange={(e) => set({ region: e.target.value as Region })}>{REGIONS.map((x) => <option key={x.k} value={x.k}>{x.n}</option>)}</select>
            <div className="muted" style={{ fontSize: 11.5 }}>{REGIONS.find((x) => x.k === p.region)!.d}</div></div>
          <div className="field"><label>Water amount <span className="val">{Math.round(p.water * 100)}%</span></label><input type="range" min={0} max={1} step={0.05} value={p.water} onChange={(e) => set({ water: +e.target.value })} /></div>
          <div className="field"><label>Mountain intensity <span className="val">{Math.round(p.mountains * 100)}%</span></label><input type="range" min={0} max={1} step={0.05} value={p.mountains} onChange={(e) => set({ mountains: +e.target.value })} /></div>
          <div className="field"><label>Forest density <span className="val">{Math.round(p.forest * 100)}%</span></label><input type="range" min={0} max={1} step={0.05} value={p.forest} onChange={(e) => set({ forest: +e.target.value })} /></div>
          <div className="row">
            <div className="field grow"><label>Initial resources</label><select value={p.resources} onChange={(e) => set({ resources: e.target.value as MapParams['resources'] })}>{Object.entries(money).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field grow"><label>Difficulty</label><select value={p.difficulty} onChange={(e) => set({ difficulty: e.target.value as MapParams['difficulty'] })}><option value="relaxed">Relaxed</option><option value="standard">Standard</option><option value="challenging">Challenging</option></select></div>
          </div>
          <label className="row" style={{ marginTop: 4, color: 'var(--muted)' }}><input type="checkbox" checked={p.sandbox} onChange={(e) => set({ sandbox: e.target.checked })} /> Sandbox: unlock everything from the start</label>
          <hr />
          <div className="row"><button className="btn" onClick={() => { s.params = { ...defaultParams() }; s.regenTerrain(); }}>Reset</button><button className="btn grow" onClick={() => s.randomSeed()}>Regenerate with new seed</button></div>
        </div>
        <div className="col">
          <div className="preview-box">
            <canvas ref={ref} />
            <div className="preview-legend"><span>● Settlement site</span><span style={{ color: '#7fb4d6' }}>● Regional road entry</span></div>
            <div style={{ position: 'absolute', top: 12, right: 12 }} className="seg">
              {(['terrain', 'elevation', 'buildable'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'buildable' ? 'Buildability' : m[0].toUpperCase() + m.slice(1)}</button>)}
            </div>
          </div>
          {t && (
            <div className="kpi" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="card"><div className="k">Name</div><div className="v" style={{ fontSize: 15 }}>{t.cityName}</div><div className="s">fictional city</div></div>
              <div className="card"><div className="k">Water</div><div className="v">{Math.round((1 - wk[0] / tot) * 100)}%</div><div className="s">{t.waterBodies.slice(0, 2).map((b) => WATER_NAMES[b.kind]).join(' · ') || 'none'}</div></div>
              <div className="card"><div className="k">Buildable</div><div className="v">{Math.round((bc[0] / tot) * 100)}%</div><div className="s">{Math.round(((bc[1] + bc[2]) / tot) * 100)}% hard · {Math.round((bc[3] / tot) * 100)}% blocked</div></div>
              <div className="card"><div className="k">Relief</div><div className="v">{Math.round(Math.max(...t.heights) - Math.min(...t.heights))} m</div><div className="s">low to high</div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SettingsScreen({ inGame = false, onClose }: { inGame?: boolean; onClose?: () => void }) {
  const s = useStore();
  const set = (p: Partial<Settings>) => s.setSettings(p);
  const body = (
    <div className="col" style={{ gap: 14 }}>
      <div className="field"><label>Render quality <span className="val">{Math.round(s.settings.renderScale * 100)}% resolution</span></label>
        <input type="range" min={0.5} max={1.5} step={0.25} value={s.settings.renderScale} onChange={(e) => { set({ renderScale: +e.target.value }); s.view?.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * +e.target.value); s.view?.resize(); }} /></div>
      <div className="field"><label>Traffic detail</label>
        <div className="seg">{(['low', 'medium', 'high'] as const).map((v) => <button key={v} className={s.settings.vehicleCap === v ? 'on' : ''} onClick={() => set({ vehicleCap: v })}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
        <span className="dim" style={{ fontSize: 11.5 }}>Caps visible vehicles and pedestrians. Underlying traffic demand is unchanged.</span></div>
      <label className="row"><input type="checkbox" checked={s.settings.confirmRoads} onChange={(e) => set({ confirmRoads: e.target.checked })} /> Review road cost before building (confirm step)</label>
      <label className="row"><input type="checkbox" checked={s.settings.autosave} onChange={(e) => set({ autosave: e.target.checked })} /> Autosave every month</label>
      <label className="row"><input type="checkbox" checked={s.settings.hints} onChange={(e) => set({ hints: e.target.checked })} /> Show guidance hints</label>
      <label className="row"><input type="checkbox" checked={s.debug} onChange={(e) => { s.debug = e.target.checked; s.emit(); }} /> Developer mode (debug panel)</label>
    </div>
  );
  if (inGame) return (
    <div className="modal-back" onClick={onClose}><div className="panel modal" onClick={(e) => e.stopPropagation()}>
      <div className="row space" style={{ marginBottom: 14 }}><h3>Settings</h3><button className="btn icon ghost" onClick={onClose}><Icon n="close" /></button></div>{body}</div></div>
  );
  return (
    <div className="screen">
      <div className="screen-head"><button className="btn" onClick={() => s.go('menu')}>← Back</button><h3>Settings</h3></div>
      <div className="panel" style={{ maxWidth: 520, margin: '26px auto', padding: 20 }}>{body}</div>
    </div>
  );
}

export function SaveList({ mode, onDone }: { mode: 'load' | 'save'; onDone?: () => void }) {
  const s = useStore();
  const [list, setList] = useState<SaveMeta[]>([]);
  const refresh = () => getStore().list().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);
  const slots = [...SLOTS, ...(mode === 'load' ? ['autosave'] : [])];
  return (
    <div>
      {slots.map((id) => {
        const m = list.find((x) => x.id === id);
        return (
          <div className="slot" key={id}>
            <div className="grow"><b>{id === 'autosave' ? 'Autosave' : `Slot ${id.slice(4)}`}</b>
              <span>{m ? `${m.city} · ${m.pop.toLocaleString('en-IN')} citizens · day ${m.day} · ${fmtMoney(m.money)} · ${new Date(m.savedAt).toLocaleString()}` : 'Empty'}</span></div>
            {mode === 'save' ? <button className="btn sm primary" onClick={async () => { await s.saveTo(id, `${s.world!.cityName}`); refresh(); s.flash('City saved'); }}>Save</button>
              : <button className="btn sm green" disabled={!m} onClick={() => { s.loadFrom(id); onDone?.(); }}>Load</button>}
            {m && id !== 'autosave' && <button className="btn sm icon danger" title="Delete" onClick={async () => { await getStore().remove(id); refresh(); }}><Icon n="trash" size={14} /></button>}
          </div>
        );
      })}
    </div>
  );
}

export function LoadScreen() {
  const s = useStore();
  return (
    <div className="screen">
      <div className="screen-head"><button className="btn" onClick={() => s.go('menu')}>← Back</button><h3>Load city</h3></div>
      <div style={{ maxWidth: 640, margin: '26px auto', padding: '0 16px' }}><SaveList mode="load" /></div>
    </div>
  );
}
