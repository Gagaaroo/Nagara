import type { World } from '../game/world';
import { Build, ID, Zone } from '../game/types';
import { ZONE_INFO } from '../data/buildings';
import { clamp, sat } from '../utils/math';

export type OverlayKey =
  | 'none' | 'traffic' | 'speed' | 'popden' | 'jobden' | 'landvalue' | 'pollution' | 'noise' | 'pt' | 'walk' | 'bike' | 'freight' | 'ped'
  | 'buildable' | 'elevation' | 'slope' | 'zones' | 'power' | 'water' | 'lastmile' | 'flood';

export interface OverlayDef { key: OverlayKey; label: string; group: 'Mobility' | 'City' | 'Terrain' | 'Utilities'; low: string; high: string; stops: string[]; roads?: boolean; hint: string }

export const OVERLAYS: OverlayDef[] = [
  { key: 'traffic', label: 'Traffic', group: 'Mobility', low: 'Free flow', high: 'Gridlock', stops: ['#4fae6a', '#e9c24a', '#e07a3a', '#c4382f'], roads: true, hint: 'Volume ÷ capacity at the current hour' },
  { key: 'speed', label: 'Average speed', group: 'Mobility', low: 'Slow', high: 'At limit', stops: ['#c4382f', '#e07a3a', '#e9c24a', '#4fae6a'], roads: true, hint: 'Typical speed vs. speed limit' },
  { key: 'ped', label: 'Pedestrian activity', group: 'Mobility', low: 'Quiet', high: 'Busy', stops: ['#3a4d5c', '#4a9fb5', '#e9c24a', '#e8743b'], roads: true, hint: 'Footfall on each street' },
  { key: 'freight', label: 'Freight flow', group: 'Mobility', low: 'Light', high: 'Heavy', stops: ['#4a5560', '#c2a24a', '#e07a3a', '#c4382f'], roads: true, hint: 'Truck volume per street' },
  { key: 'pt', label: 'Public transport coverage', group: 'Mobility', low: 'None', high: 'Frequent', stops: ['#2b4a52', '#2fa89a', '#7fd6c2'], hint: 'Walking catchment of stops, weighted by frequency' },
  { key: 'walk', label: 'Walking accessibility', group: 'Mobility', low: 'Poor', high: 'Excellent', stops: ['#c4382f', '#e9c24a', '#4fae6a'], hint: 'Footpaths, amenities, slope' },
  { key: 'bike', label: 'Cycling accessibility', group: 'Mobility', low: 'Poor', high: 'Excellent', stops: ['#c4382f', '#e9c24a', '#4fae6a'], hint: 'Cycle lanes, terrain, safety' },
  { key: 'lastmile', label: 'Last-mile access', group: 'Mobility', low: 'Cut off', high: 'Connected', stops: ['#c4382f', '#e9c24a', '#4fae6a'], hint: 'Time to reach a transit node by walk, cycle or auto' },
  { key: 'popden', label: 'Population density', group: 'City', low: 'Sparse', high: 'Dense', stops: ['#3a3f55', '#7a63b8', '#d98adb', '#fbe3f3'], hint: 'Residents per tile' },
  { key: 'jobden', label: 'Job density', group: 'City', low: 'Few jobs', high: 'Job centre', stops: ['#33465a', '#3e8fd4', '#7fd0f0', '#e8f7ff'], hint: 'Jobs per tile' },
  { key: 'landvalue', label: 'Land value', group: 'City', low: 'Low', high: 'High', stops: ['#3b4a70', '#3e8f9a', '#e9c24a', '#f27a3a'], hint: 'Accessibility, services, TOD, minus nuisance' },
  { key: 'pollution', label: 'Air pollution', group: 'City', low: 'Clean', high: 'Smog', stops: ['#4fae6a', '#c2b24a', '#a0603a', '#4a2a28'], hint: 'Traffic, industry and freight, softened by trees' },
  { key: 'noise', label: 'Noise', group: 'City', low: 'Quiet', high: 'Loud', stops: ['#4fae6a', '#c2b24a', '#e07a3a', '#a02a4a'], hint: 'Roads, heavy vehicles, industry' },
  { key: 'zones', label: 'Zoning', group: 'City', low: '', high: '', stops: [], hint: 'Land-use zones' },
  { key: 'buildable', label: 'Buildability', group: 'Terrain', low: 'Buildable', high: 'Blocked', stops: ['#4fae6a', '#e9c24a', '#e07a3a', '#c4382f'], hint: 'Green easy · yellow difficult · orange expensive · red blocked' },
  { key: 'elevation', label: 'Elevation', group: 'Terrain', low: 'Low', high: 'High', stops: ['#4f8f6a', '#b9c06a', '#c9a15a', '#8d7a6a', '#f0eee8'], hint: 'Height with 10 m contours' },
  { key: 'slope', label: 'Slope', group: 'Terrain', low: 'Flat', high: 'Steep', stops: ['#4fae6a', '#e9c24a', '#e07a3a', '#c4382f'], hint: 'Gradient: affects cost, walking, cycling, vehicle speed' },
  { key: 'power', label: 'Power grid', group: 'Utilities', low: 'No power', high: 'Connected', stops: ['#c4382f', '#e9c24a', '#4fae6a'], hint: 'Coverage from plants & substations' },
  { key: 'water', label: 'Water supply', group: 'Utilities', low: 'None', high: 'Piped', stops: ['#c4382f', '#e9c24a', '#4a9fd4'], hint: 'Coverage from sources & towers' },
  { key: 'flood', label: 'Flooding', group: 'Utilities', low: 'Dry', high: 'Deep', stops: ['#2b4a6a', '#4a9fd4', '#9ad6f0'], hint: 'Stormwater stress in heavy rain' },
];
export const OVERLAY_BY_KEY = Object.fromEntries(OVERLAYS.map((o) => [o.key, o])) as Record<OverlayKey, OverlayDef>;

