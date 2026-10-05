import { RoadCategory, RoadSpec, Structure } from '../types';
import { clamp } from '../../utils/math';

/** Lane width in tile units. Slightly exaggerated so streets read at city zoom. */
export const LANE_W = 0.16;

export const SIDEWALK_W = { none: 0, narrow: 0.1, standard: 0.17, wide: 0.3 } as const;
export const MEDIAN_W = { none: 0, painted: 0.04, raised: 0.1, landscaped: 0.22, barrier: 0.07 } as const;
export const BIKE_W = { none: 0, shared: 0, painted: 0.09, protected: 0.13, track: 0.17 } as const;
export const PARK_W = { none: 0, parallel: 0.14, angled: 0.24 } as const;

export const OPTIONS = {
  median: ['none', 'painted', 'raised', 'landscaped', 'barrier'],
  sidewalk: ['none', 'narrow', 'standard', 'wide'],
  bike: ['none', 'shared', 'painted', 'protected', 'cycle track'.replace('cycle ', '')],
  parking: ['none', 'parallel', 'angled'],
  bus: ['none', 'shared', 'dedicated', 'busonly'],
  surface: ['asphalt', 'concrete', 'decorative'],
  drain: ['none', 'open', 'covered', 'storm'],
  trucks: ['allowed', 'banned', 'priority'],
} as const;

export const LABELS: Record<string, string> = {
  none: 'None', painted: 'Painted', raised: 'Raised', landscaped: 'Landscaped', barrier: 'Barrier',
  narrow: 'Narrow', standard: 'Standard', wide: 'Wide', shared: 'Shared road', protected: 'Protected lane', track: 'Cycle track',
  parallel: 'Parallel', angled: 'Angled', dedicated: 'Dedicated lane', busonly: 'Bus-only street',
  asphalt: 'Asphalt', concrete: 'Concrete', decorative: 'Decorative', open: 'Open drain', covered: 'Covered drain', storm: 'Stormwater',
  allowed: 'Allowed', banned: 'Banned', priority: 'Freight priority',
};

export function laneCount(s: RoadSpec) { return s.lanesFwd + s.lanesBwd; }
export function isOneWay(s: RoadSpec) { return s.lanesBwd === 0; }

export function carriagewayWidth(s: RoadSpec) { return laneCount(s) * LANE_W; }

/** Half-width of the carriageway (incl. median) from the centreline. */
export function carriageHalf(s: RoadSpec): number {
  if (s.lanesBwd === 0 || s.lanesFwd === 0) return laneCount(s) * LANE_W / 2;
  return MEDIAN_W[s.median] / 2 + Math.max(s.lanesFwd, s.lanesBwd) * LANE_W;
}

/** Total cross-section width in tile units. */
export function roadWidth(s: RoadSpec): number {
  const side = SIDEWALK_W[s.sidewalk] + BIKE_W[s.bike] + PARK_W[s.parking] + (s.drain === 'open' ? 0.04 : 0);
  return carriageHalf(s) * 2 + side * 2;
}

/** Lateral offset (to the left of travel) of lane j (0 = kerb lane) in a direction. */
export function laneOffset(s: RoadSpec, dir: number, j: number): number {
  const nDir = dir === 0 ? s.lanesFwd : s.lanesBwd;
  if (s.lanesBwd === 0 || s.lanesFwd === 0) return (nDir / 2 - 0.5 - j) * LANE_W;
  return MEDIAN_W[s.median] / 2 + (nDir - j - 0.5) * LANE_W;
}

export function inferCategory(s: RoadSpec): RoadCategory {
  if (s.name.toLowerCase().includes('service')) return 'service';
  if (s.trucks === 'priority') return 'freight';
  if (s.speed >= 80) return 'highway';
  if ((s.bus === 'dedicated' || s.bus === 'busonly') && s.speed >= 40 && laneCount(s) >= 5) return 'transit';
  const perDir = Math.max(s.lanesFwd, s.lanesBwd);
  if (perDir >= 3 || (perDir >= 2 && s.speed >= 55)) return 'arterial';
  if (perDir >= 2 || s.speed >= 40) return 'collector';
  return 'local';
}

