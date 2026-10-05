import * as THREE from 'three';
import type { Store } from '../ui/store';
import type { World } from '../game/world';
import { HEIGHT_SCALE, RoadSpec } from '../game/types';
import { CameraRig } from './camera';
import { TerrainView } from './terrainView';
import { RoadView } from './roadView';
import { BuildingView } from './buildingView';
import { VehicleView, FurnitureView } from './vehicleView';
import { TransitView, SelectionView, PreviewView } from './overlayViews';
import { OVERLAY_BY_KEY, OverlayKey, fillOverlay, roadOverlayColor } from './overlays';
import { ToolController, Pick } from './tools';
import { windowTexture } from './meshBuilder';
import { roadWidth } from '../game/roads/spec';
import { heightAt } from '../game/terrain/query';
import { clamp, smoothstep } from '../utils/math';
import { DEFS } from '../data/buildings';

const HS = HEIGHT_SCALE;

export class GameView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig: CameraRig;
  terrain: TerrainView;
  roads: RoadView;
  buildings: BuildingView;
  vehicles: VehicleView;
  furniture: FurnitureView;
  transit: TransitView;
  selection: SelectionView;
  preview: PreviewView;
  tools: ToolController;
  world: World;
  hemi = new THREE.HemisphereLight(0xbfd6ee, 0x6b7f5a, 0.6);
  sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
  buildMat: THREE.MeshStandardMaterial;
  roadMat: THREE.MeshStandardMaterial;
  rain: THREE.LineSegments;
  rainPos: Float32Array;
  overlayTex: THREE.DataTexture | null = null;
  overlayData: Uint8ClampedArray;
  overlayKey: OverlayKey = 'none';
  overlayTimer = 0;
  lastPick: Pick | null = null;
  raf = 0;
  last = performance.now();
  time = 0;
  fps = 60;
  fpsAcc = 0; fpsN = 0;
  roadsDirty = true; buildingsDirty = true; zonesDirty = true;
  treeTimer = 0;
  viewModeApplied = '';
  hoverKey = '';
  private dragging: 'none' | 'rotate' | 'pan' | 'left' = 'none';
  private downPos = { x: 0, y: 0 };
  private moved = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private resizeObs: ResizeObserver;
  private disposed = false;
  private hoverTimer = 0;
  private cleanup: (() => void)[] = [];
  private lastTerrainVer = -1;

  constructor(public container: HTMLElement, public store: Store) {
    const world = store.world!;
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * store.settings.renderScale);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);
    const w0 = container.clientWidth || 800, h0 = container.clientHeight || 600;
    this.renderer.setSize(w0, h0);
    this.rig = new CameraRig(w0 / h0);
    this.rig.mapSize = world.n;
    this.rig.maxDist = world.n * 1.6;
    this.scene.background = new THREE.Color(0xa9c9e4);
    this.scene.fog = new THREE.Fog(0xa9c9e4, 100, 520);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    const win = windowTexture();
    this.buildMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: win.map, emissiveMap: win.glow, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0, roughness: 0.85, metalness: 0.02 });
    this.roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

    this.terrain = new TerrainView(world, this.scene);
    this.roads = new RoadView(world, this.scene, this.roadMat);
    this.buildings = new BuildingView(world, this.scene, this.buildMat);
    this.vehicles = new VehicleView(world, this.scene);
    this.furniture = new FurnitureView(this.scene);
    this.transit = new TransitView(world, this.scene);
    this.selection = new SelectionView(world, this.scene);
    this.preview = new PreviewView(world, this.scene);
    this.tools = new ToolController(this, store);
    this.overlayData = new Uint8ClampedArray(world.n * world.n * 4);

    // rain streaks
    const RN = 1400;
    this.rainPos = new Float32Array(RN * 6);
    for (let i = 0; i < RN; i++) {
      const x = (Math.random() - 0.5) * 80, z = (Math.random() - 0.5) * 80, y = Math.random() * 40;
      this.rainPos.set([x, y, z, x - 0.05, y - 1.2, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);

    // initial camera on the settlement
    this.rig.pose.tx = this.rig.goal.tx = world.terrain.start.x;
    this.rig.pose.tz = this.rig.goal.tz = world.terrain.start.y;
    this.rig.pose.dist = this.rig.goal.dist = 34;

    this.bind();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  roadWidthOf(spec: RoadSpec) { return roadWidth(spec); }
  markRoadsDirty() { this.roadsDirty = true; this.buildingsDirty = true; }
  markBuildingsDirty() { this.buildingsDirty = true; }
  markZonesDirty() { this.zonesDirty = true; }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.rig.setAspect(w / h);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    for (const c of this.cleanup) c();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ───────── input ─────────
  private bind() {
    const el = this.renderer.domElement;
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, target: HTMLElement | Window = el) => {
      target.addEventListener(t, f as EventListener, { passive: false } as AddEventListenerOptions);
      this.cleanup.push(() => target.removeEventListener(t, f as EventListener));
    };
    on('contextmenu', (e) => e.preventDefault());
    on('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.downPos = { x: e.clientX, y: e.clientY };
      this.moved = false;
      if (this.pointers.size === 2) { this.dragging = 'pan'; this.pinch = this.pinchDist(); return; }
      if (e.button === 2) this.dragging = 'rotate';
      else if (e.button === 1 || (e.button === 0 && (e.shiftKey || e.altKey) && this.store.tool === 'select')) this.dragging = 'pan';
      else { this.dragging = 'left'; this.tools.down(this.pick(e.clientX, e.clientY)); }
    });
    on('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (prev) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const d = this.pinchDist();
        if (this.pinch > 0) this.rig.zoom(this.pinch / Math.max(1, d));
        this.pinch = d;
        const dx = prev ? e.clientX - prev.x : 0, dy = prev ? e.clientY - prev.y : 0;
        this.rig.pan(dx * 0.5, dy * 0.5);
        return;
      }
      const dx = prev ? e.clientX - prev.x : 0, dy = prev ? e.clientY - prev.y : 0;
      if (Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 6) this.moved = true;
      if (this.dragging === 'rotate') this.rig.rotate(dx * 0.006, dy * 0.0045);
      else if (this.dragging === 'pan') this.rig.pan(dx, dy);
      else if (this.dragging === 'left' && this.store.tool === 'select' && this.moved && (e.pointerType === 'touch' || this.store.selection === null || true)) {
        // dragging in select mode pans the map
        this.rig.pan(dx, dy);
      } else {
        const now = performance.now();
        if (now - this.hoverTimer > 24) { this.hoverTimer = now; this.tools.move(this.pick(e.clientX, e.clientY), e.shiftKey); this.updateHover(); }
      }
    });
    on('pointerup', (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
      const was = this.dragging;
      this.dragging = 'none';
      const p = this.pick(e.clientX, e.clientY);
      if (was === 'left') {
        this.tools.up(p);
        if (!this.moved) this.tools.click(p, e.shiftKey);
      } else if (was === 'rotate' && !this.moved) this.tools.cancel();
    });
    on('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.dragging = 'none'; });
    on('wheel', (e) => { e.preventDefault(); this.rig.zoom(Math.exp(e.deltaY * 0.0011)); });
    const isTyping = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };
    on('keydown', (e) => {
      if (isTyping()) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.rig.keys.add(k); if (k.startsWith('arrow')) e.preventDefault(); }
      else if (k === 'escape') this.tools.cancel();
      else if (k === 'enter') this.tools.confirm();
      else if (k === ' ') { e.preventDefault(); const s = this.store.sim; if (s) { s.setSpeed(s.speedIndex === 0 ? 1 : 0); this.store.emit(); } }
      else if (k === '1' || k === '2' || k === '3') { this.store.sim?.setSpeed(Number(k)); this.store.emit(); }
      else if (k === ',' || k === '.' || k === 't') { this.store.buildRot = (this.store.buildRot + 1) % 4; this.tools.lastMoveKey = ''; if (this.lastPick) this.tools.move(this.lastPick, false); this.store.emit(); }
      else if (k === 'z' && (e.ctrlKey || e.metaKey)) { /* undo not supported */ }
    }, window);
    on('keyup', (e) => { this.rig.keys.delete(e.key.toLowerCase()); }, window);
    on('blur', () => { this.rig.keys.clear(); }, window);
  }

  private pinchDist() {
    const pts = [...this.pointers.values()];
    return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  /** Ray-march the heightfield under the cursor. */
  pick(clientX: number, clientY: number): Pick | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.rig.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const t = this.world.terrain;
    let prevT = 0, prevAbove = true;
    const maxT = this.rig.pose.dist * 4 + 120;
    const step = Math.max(0.2, this.rig.pose.dist / 140);
    for (let s = 0; s < maxT; s += step) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      if (x < -2 || z < -2 || x > t.n + 2 || z > t.n + 2) { if (s > 10 && y < 0) break; continue; }
      const gh = heightAt(t, x, z) * HS;
      const above = y > gh;
      if (!above && prevAbove) {
        // refine by bisection
        let a = prevT, b = s;
        for (let i = 0; i < 10; i++) { const m = (a + b) / 2; const hy = heightAt(t, o.x + d.x * m, o.z + d.z * m) * HS; if (o.y + d.y * m > hy) a = m; else b = m; }
        const px = o.x + d.x * b, pz = o.z + d.z * b;
        return { x: clamp(px, 0, t.n - 0.001), y: clamp(pz, 0, t.n - 0.001), h: heightAt(t, px, pz) };
      }
      prevT = s; prevAbove = above;
    }
    return null;
  }

  hitTest(p: Pick): { kind: 'edge' | 'node' | 'building' | 'stop'; id: number } | null {
    const w = this.world;
    const nd = w.net.nearestNode(p.x, p.y, 0.55);
    for (const s of w.stops.values()) if (s.kind === 'bus' && Math.hypot(s.x - p.x, s.y - p.y) < 0.6) return { kind: 'stop', id: s.id };
    const b = w.buildingAt(p.x, p.y);
    if (b) return { kind: 'building', id: b.id };
    if (nd && nd.edges.length >= 2) return { kind: 'node', id: nd.id };
    const ne = w.net.nearestEdge(p.x, p.y, 0.8);
    if (ne && ne.d <= Math.max(0.5, (ne.e.width ?? 0.5) / 2 + 0.2)) return { kind: 'edge', id: ne.e.id };
    return null;
  }

  setHoverPick(p: Pick, mode: string) {
    const hit = this.hitTest(p);
    const key = hit ? `${hit.kind}:${hit.id}:${mode}` : mode;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.hover = hit;
  }
  hover: { kind: string; id: number } | null = null;

  private updateHover() {
    const p = this.lastPick;
    const s = this.store;
    if (!p) { s.hover = null; return; }
    const w = this.world, t = w.terrain, k = w.idx(p.x, p.y);
    const b = w.buildingAt(p.x, p.y);
    s.hover = { x: p.x, y: p.y, h: p.h, slope: t.slope[k], build: t.build[k], water: t.waterKind[k], lv: w.fields.landValue[k], zone: w.zones[k], area: w.areaName(p.x, p.y), building: b?.name };
    if (performance.now() - this.lastHoverEmit > 120) { this.lastHoverEmit = performance.now(); s.emit(); }
  }
  private lastHoverEmit = 0;

  /** Tile → screen pixel (for tests and UI anchors). */
  project(x: number, y: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, heightAt(this.world.terrain, x, y) * HS, y).project(this.rig.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  focusOn(x: number, y: number, dist = 30) { this.rig.focus(x, y, dist); }
  zoomBy(f: number) { this.rig.zoom(f); }
  rotateBy(d: number) { this.rig.goal.yaw += d; }
  tiltBy(d: number) { this.rig.goal.pitch = clamp(this.rig.goal.pitch + d, 0.18, 1.5); }
  resetCamera() { this.rig.goal.yaw = Math.PI * 0.25; this.rig.goal.pitch = 0.95; }

  // ───────── frame ─────────
  loop(now: number) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; if (this.store.debug) this.store.emit(); }
    const s = this.store;
    const sim = s.sim!;
    sim.update(dt);
    this.syncViews(dt);
    this.rig.update(dt, (x, z) => heightAt(this.world.terrain, x, z) * HS);
    this.updateLighting(dt);
    const cp = this.rig.camera.position;
    this.vehicles.update(sim.traffic, cp, this.time);
    this.vehicles.syncSignals(this.roads, sim.traffic);
    this.updateRain(dt);
    this.renderer.render(this.scene, this.rig.camera);
  }

  private syncViews(dt: number) {
    const w = this.world, s = this.store;
    if (w.terrainDirty) { this.terrain.refresh(); w.terrainDirty = false; this.roadsDirty = true; }
    if (this.roads.version !== w.net.version || this.roadsDirty) {
      this.roads.rebuild(); this.furniture.rebuild(this.roads); this.roadsDirty = false; this.treeTimer = 0.5;
    }
    this.buildings.sync(this.buildingsDirty);
    this.buildingsDirty = false;
    this.treeTimer -= dt;
    if (this.treeTimer <= 0) { this.terrain.syncTrees(`${w.buildingVersion}|${w.net.version}|${w.terrainVersion}`); this.treeTimer = 1.5; }
    const draft = s.transitDraft && s.transitDraft.stops.length ? { stops: s.transitDraft.stops, color: s.transitDraft.color, line: s.draftPreview.line } : null;
    this.transit.sync(s.selection?.kind === 'line' ? s.selection.id : 0, draft);
    this.selection.set(s.selection && s.selection.kind !== 'tile' ? { kind: s.selection.kind, id: s.selection.id } : null, this.hover);
    this.applyViewMode();
    this.syncOverlay(dt);
  }

  private applyViewMode() {
    const s = this.store;
    const key = `${s.viewMode}|${s.designMode}`;
    if (key === this.viewModeApplied) return;
    this.viewModeApplied = key;
    const vm = s.viewMode;
    this.buildings.setVisible(vm !== 'terrain');
    this.vehicles.showVehicles = vm !== 'terrain';
    this.vehicles.showPeds = vm === 'city' || vm === 'transport';
    this.furniture.group.visible = vm === 'city' || vm === 'transport';
    this.buildMat.color.setHex(vm === 'transport' || vm === 'transit' ? 0xa4a9ad : 0xffffff);
    this.roadMat.color.setHex(vm === 'transit' ? 0xb0b0b0 : 0xffffff);
    if (vm === 'city') this.rig.goal.pitch = 0.95;
    else if (vm === 'transport') this.rig.goal.pitch = 1.2;
    else if (vm === 'terrain') { this.rig.goal.pitch = 0.78; this.rig.goal.dist = Math.max(this.rig.goal.dist, 60); }
    else this.rig.goal.pitch = 1.05;
  }

  private syncOverlay(dt: number) {
    const s = this.store, w = this.world;
    const key: OverlayKey = s.overlay;
    this.overlayTimer -= dt;
    const changed = key !== this.overlayKey;
    const zoneTouch = key === 'zones' && this.zonesDirty;
    if (!changed && !zoneTouch && (this.overlayTimer > 0 || key === 'none')) return;
    this.overlayTimer = 0.9;
    this.zonesDirty = false;
    this.overlayKey = key;
    if (key === 'none') { this.terrain.setOverlay(null); this.roads.recolor(null); return; }
    const def = OVERLAY_BY_KEY[key];
    if (def.roads) {
      this.roads.recolor((id) => roadOverlayColor(w, key, id) ?? null);
      // quiet terrain tint so roads stand out
      this.terrain.setOverlay(null);
    } else {
      this.roads.recolor(null);
      const has = fillOverlay(w, key, this.overlayData);
      if (has) {
        if (!this.overlayTex) {
          this.overlayTex = new THREE.DataTexture(this.overlayData as any, w.n, w.n, THREE.RGBAFormat);
          this.overlayTex.magFilter = THREE.NearestFilter; this.overlayTex.minFilter = THREE.NearestFilter;
          this.overlayTex.colorSpace = THREE.SRGBColorSpace;
        }
        this.overlayTex.needsUpdate = true;
        this.terrain.setOverlay(this.overlayTex, 1);
      }
    }
  }

  private updateLighting(dt: number) {
    const w = this.world;
    const hour = w.hour;
    const ang = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    const day = smoothstep(-0.08, 0.28, elev);
    const night = 1 - day;
    const twilight = clamp(1 - Math.abs(elev) * 3.2, 0, 1) * (elev > -0.2 ? 1 : 0);
    const cloud = w.cloud, rain = w.rain;
    const grey = clamp(cloud * 0.55 + rain * 0.25, 0, 0.8);
    // sky
    const dayCol = new THREE.Color(0x9cc6ea), duskCol = new THREE.Color(0xe99a6a), nightCol = new THREE.Color(0x0d1424), greyCol = new THREE.Color(0x8a97a3);
    const sky = nightCol.clone().lerp(dayCol, day).lerp(duskCol, twilight * 0.7);
    sky.lerp(greyCol.clone().multiplyScalar(0.35 + 0.65 * day), grey);
    (this.scene.background as THREE.Color).copy(sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    fog.near = 110 - rain * 60;
    fog.far = 520 - rain * 260;
    this.sun.intensity = (0.15 + 1.15 * day) * (1 - grey * 0.55);
    this.sun.color.setRGB(1, 0.78 + 0.22 * (1 - twilight), 0.55 + 0.4 * (1 - twilight));
    if (night > 0.5) this.sun.color.setRGB(0.45, 0.55, 0.9);
    const cx = this.rig.pose.tx, cz = this.rig.pose.tz;
    const horiz = Math.cos(ang), up = Math.max(0.12, Math.abs(elev));
    this.sun.position.set(cx + horiz * 80, up * 90, cz + 40);
    this.sun.target.position.set(cx, 0, cz);
    this.hemi.intensity = 0.3 + 0.38 * day - grey * 0.08;
    this.hemi.color.copy(sky);
    this.hemi.groundColor.setRGB(0.3 + 0.12 * day, 0.35 + 0.15 * day, 0.28 + 0.08 * day);
    this.buildMat.emissiveIntensity = night * 1.25 + (rain > 0.5 ? 0.15 : 0);
    this.furniture.setNight(night);
    this.terrain.waterMat.color.setRGB(0.32 * (0.3 + 0.7 * day), 0.62 * (0.3 + 0.7 * day), 0.82 * (0.35 + 0.65 * day));
    this.terrain.waterMat.emissive.setRGB(0.04 * day, 0.1 * day, 0.14 * day);
    this.terrain.waterMat.opacity = 0.88;
    void dt;
  }

  private updateRain(dt: number) {
    const m = this.rain.material as THREE.LineBasicMaterial;
    const r = this.world.rain;
    m.opacity = clamp(r * 0.55, 0, 0.55);
    this.rain.visible = r > 0.06;
    if (!this.rain.visible) return;
    const p = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = this.rainPos;
    const speed = 38 + r * 20;
    const c = this.rig.pose;
    const R = Math.min(60, 25 + c.dist * 0.4);
    for (let i = 0; i < arr.length / 6; i++) {
      let y = arr[i * 6 + 1] - speed * dt;
      if (y < 0) { y += 40; arr[i * 6] = (Math.random() - 0.5) * 2 * R; arr[i * 6 + 2] = (Math.random() - 0.5) * 2 * R; }
      arr[i * 6 + 1] = y;
      arr[i * 6 + 3] = arr[i * 6] - 0.04; arr[i * 6 + 4] = y - 0.9 - r * 0.8; arr[i * 6 + 5] = arr[i * 6 + 2];
    }
    p.needsUpdate = true;
    this.rain.position.set(c.tx, this.rig.ty + 2, c.tz);
  }

  /** Capture the canvas as a PNG data URL (used for save thumbnails and tests). */
  snapshot() { this.renderer.render(this.scene, this.rig.camera); return this.renderer.domElement.toDataURL('image/png'); }
}

export { DEFS };