function hexRgb(h: string): [number, number, number] { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
export function ramp(stops: string[], t: number): [number, number, number] {
  t = clamp(t, 0, 1);
  const f = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]), u = f - i;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Colour for a road under a road-centric overlay (0..1 floats), or null for the default. */
export function roadOverlayColor(world: World, key: OverlayKey, id: ID): [number, number, number] | null {
  const e = world.net.edges.get(id);
  if (!e) return null;
  const def = OVERLAY_BY_KEY[key];
  let v = 0;
  if (key === 'traffic') { v = Math.max(e.flowVc?.[0] ?? 0, e.flowVc?.[1] ?? 0); v = clamp(v / 1.4, 0, 1); }
  else if (key === 'speed') { const lim = e.spec.speed || 1; v = clamp(Math.min(e.speedNow?.[0] ?? lim, e.speedNow?.[1] ?? lim) / lim, 0, 1); v = (v - 0.15) / 0.85; }
  else if (key === 'ped') v = clamp((e.stat?.ped ?? 0) / 140, 0, 1);
  else if (key === 'freight') v = clamp((e.stat?.truck ?? 0) / 40, 0, 1);
  else return null;
  const c = ramp(def.stops, v);
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

/** Fill an RGBA tile texture for the overlay. Returns true if the overlay has a terrain layer. */
export function fillOverlay(world: World, key: OverlayKey, data: Uint8ClampedArray): boolean {
  const n = world.n, t = world.terrain, F = world.fields, V = n + 1;
  const def = OVERLAY_BY_KEY[key];
  const put = (k: number, c: [number, number, number], a: number) => { data[k * 4] = c[0]; data[k * 4 + 1] = c[1]; data[k * 4 + 2] = c[2]; data[k * 4 + 3] = a; };
  data.fill(0);
  const field = (arr: Float32Array, scale = 1, minShow = 0.01, alpha = 190) => {
    for (let k = 0; k < n * n; k++) { const v = arr[k] * scale; if (v < minShow) continue; put(k, ramp(def.stops, v), alpha); }
  };
  switch (key) {
    case 'popden': field(F.popDen, 0.9, 0.03); break;
    case 'jobden': field(F.jobDen, 0.9, 0.03); break;
    case 'landvalue': for (let k = 0; k < n * n; k++) if (!t.waterKind[k]) put(k, ramp(def.stops, F.landValue[k] * 1.1), 150); break;
    case 'pollution': field(F.air, 1.7, 0.03); break;
    case 'noise': field(F.noise, 1.7, 0.03); break;
    case 'pt': field(F.pt, 1, 0.03, 175); break;
    case 'walk': for (let k = 0; k < n * n; k++) if (!t.waterKind[k] && (F.frontage[k] > 0 || F.popDen[k] > 0.05)) put(k, ramp(def.stops, F.walk[k]), 170); break;
    case 'bike': for (let k = 0; k < n * n; k++) if (!t.waterKind[k] && (F.frontage[k] > 0 || F.popDen[k] > 0.05)) put(k, ramp(def.stops, F.bike[k]), 170); break;
    case 'lastmile': for (let k = 0; k < n * n; k++) if (!t.waterKind[k] && (F.popDen[k] > 0.05 || F.jobDen[k] > 0.05)) put(k, ramp(def.stops, F.lastMile[k]), 185); break;
    case 'flood': for (let k = 0; k < n * n; k++) { const d = world.floodDepth[k]; if (d > 0.02) put(k, ramp(def.stops, d / 0.6), 180); } break;
    case 'power': for (let k = 0; k < n * n; k++) if (!t.waterKind[k] && (F.popDen[k] > 0.03 || F.jobDen[k] > 0.03 || world.zones[k])) put(k, ramp(def.stops, F.power[k] > 0 ? 1 : 0), 150); break;
    case 'water': for (let k = 0; k < n * n; k++) if (!t.waterKind[k] && (F.popDen[k] > 0.03 || F.jobDen[k] > 0.03 || world.zones[k])) put(k, ramp(def.stops, F.water[k] > 0 ? 1 : 0), 150); break;
    case 'buildable':
      for (let k = 0; k < n * n; k++) {
        if (t.waterKind[k]) { put(k, [74, 110, 160], 140); continue; }
        const b = t.build[k];
        put(k, ramp(def.stops, b === Build.Ok ? 0 : b === Build.Difficult ? 0.4 : b === Build.Expensive ? 0.7 : 1), t.protectedLand[k] ? 215 : 150);
      }
      break;
    case 'slope': for (let k = 0; k < n * n; k++) if (!t.waterKind[k]) put(k, ramp(def.stops, t.slope[k] / 0.3), 150); break;
    case 'elevation': {
      const hAt = (i: number, j: number) => (t.heights[j * V + i] + t.heights[j * V + i + 1] + t.heights[(j + 1) * V + i] + t.heights[(j + 1) * V + i + 1]) / 4;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const h = hAt(i, j);
        let c = ramp(def.stops, (h - 0) / 150);
        const band = Math.floor(h / 10);
        const edge = (i + 1 < n && Math.floor(hAt(i + 1, j) / 10) !== band) || (j + 1 < n && Math.floor(hAt(i, j + 1) / 10) !== band);
        if (edge) c = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];
        if (t.waterKind[k]) c = [60, 110, 160];
        put(k, c, 175);
      }
      break;
    }
    case 'zones':
      for (let k = 0; k < n * n; k++) { const z = world.zones[k] as Zone; if (!z) continue; const col = ZONE_INFO[z]?.color ?? 0x888888; put(k, [(col >> 16) & 255, (col >> 8) & 255, col & 255], world.buildGrid[k] ? 110 : 170); }
      break;
    default: return false;
  }
  return true;
}

export function mixColor(a: number, b: number, t: number) { return sat(t) * 0 + a + (b - a) * t; }