export const CATEGORY_RANK: Record<RoadCategory, number> = { local: 0, service: 0, collector: 1, transit: 2, freight: 2, arterial: 2, highway: 3 };
export const CATEGORY_LABEL: Record<RoadCategory, string> = {
  local: 'Local street', collector: 'Collector', arterial: 'Arterial', highway: 'Highway', freight: 'Freight corridor', transit: 'Transit corridor', service: 'Service road',
};
export const CATEGORY_HINT: Record<RoadCategory, string> = {
  local: 'Low traffic, access to homes and shops.',
  collector: 'Connects neighbourhoods to arterials.',
  arterial: 'High-capacity urban road. Keep side streets few.',
  highway: 'Regional movement. Noisy; keep away from homes.',
  freight: 'Heavy vehicle spine. Separates trucks from housing.',
  transit: 'Priority corridor for buses and mass transit.',
  service: 'Back-access lane for deliveries and parking.',
};

const base = (o: Partial<RoadSpec>): RoadSpec => ({
  name: 'Road', category: 'local', lanesFwd: 1, lanesBwd: 1, speed: 30, median: 'none', sidewalk: 'standard', bike: 'none', parking: 'none', bus: 'none',
  lights: true, trees: false, benches: false, signs: false, surface: 'asphalt', drain: 'open', trucks: 'allowed', ...o,
});

export const PRESETS: RoadSpec[] = [
  base({ name: 'Local Street', lanesFwd: 1, lanesBwd: 1, speed: 30, sidewalk: 'narrow', bike: 'shared', parking: 'parallel', drain: 'open', trees: true }),
  base({ name: 'Neighbourhood Lane', lanesFwd: 1, lanesBwd: 0, speed: 20, sidewalk: 'narrow', bike: 'shared', drain: 'open', trucks: 'banned' }),
  base({ name: 'Collector Road', lanesFwd: 1, lanesBwd: 1, speed: 40, median: 'painted', sidewalk: 'standard', bike: 'painted', parking: 'parallel', trees: true, drain: 'covered' }),
  base({ name: 'Urban Avenue', lanesFwd: 3, lanesBwd: 3, speed: 50, median: 'landscaped', sidewalk: 'wide', bike: 'protected', bus: 'dedicated', trees: true, benches: true, signs: true, drain: 'covered' }),
  base({ name: 'Arterial Road', lanesFwd: 3, lanesBwd: 3, speed: 60, median: 'raised', sidewalk: 'standard', bike: 'painted', trees: true, signs: true, drain: 'covered' }),
  base({ name: 'Transit Corridor', lanesFwd: 3, lanesBwd: 3, speed: 50, median: 'raised', sidewalk: 'wide', bike: 'track', bus: 'dedicated', trees: true, benches: true, signs: true, drain: 'storm', trucks: 'banned' }),
  base({ name: 'Freight Corridor', lanesFwd: 2, lanesBwd: 2, speed: 60, median: 'barrier', sidewalk: 'none', surface: 'concrete', trucks: 'priority', drain: 'open', signs: true }),
  base({ name: 'Industrial Road', lanesFwd: 2, lanesBwd: 2, speed: 40, median: 'painted', sidewalk: 'narrow', surface: 'concrete', trucks: 'allowed', drain: 'open' }),
  base({ name: 'Highway', lanesFwd: 3, lanesBwd: 3, speed: 100, median: 'barrier', sidewalk: 'none', lights: true, signs: true, drain: 'open', trucks: 'allowed' }),
  base({ name: 'Service Road', lanesFwd: 1, lanesBwd: 1, speed: 25, sidewalk: 'narrow', parking: 'angled', trucks: 'allowed' }),
  base({ name: 'Bus-Only Street', lanesFwd: 1, lanesBwd: 1, speed: 30, sidewalk: 'wide', bus: 'busonly', surface: 'decorative', trees: true, benches: true, trucks: 'banned', drain: 'covered' }),
].map((s) => ({ ...s, category: inferCategory(s) }));

export function finalizeSpec(s: RoadSpec): RoadSpec {
  const o = { ...s };
  o.lanesFwd = clamp(Math.round(o.lanesFwd), 1, 5);
  o.lanesBwd = clamp(Math.round(o.lanesBwd), 0, 5);
  o.speed = clamp(Math.round(o.speed / 5) * 5, 10, 120);
  if (o.bus === 'busonly') o.trucks = 'banned';
  o.category = inferCategory(o);
  return o;
}

export function cloneSpec(s: RoadSpec): RoadSpec { return { ...s }; }

/** Lanes in the given travel direction usable by general traffic. */
export function generalLanes(s: RoadSpec, dir: number): number {
  const lanes = dir === 0 ? s.lanesFwd : s.lanesBwd;
  if (lanes === 0) return 0;
  if (s.bus === 'busonly') return 0;
  if (s.bus === 'dedicated') return Math.max(1, lanes - 1);
  return lanes;
}

