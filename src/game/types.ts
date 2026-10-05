/** Shared entity & enum types for NAGARA. Every entity has a unique numeric ID. */
export type ID = number;

/** One tile is this many metres on the ground (used for all real-unit calculations). */
export const TILE_M = 50;
/** Elevation (m) → world-space height. Exaggerated so terrain reads well. */
export const HEIGHT_SCALE = 0.05;

// ───────────── Map generation ─────────────
export type MapSize = 'small' | 'medium' | 'large';
export type TerrainType = 'plains' | 'rolling' | 'coastal' | 'valley' | 'mountain' | 'plateau';
export type Region = 'south' | 'north' | 'west' | 'coastal' | 'mountain';
export type Difficulty = 'relaxed' | 'standard' | 'challenging';
export type Resources = 'lean' | 'standard' | 'rich';

export interface MapParams {
  seed: string;
  size: MapSize;
  terrain: TerrainType;
  region: Region;
  water: number; // 0..1
  mountains: number; // 0..1
  forest: number; // 0..1
  resources: Resources;
  difficulty: Difficulty;
  sandbox: boolean; // unlock everything
}

export const MAP_SIZES: Record<MapSize, number> = { small: 96, medium: 128, large: 176 };

export type WaterKind = 0 | 1 | 2 | 3 | 4 | 5; // none, river, lake, pond, reservoir, sea
export const WATER_NAMES = ['Land', 'River', 'Lake', 'Pond', 'Reservoir', 'Sea'];

export interface WaterBody {
  id: ID;
  kind: WaterKind;
  tiles: number;
  cx: number;
  cy: number;
  level: number;
  name: string;
}

export interface Terrain {
  n: number; // tiles per side
  params: MapParams;
  seedNum: number;
  heights: Float32Array; // (n+1)^2 vertex elevations, metres
  baseHeights: Float32Array; // pristine copy, for save diffs
  waterLevel: Float32Array; // (n+1)^2, -1e9 when dry
  waterKind: Uint8Array; // n*n
  slope: Float32Array; // n*n gradient (rise/run)
  forest: Uint8Array; // n*n 0..255
  protectedLand: Uint8Array; // n*n
  build: Uint8Array; // n*n buildability class
  waterBodies: WaterBody[];
  start: { x: number; y: number };
  entry: { x: number; y: number; side: number }; // regional connection point at map edge
  cityName: string;
}

/** Buildability classes. */
export const enum Build { Ok = 0, Difficult = 1, Expensive = 2, No = 3 }

// ───────────── Roads ─────────────
export type RoadCategory = 'local' | 'collector' | 'arterial' | 'highway' | 'freight' | 'transit' | 'service';
export type Median = 'none' | 'painted' | 'raised' | 'landscaped' | 'barrier';
export type Sidewalk = 'none' | 'narrow' | 'standard' | 'wide';
export type BikeInfra = 'none' | 'shared' | 'painted' | 'protected' | 'track';
export type Parking = 'none' | 'parallel' | 'angled';
export type BusInfra = 'none' | 'shared' | 'dedicated' | 'busonly';
export type Surface = 'asphalt' | 'concrete' | 'decorative';
export type DrainType = 'none' | 'open' | 'covered' | 'storm';
export type Structure = 'ground' | 'elevated' | 'depressed' | 'bridge' | 'tunnel';
export type StructureMode = 'auto' | 'ground' | 'elevated' | 'depressed' | 'bridge' | 'tunnel';
export type TruckPolicy = 'allowed' | 'banned' | 'priority';

export interface RoadSpec {
  name: string;
  category: RoadCategory;
  lanesFwd: number;
  lanesBwd: number; // 0 → one-way
  speed: number; // kph limit
  median: Median;
  sidewalk: Sidewalk;
  bike: BikeInfra;
  parking: Parking;
  bus: BusInfra;
  lights: boolean;
  trees: boolean;
  benches: boolean;
  signs: boolean;
  surface: Surface;
  drain: DrainType;
  trucks: TruckPolicy;
}

export type NodeControl = 'auto' | 'none' | 'priority' | 'signal' | 'roundabout';
/** Bit flags for banned manoeuvres from an approach edge. */
export const TURN_LEFT = 1, TURN_RIGHT = 2, TURN_STRAIGHT = 4, TURN_U = 8;

export interface RoadNode {
  id: ID;
  x: number;
  y: number;
  z: number; // metres
  control: NodeControl;
  crossings: boolean;
  busPriority: boolean;
  turnLanes: boolean;
  cycle: number; // signal cycle seconds
  mainShare: number; // share of green given to the major approach 0.3..0.7
  banned: Record<number, number>; // edgeId → bitmask
  edges: ID[];
  // runtime
  resolved?: 'none' | 'priority' | 'signal' | 'roundabout';
  occupancy?: number;
  delay?: number;
  queue?: number;
}

export interface RoadEdge {
  id: ID;
  a: ID;
  b: ID;
  spec: RoadSpec;
  structure: Structure;
  pts: number[]; // x0,y0,x1,y1,… in tile units
  zs: number[]; // elevation (m) per point, road surface
  cum: number[]; // cumulative length per point (tiles)
  len: number; // tiles
  cost: number; // build cost, lakh
  built: number; // game day
  // runtime caches (not saved)
  width?: number;
  cap?: number; // veh/h per direction (PCE)
  vol?: Float32Array; // daily assigned volume [dir][mode] → see MODE_INDEX
  flowVc?: [number, number]; // current v/c per direction
  speedNow?: [number, number]; // kph per direction
  tt?: [number, number]; // travel time (s) per direction
  lanes?: Vehicle[][];
  heading?: number;
  stat?: EdgeStat;
}

