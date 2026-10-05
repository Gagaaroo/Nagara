# NAGARA — City & Mobility Simulator

> Design a city. Design how it moves. Shape how people live.

NAGARA is an original browser city-builder where **transportation design is the game**: you draw streets lane by lane,
tune intersections, run buses, auto-rickshaws and metro lines, separate freight from homes, and watch a believable, mixed
Indian-style traffic stream respond to every decision. All cities, signage and buildings are fictional.

**Stack:** React 18 · TypeScript · Vite · Three.js. No other runtime dependencies.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + production build
npm run sim:test     # headless simulation smoke test (no browser needed)
npx tsx scripts/autoplay.ts Kaveri-2026 medium rolling 40   # scripted "player" for balance checks
npx tsx scripts/fuzz.ts 3                                   # random-action fuzz test of the command layer
```

## Playing

1. **New City** → configure the map (seed, size, terrain, region flavour, water, mountains, forest, funds, difficulty).
   The same seed always draws the same land. Preview terrain, elevation or buildability, regenerate with a new seed, start.
2. **Roads** → pick a type, tune it in the **Road designer** (lanes each way, one-way, speed, median, footpath, cycle lane,
   parking, bus lane, furniture, surface, drains, truck policy), preview the cost, confirm. Save your own **templates**.
3. **Zoning** → drag rectangles beside roads. Buildings only grow where roads, power and water reach.
4. **Transport** → bus stops, depots, terminals, auto stands, a 7-step **bus route** wizard, then metro / rail when unlocked.
5. **Inspect** any road (volume, capacity, speed, bus/freight/pedestrian use) or intersection (signals, roundabout, turn bans).
6. Open **Mobility** for modal split, last-mile accessibility, bottlenecks and plain-language planning insights.

Controls: wheel zoom · right-drag rotate/tilt · middle/Shift-drag pan · WASD/arrows pan · Q/E rotate · R/F tilt ·
Space pause · 1/2/3 speed · Esc cancel · Enter confirm · T rotate building.

## Progression

| Citizens | Unlocks |
|---|---|
| 500 | Local roads, collectors, houses, shops, autos, two-wheelers, a bus depot |
| 3,000 | Arterials, avenues, college, signals/roundabouts (1,500) |
| 10,000 | Highways, university, business parks, bus terminals, traffic management |
| 25,000 | Metro, IT towers, high-density towers, transit corridors, underground utilities |
| 35,000 / 50,000+ | Suburban rail / regional rail, logistics hubs, major landmarks |

Tick **Sandbox** in the map generator (or use the debug panel) to unlock everything.

## How the simulation works

* **Terrain** (`src/game/terrain`): seeded simplex fractal noise, ridged mountains, plateau terracing, carved river valleys,
  lakes, ponds, reservoirs and coastlines; per-tile slope and buildability (water, steepness, protected land).
* **Roads** (`src/game/roads`): a node/edge graph of polylines. Placement auto-splits at crossings, picks bridges over water
  and tunnels through hills, limits grade, and cuts-and-fills the terrain. Cost depends on cross-section, slope and structure.
* **Demand** (`src/game/transportation/demand.ts`): citizen households have homes, jobs, schools and shops. Each trip is routed
  with congested A\*, then mode choice (walk, cycle, two-wheeler, car, auto, bus, metro, rail) is a logit over real route times,
  costs, footpath/cycle quality, slope, rain, parking, auto-stand coverage and transit access (walk/auto/cycle last-mile).
  Volumes feed a BPR-style speed model per road direction, per hour of day.
* **Traffic** (`src/game/traffic`): left-hand traffic, car following (Krauss), lane changes, signals with phases, priority and
  roundabouts, two-wheeler filtering, auto roadside pickups, buses that dwell at stops, freight, emergency vehicles, pedestrians,
  trains. Visible vehicles are a sample of aggregate demand (aggregated simulation; sampling factor shown in debug).
* **City systems**: zoned growth with TOD and land-value-driven density, power & water coverage, services, pollution, noise,
  weather with monsoon seasonality and flooding, budget, happiness, sprawl.
* **Saves** (`src/game/save`): versioned JSON in IndexedDB behind a `SaveStore` interface so a backend can replace it.

## Layout

```
src/
  game/            simulation, independent of rendering
    terrain/ roads/ transportation/ traffic/ population/ economy/ weather/ simulation/ save/
  rendering/       Three.js views (terrain, roads, buildings, vehicles, overlays, camera, tools)
  components/      React UI (menus, HUD, designers, inspectors, dashboards)
  ui/              store + styles
  data/            building catalogue, names
```

The developer toggle (Settings → Developer mode) shows FPS, simulation time, vehicle / pedestrian counts, traffic and
pathfinding statistics, active routes and population.