/** Hourly capacity per direction in passenger-car equivalents. */
export function capacityDir(s: RoadSpec, dir: number): number {
  const gl = generalLanes(s, dir);
  if (gl === 0 && (dir === 0 ? s.lanesFwd : s.lanesBwd) === 0) return 0;
  const perLane = clamp(480 + 6 * s.speed, 600, 1300);
  let f = 1;
  f -= s.parking === 'parallel' ? 0.12 : s.parking === 'angled' ? 0.22 : 0;
  if (s.sidewalk === 'none' && s.speed <= 60) f -= 0.1; // pedestrians spill onto the carriageway
  f -= s.bike === 'shared' ? 0.05 : 0;
  f -= s.bus === 'shared' ? 0.05 : 0;
  if (s.median === 'none' && laneCount(s) >= 4) f -= 0.08;
  if (s.median === 'raised' || s.median === 'landscaped' || s.median === 'barrier') f += 0.05;
  if (s.surface === 'decorative') f -= 0.03;
  const lanes = Math.max(gl, s.bus === 'busonly' ? 1 : 0);
  return Math.max(0, perLane * lanes * clamp(f, 0.5, 1.1));
}

/** Lakh ₹ per tile, before terrain/structure multipliers. */
export function costPerTile(s: RoadSpec): number {
  const speedClass = 1 + Math.max(0, s.speed - 40) / 60;
  let c = laneCount(s) * 1.5 * speedClass;
  c += ({ none: 0, narrow: 0.4, standard: 0.7, wide: 1.2 } as const)[s.sidewalk] * 2;
  c += ({ none: 0, painted: 0.1, raised: 0.5, landscaped: 0.9, barrier: 0.6 } as const)[s.median];
  c += ({ none: 0, shared: 0.05, painted: 0.3, protected: 0.9, track: 1.4 } as const)[s.bike] * 2;
  c += ({ none: 0, parallel: 0.4, angled: 0.6 } as const)[s.parking] * 2;
  c += ({ none: 0, shared: 0.1, dedicated: 0.5, busonly: 0.4 } as const)[s.bus] * 2;
  c += (s.lights ? 0.3 : 0) + (s.trees ? 0.25 : 0) + (s.benches ? 0.1 : 0) + (s.signs ? 0.08 : 0);
  c += ({ none: 0, open: 0.2, covered: 0.55, storm: 1.0 } as const)[s.drain];
  c *= ({ asphalt: 1, concrete: 1.35, decorative: 1.8 } as const)[s.surface];
  return c;
}

export const STRUCTURE_COST: Record<Structure, number> = { ground: 1, elevated: 3, depressed: 2.4, bridge: 4, tunnel: 8 };
export const STRUCTURE_CAP: Record<Structure, number> = { ground: 1, elevated: 1, depressed: 1, bridge: 0.95, tunnel: 0.9 };

/** 0..1 pedestrian friendliness of a street cross-section. */
export function walkScore(s: RoadSpec): number {
  let v = ({ none: 0.08, narrow: 0.45, standard: 0.75, wide: 1 } as const)[s.sidewalk];
  if (s.speed > 50) v -= 0.15;
  if (s.speed > 70) v -= 0.25;
  if (s.trees) v += 0.06;
  if (s.benches) v += 0.04;
  if (s.bus === 'busonly') v += 0.15;
  if (s.drain === 'open') v -= 0.04;
  return clamp(v, 0, 1);
}

/** 0..1 cycling friendliness. */
export function bikeScore(s: RoadSpec): number {
  let v = ({ none: s.speed <= 30 ? 0.35 : 0.1, shared: s.speed <= 40 ? 0.45 : 0.2, painted: 0.65, protected: 0.88, track: 1 } as const)[s.bike];
  if (s.speed > 50 && s.bike !== 'protected' && s.bike !== 'track') v -= 0.2;
  if (s.parking !== 'none' && s.bike === 'painted') v -= 0.1;
  if (s.bus === 'busonly') v += 0.2;
  return clamp(v, 0, 1);
}

/** Relative noise/pollution intensity of road per vehicle. */
export function roadNoiseFactor(s: RoadSpec): number {
  return clamp(0.4 + s.speed / 90 - (s.trees ? 0.1 : 0) - (s.median === 'landscaped' ? 0.1 : 0), 0.3, 1.5);
}

export function describeSpec(s: RoadSpec): string {
  const dir = isOneWay(s) ? `${s.lanesFwd}-lane one-way` : s.lanesFwd === s.lanesBwd ? `${s.lanesFwd}+${s.lanesBwd} lanes` : `${s.lanesFwd}/${s.lanesBwd} lanes`;
  return `${dir} · ${s.speed} km/h`;
}