export interface EdgeStat {
  car: number; two: number; auto: number; bus: number; truck: number; ped: number; bike: number; // per hour now
  busLines: number;
  total: number;
}

// ───────────── Vehicles ─────────────
export type VehicleKind =
  | 'car' | 'taxi' | 'motorcycle' | 'scooter' | 'auto' | 'bicycle'
  | 'bus' | 'ebus' | 'artibus' | 'minibus'
  | 'lorry' | 'container' | 'tanker' | 'construction' | 'minitruck' | 'van'
  | 'ambulance' | 'fire' | 'police';

export type Mode = 'walk' | 'cycle' | 'two' | 'car' | 'auto' | 'bus' | 'metro' | 'rail';
export const MODES: Mode[] = ['walk', 'cycle', 'two', 'car', 'auto', 'bus', 'metro', 'rail'];

export interface Vehicle {
  id: ID;
  kind: VehicleKind;
  route: number[]; // edge ids
  routeDir: number[]; // 0 fwd, 1 bwd per edge
  ri: number; // index into route
  s: number; // distance along current edge (tiles) in direction of travel
  v: number; // tiles/s
  lane: number; // index into edge.lanes
  sub: number; // lateral sub-lane for two-wheelers
  vmax: number;
  len: number; // tiles
  color: number;
  state: 'drive' | 'dwell' | 'wait';
  dwell: number;
  heavy: boolean;
  lineId: ID;
  stopIdx: number;
  age: number;
  // render
  x: number; y: number; z: number; ang: number;
  waitTime: number;
  purpose: number;
  stamp: number;
  variant: number;
  lat: number;
  boxNode: ID;
  boxLeft: number;
  emergency: boolean;
  stopS: number; // distance the vehicle must reach before dwell (buses)
  trip: number; // origin trip tag
}

// ───────────── Land use & buildings ─────────────
export type ZoneType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const enum Zone { None = 0, ResLow = 1, ResMed = 2, ResHigh = 3, Commercial = 4, Mixed = 5, Industrial = 6, Office = 7 }

export type BuildingCategory =
  | 'res' | 'com' | 'mixed' | 'ind' | 'office' | 'market' | 'service' | 'utility' | 'culture' | 'landmark' | 'transit' | 'park' | 'logistics';

export interface Building {
  id: ID;
  def: string; // key into BUILDING_DEFS
  x: number; // anchor tile
  y: number;
  w: number;
  h: number;
  rot: number; // 0..3
  zone: Zone;
  level: number; // floors
  variant: number; // visual seed
  wealth: number; // 0 low,1 mid,2 high
  built: number; // game day started
  progress: number; // 0..1 construction
  residents: number;
  jobs: number;
  workers: number;
  access: ID; // nearest edge id
  accessS: number;
  ax: number; ay: number; // access point on road
  powered: boolean;
  watered: boolean;
  abandoned: boolean;
  unserved: number; // days without power/water
  name: string;
  // service runtime
  load: number;
}

export interface Citizen {
  id: ID;
  home: ID;
  members: number;
  earners: number;
  students: number;
  wealth: number;
  work: ID;
  school: ID;
  shop: ID;
  hasCar: boolean;
  hasTwo: boolean;
  commuteMode: Mode;
  schoolMode: Mode;
  leisureMode: Mode;
  commuteMin: number;
  commuteKm: number;
  happy: number;
  reach: boolean; // false when no road connects home and destination
}

import type { LineRuntime } from './transportation/transit';

// ───────────── Transit ─────────────
export type TransitMode = 'bus' | 'ebus' | 'artibus' | 'minibus' | 'metro' | 'suburban' | 'regional' | 'freightrail';
export type Alignment = 'elevated' | 'surface' | 'underground';

export interface TransitStop {
  id: ID;
  kind: 'bus' | 'terminal' | 'metro' | 'suburban' | 'regional';
  x: number;
  y: number;
  edge: ID; // road edge for bus stops, 0 for stations
  s: number;
  name: string;
  shelter: boolean;
  alignment: Alignment;
  waiting: number;
  boarded: number; // lifetime
  building: ID; // station building id
}

export interface TransitLine {
  id: ID;
  name: string;
  mode: TransitMode;
  color: number;
  stops: ID[];
  active: boolean;
  headwayMin: number;
  vehicles: number;
  depot: ID;
  path: number[]; // polyline x,y (tiles) one direction, full out-and-back handled by sim
  pathZ: number[];
  edges: number[]; // road edge ids (bus) per path segment
  edgeDir: number[];
  stopPos: number[]; // distance along path for each stop
  alignment: Alignment;
  lengthTiles: number;
  riders: number; // monthly riders
  ridersToday: number;
  revenue: number;
  cost: number;
  loadFactor: number;
  segAlign: Alignment[]; // per leg between stations (rail only)
  rt?: LineRuntime;
}

export interface Vendor { id: ID; x: number; y: number; ang: number; kind: number; edge: ID }

export interface Utility { id: ID }
export interface District { id: ID; name: string; x: number; y: number; r: number; kind: string }

export const GAME_START = { year: 2026, month: 2, day: 1 }; // month 0-based → March
