import * as THREE from 'three';
import type { World } from '../game/world';
import type { Traffic } from '../game/traffic/traffic';
import { Vehicle, VehicleKind, HEIGHT_SCALE } from '../game/types';
import { MeshBuilder } from './meshBuilder';
import { CAR_COLORS, SCOOTER_COLORS, PED_COLORS, FREIGHT_COLORS, AWNING } from './palette';
import { isBusKind } from '../game/traffic/traffic';
import { RoadView } from './roadView';
import { TRANSIT } from '../game/transportation/transit';

const HS = HEIGHT_SCALE;
const W = 0xffffff;

function wheel(mb: MeshBuilder, x: number, z: number, r = 0.022, w = 0.018) { mb.box(x, 0, z, r * 2, r * 2, w, 0x1d1f21, { noBottom: true }); }

function carBody(mb: MeshBuilder, len: number, wid: number, variant: number) {
  const h = variant === 2 ? 0.05 : 0.042;
  mb.box(0, 0.016, 0, len, 0.036, wid, W, { noBottom: true });
  const cl = variant === 0 ? len * 0.52 : variant === 1 ? len * 0.46 : len * 0.62;
  const cx = variant === 1 ? -len * 0.04 : -len * 0.03;
  mb.box(cx, 0.052, 0, cl, h, wid * 0.88, 0x25323d, { noBottom: true });
  mb.box(cx, 0.052 + h, 0, cl * 0.92, 0.008, wid * 0.86, W, { noBottom: true });
  if (variant === 1) mb.box(-len * 0.38, 0.052, 0, len * 0.22, 0.012, wid * 0.92, W, { noBottom: true });
  for (const s of [-1, 1]) { wheel(mb, len * 0.3, s * wid * 0.45); wheel(mb, -len * 0.3, s * wid * 0.45); }
  mb.box(len * 0.5, 0.032, wid * 0.3, 0.004, 0.01, 0.02, 0xfff3c0, { noBottom: true });
  mb.box(len * 0.5, 0.032, -wid * 0.3, 0.004, 0.01, 0.02, 0xfff3c0, { noBottom: true });
  mb.box(-len * 0.5, 0.032, wid * 0.3, 0.004, 0.01, 0.02, 0xd23b3b, { noBottom: true });
  mb.box(-len * 0.5, 0.032, -wid * 0.3, 0.004, 0.01, 0.02, 0xd23b3b, { noBottom: true });
}

function rider(mb: MeshBuilder, x: number, y: number, jacket = 0x3a5f8f) {
  mb.box(x, y, 0, 0.036, 0.05, 0.04, jacket, { noBottom: true });
  mb.box(x + 0.004, y + 0.05, 0, 0.032, 0.03, 0.032, 0xe9e2d4, { noBottom: true });
}

function makeGeo(kind: VehicleKind, variant = 0): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  switch (kind) {
    case 'car': carBody(mb, 0.3, 0.12, variant); break;
    case 'taxi': carBody(mb, 0.3, 0.12, 1); mb.box(-0.01, 0.1, 0, 0.05, 0.016, 0.03, 0xf2b24a, { noBottom: true }); break;
    case 'motorcycle':
      mb.box(0, 0.026, 0, 0.17, 0.026, 0.022, W, { noBottom: true }); mb.box(0.06, 0.05, 0, 0.04, 0.03, 0.03, 0x333333, { noBottom: true });
      wheel(mb, 0.07, 0, 0.022, 0.012); wheel(mb, -0.07, 0, 0.022, 0.012); rider(mb, -0.012, 0.045, 0xd8d3c8); break;
    case 'scooter':
      mb.box(0, 0.022, 0, 0.16, 0.03, 0.04, W, { noBottom: true }); mb.box(0.065, 0.05, 0, 0.012, 0.07, 0.04, W, { noBottom: true });
      wheel(mb, 0.065, 0, 0.018, 0.012); wheel(mb, -0.06, 0, 0.018, 0.012); rider(mb, -0.012, 0.045, 0xc86a5a); break;
    case 'auto':
      mb.box(-0.02, 0.016, 0, 0.17, 0.05, 0.088, 0x2e7a4e, { noBottom: true });
      mb.box(-0.025, 0.066, 0, 0.17, 0.04, 0.09, 0xf2c230, { noBottom: true });
      mb.box(0.075, 0.018, 0, 0.07, 0.04, 0.04, 0xf2c230, { noBottom: true });
      mb.box(0.06, 0.04, 0, 0.004, 0.04, 0.07, 0x25323d, { noBottom: true });
      wheel(mb, 0.09, 0, 0.018, 0.012); wheel(mb, -0.07, 0.044, 0.02, 0.014); wheel(mb, -0.07, -0.044, 0.02, 0.014);
      mb.box(-0.02, 0.012, 0, 0.12, 0.012, 0.02, W, { noBottom: true }); break;
    case 'bicycle':
      wheel(mb, 0.06, 0, 0.026, 0.006); wheel(mb, -0.06, 0, 0.026, 0.006);
      mb.box(0, 0.03, 0, 0.12, 0.008, 0.008, W, { noBottom: true }); rider(mb, -0.01, 0.04, 0x6a8f4a); break;
    case 'bus': case 'ebus': case 'minibus': {
      const len = kind === 'minibus' ? 0.42 : 0.6, wid = kind === 'minibus' ? 0.1 : 0.13, hh = kind === 'minibus' ? 0.075 : 0.1;
      mb.box(0, 0.016, 0, len, hh, wid, W, { noBottom: true });
      mb.box(0, 0.016 + hh * 0.42, 0, len * 0.96, hh * 0.38, wid * 1.02, 0x25323d, { noBottom: true });
      mb.box(0, 0.016 + hh, 0, len * 0.98, 0.008, wid * 0.96, W, { noBottom: true });
      mb.box(len * 0.2, 0.016 + hh + 0.008, 0, len * 0.22, 0.014, wid * 0.5, 0xd8dadb, { noBottom: true });
      mb.box(len * 0.5 + 0.002, 0.016 + hh * 0.55, 0, 0.004, hh * 0.35, wid * 0.8, 0x1c2a36, { noBottom: true });
      mb.box(len * 0.5 + 0.002, 0.016 + hh * 0.85, 0, 0.004, hh * 0.1, wid * 0.4, 0xffe9a8, { noBottom: true });
      for (const s of [-1, 1]) { wheel(mb, len * 0.3, s * wid * 0.47, 0.026); wheel(mb, -len * 0.3, s * wid * 0.47, 0.026); }
      if (kind === 'ebus') mb.box(0, 0.016 + hh + 0.022, 0, len * 0.7, 0.005, 0.01, 0x8aa0aa, { noBottom: true });
      break;
    }
    case 'artibus': {
      for (const o of [0.22, -0.26]) {
        const len = o > 0 ? 0.4 : 0.36;
        mb.box(o, 0.016, 0, len, 0.1, 0.13, W, { noBottom: true });
        mb.box(o, 0.058, 0, len * 0.96, 0.038, 0.134, 0x25323d, { noBottom: true });
        mb.box(o, 0.116, 0, len * 0.98, 0.008, 0.126, W, { noBottom: true });
        for (const s of [-1, 1]) wheel(mb, o + (o > 0 ? 0.1 : -0.08), s * 0.062, 0.026);
      }
      mb.box(0, 0.02, 0, 0.1, 0.09, 0.11, 0x303436, { noBottom: true });
      break;
    }
    case 'lorry': case 'tanker': case 'container': case 'construction': {
      const len = kind === 'container' ? 0.78 : kind === 'construction' ? 0.55 : 0.6;
      const cabX = len / 2 - 0.07;
      mb.box(cabX, 0.016, 0, 0.14, 0.09, 0.13, W, { noBottom: true });
      mb.box(cabX + 0.071, 0.06, 0, 0.004, 0.035, 0.11, 0x25323d, { noBottom: true });
      mb.box(0, 0.016, 0, len - 0.18, 0.02, 0.1, 0x33383c, { noBottom: true });
      if (kind === 'tanker') mb.cylinderX(-0.04, 0.085, 0, 0.06, len - 0.24, 0xf2f0ea, 10);
      else if (kind === 'container') {
        mb.box(-0.05, 0.036, 0, len - 0.24, 0.12, 0.13, W, { noBottom: true });
        for (let i = 0; i < 6; i++) mb.box(-0.05 - (len - 0.24) / 2 + 0.03 + i * ((len - 0.3) / 5), 0.036, 0.066, 0.006, 0.12, 0.004, 0xffffff, { noBottom: true });
      } else if (kind === 'construction') {
        mb.box(-0.06, 0.04, 0, 0.26, 0.07, 0.13, 0xe8b330, { noBottom: true });
        mb.box(-0.06, 0.11, 0, 0.26, 0.01, 0.13, 0xc99a28, { noBottom: true });
      } else {
        mb.box(-0.04, 0.036, 0, len - 0.22, 0.11, 0.13, W, { noBottom: true });
        mb.box(-0.04, 0.146, 0, len - 0.22, 0.008, 0.13, 0xd8dadb, { noBottom: true });
      }
      for (const s of [-1, 1]) { wheel(mb, cabX - 0.01, s * 0.06, 0.028); wheel(mb, -0.12, s * 0.06, 0.028); wheel(mb, -0.2, s * 0.06, 0.028); }
      break;
    }
    case 'minitruck':
      mb.box(0.08, 0.016, 0, 0.1, 0.07, 0.1, W, { noBottom: true }); mb.box(0.13, 0.05, 0, 0.004, 0.03, 0.08, 0x25323d, { noBottom: true });
      mb.box(-0.05, 0.02, 0, 0.18, 0.03, 0.1, 0x555a5e, { noBottom: true }); mb.box(-0.05, 0.05, 0, 0.18, 0.05, 0.1, W, { noBottom: true });
      for (const s of [-1, 1]) { wheel(mb, 0.09, s * 0.05); wheel(mb, -0.09, s * 0.05); } break;
    case 'van':
      mb.box(0, 0.016, 0, 0.36, 0.085, 0.11, W, { noBottom: true }); mb.box(0.12, 0.052, 0, 0.1, 0.035, 0.112, 0x25323d, { noBottom: true });
      for (const s of [-1, 1]) { wheel(mb, 0.11, s * 0.05); wheel(mb, -0.11, s * 0.05); } break;
    case 'ambulance':
      mb.box(0, 0.016, 0, 0.38, 0.09, 0.12, W, { noBottom: true }); mb.box(0.13, 0.054, 0, 0.1, 0.035, 0.122, 0x25323d, { noBottom: true });
      mb.box(0, 0.05, 0, 0.3, 0.012, 0.122, 0xd23b3b, { noBottom: true }); mb.box(0, 0.108, 0, 0.04, 0.012, 0.09, 0xff4040, { noBottom: true });
      for (const s of [-1, 1]) { wheel(mb, 0.12, s * 0.055); wheel(mb, -0.12, s * 0.055); } break;
    case 'fire':
      mb.box(0, 0.016, 0, 0.56, 0.1, 0.13, W, { noBottom: true }); mb.box(0.2, 0.06, 0, 0.12, 0.05, 0.132, 0x25323d, { noBottom: true });
      mb.box(-0.06, 0.116, 0, 0.36, 0.014, 0.04, 0xcfd4d6, { noBottom: true }); mb.box(0.18, 0.116, 0, 0.04, 0.012, 0.1, 0xff4040, { noBottom: true });
      for (const s of [-1, 1]) { wheel(mb, 0.18, s * 0.06, 0.028); wheel(mb, -0.18, s * 0.06, 0.028); } break;
    case 'police':
      carBody(mb, 0.3, 0.12, 1); mb.box(-0.01, 0.1, 0, 0.04, 0.014, 0.1, 0x3e6fd4, { noBottom: true }); break;
  }
  return mb.build();
}

const CAP: Partial<Record<VehicleKind, number>> = { car: 360, taxi: 60, motorcycle: 220, scooter: 260, auto: 240, bicycle: 80, bus: 120, ebus: 80, artibus: 50, minibus: 50, lorry: 90, container: 70, tanker: 40, construction: 50, minitruck: 90, van: 90, ambulance: 10, fire: 10, police: 10 };

export class VehicleView {
  group = new THREE.Group();
  meshes = new Map<string, THREE.InstancedMesh>();
  far!: THREE.InstancedMesh;
  pedBody!: THREE.InstancedMesh;
  pedHead!: THREE.InstancedMesh;
  vendors!: THREE.InstancedMesh;
  trainCars!: THREE.InstancedMesh;
  signalMesh: THREE.InstancedMesh | null = null;
  signalKey = '';
  signalList: { node: number; edge: number }[] = [];
  mat: THREE.MeshStandardMaterial;
  nearDist = 70;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private pv = new THREE.Vector3();
  private sc = new THREE.Vector3(1, 1, 1);
  private col = new THREE.Color();
  private counts = new Map<string, number>();
  showVehicles = true;
  showPeds = true;

  constructor(public world: World, scene: THREE.Scene) {
    scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
    const mk = (key: string, geo: THREE.BufferGeometry, cap: number) => {
      const m = new THREE.InstancedMesh(geo, this.mat, cap);
      m.count = 0; m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(m);
      this.meshes.set(key, m);
      return m;
    };
    for (const k of Object.keys(CAP) as VehicleKind[]) {
      if (k === 'car') for (let v = 0; v < 3; v++) mk(`car${v}`, makeGeo('car', v), CAP.car! / 2);
      else mk(k, makeGeo(k), CAP[k]!);
    }
    // far LOD: coloured boxes
    const fb = new MeshBuilder(); fb.box(0, 0, 0, 0.34, 0.1, 0.13, W, { noBottom: true });
    this.far = new THREE.InstancedMesh(fb.build(), this.mat, 1400);
    this.far.count = 0; this.far.frustumCulled = false; this.far.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.far);
    // pedestrians
    const pb = new MeshBuilder(); pb.box(0, 0, 0, 0.036, 0.062, 0.036, W, { noBottom: true });
    const ph = new MeshBuilder(); ph.box(0, 0.062, 0, 0.03, 0.03, 0.03, W, { noBottom: true });
    this.pedBody = new THREE.InstancedMesh(pb.build(), this.mat, 700);
    this.pedHead = new THREE.InstancedMesh(ph.build(), this.mat, 700);
    for (const m of [this.pedBody, this.pedHead]) { m.count = 0; m.frustumCulled = false; m.setColorAt(0, new THREE.Color(1, 1, 1)); this.group.add(m); }
    // vendors
    const vb = new MeshBuilder();
    vb.box(0, 0, 0, 0.06, 0.035, 0.045, 0x8d6e4a, { noBottom: true });
    vb.box(0, 0.035, 0, 0.055, 0.008, 0.04, 0xd9d4c8, { noBottom: true });
    vb.box(-0.025, 0.035, -0.015, 0.004, 0.06, 0.004, 0x6f7377, { noBottom: true });
    vb.pyramid(-0.01, 0.092, -0.01, 0.12, 0.12, 0.028, 0.01, W);
    this.vendors = new THREE.InstancedMesh(vb.build(), this.mat, 400);
    this.vendors.count = 0; this.vendors.frustumCulled = false; this.vendors.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.vendors);
    // train cars
    const tb = new MeshBuilder();
    tb.box(0, 0.02, 0, 0.36, 0.1, 0.12, W, { noBottom: true });
    tb.box(0, 0.064, 0, 0.35, 0.034, 0.124, 0x25323d, { noBottom: true });
    tb.box(0, 0.124, 0, 0.35, 0.01, 0.1, 0xdcdedf, { noBottom: true });
    this.trainCars = new THREE.InstancedMesh(tb.build(), this.mat, 400);
    this.trainCars.count = 0; this.trainCars.frustumCulled = false; this.trainCars.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.trainCars);
  }

  dispose() { this.group.removeFromParent(); }

  private put(mesh: THREE.InstancedMesh, x: number, y: number, z: number, ang: number, color: THREE.Color, scale = 1, pitch = 0) {
    const i = this.counts.get(mesh.uuid) ?? 0;
    if (i >= mesh.instanceMatrix.count) return;
    this.q.setFromAxisAngle(this.up, -ang);
    if (pitch) { const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch); this.q.multiply(qp); }
    this.pv.set(x, y, z);
    this.sc.setScalar(scale);
    this.m4.compose(this.pv, this.q, this.sc);
    mesh.setMatrixAt(i, this.m4);
    mesh.setColorAt(i, color);
    this.counts.set(mesh.uuid, i + 1);
  }

  private colorFor(v: Vehicle): THREE.Color {
    const c = this.col;
    switch (v.kind) {
      case 'car': c.setHex(CAR_COLORS[v.color % CAR_COLORS.length]); break;
      case 'taxi': c.setHex(0xf2c230); break;
      case 'motorcycle': case 'scooter': c.setHex(SCOOTER_COLORS[v.color % SCOOTER_COLORS.length]); break;
      case 'auto': c.setHex(0xffffff); break;
      case 'bicycle': c.setHex(0xd9d4c8); break;
      case 'bus': case 'ebus': case 'artibus': case 'minibus': c.setHex(v.color || 0xe8743b); c.lerp(new THREE.Color(0xffffff), 0.25); break;
      case 'ambulance': c.setHex(0xffffff); break;
      case 'fire': c.setHex(0xc7392f); break;
      case 'police': c.setHex(0xe4eaf0); break;
      case 'construction': c.setHex(0xffffff); break;
      default: c.setHex(FREIGHT_COLORS[v.color % FREIGHT_COLORS.length]); break;
    }
    return c;
  }

  update(traffic: Traffic, camPos: THREE.Vector3, time: number) {
    for (const m of this.meshes.values()) this.counts.set(m.uuid, 0);
    this.counts.set(this.far.uuid, 0);
    this.counts.set(this.pedBody.uuid, 0); this.counts.set(this.pedHead.uuid, 0);
    this.counts.set(this.vendors.uuid, 0); this.counts.set(this.trainCars.uuid, 0);
    const lowFar = camPos.y > 95;
    if (this.showVehicles) for (const v of traffic.vehicles) {
      const y = v.z * HS + 0.014;
      const dx = v.x - camPos.x, dz = v.y - camPos.z;
      const d2 = dx * dx + dz * dz + (y - camPos.y) ** 2;
      const col = this.colorFor(v);
      if (v.emergency && (v.kind === 'ambulance' || v.kind === 'police' || v.kind === 'fire')) { /* flash body tint */ }
      if (d2 > this.nearDist * this.nearDist || lowFar) {
        this.put(this.far, v.x, y + 0.03, v.y, v.ang, col, v.heavy ? 1.9 : v.len > 0.25 ? 1.3 : 0.9);
        continue;
      }
      const key = v.kind === 'car' ? `car${v.variant % 3}` : v.kind;
      const mesh = this.meshes.get(key);
      if (mesh) this.put(mesh, v.x, y, v.y, v.ang, col, 1.3);
    }
    if (this.showPeds && camPos.y < 70) {
      for (const p of traffic.peds) {
        const dx = p.x - camPos.x, dz = p.y - camPos.z;
        if (dx * dx + dz * dz > 55 * 55) continue;
        const y = p.z * HS + 0.02 + Math.abs(Math.sin(time * 6 + p.id)) * 0.003;
        this.put(this.pedBody, p.x, y, p.y, p.ang, this.col.setHex(PED_COLORS[p.color % PED_COLORS.length]), p.kind ? 1.0 : 1.35);
        this.put(this.pedHead, p.x, y, p.y, p.ang, this.col.setHex([0xd9a07a, 0xb97c56, 0x9c6a48, 0xe3b48f][p.id % 4]), p.kind ? 1.0 : 1.35);
      }
      for (const vd of this.world.vendors) {
        const dx = vd.x - camPos.x, dz = vd.y - camPos.z;
        if (dx * dx + dz * dz > 70 * 70) continue;
        const e = this.world.net.edges.get(vd.edge);
        if (!e) continue;
        this.put(this.vendors, vd.x, this.groundY(vd.x, vd.y) + 0.02, vd.y, vd.ang, this.col.setHex(AWNING[(vd.kind * 2 + 1) % AWNING.length]));
      }
    }
    for (const t of traffic.trains) {
      const spec = TRANSIT[t.mode as keyof typeof TRANSIT];
      for (let c = 0; c < t.cars; c++) {
        const l = this.world.lines.get(t.line);
        if (!l?.rt) continue;
        const p = this.trainPos(l.rt.loop, l.rt.loopCum, l.rt.loopZ, ((t.pos - c * 0.39) % t.loopLen + t.loopLen) % t.loopLen);
        this.put(this.trainCars, p.x, p.z * HS + 0.02, p.y, p.ang, this.col.setHex(spec.color).lerp(new THREE.Color(0xffffff), 0.5));
      }
    }
    for (const m of this.meshes.values()) { m.count = this.counts.get(m.uuid) ?? 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const m of [this.far, this.pedBody, this.pedHead, this.vendors, this.trainCars]) { m.count = this.counts.get(m.uuid) ?? 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  private groundY(x: number, y: number) {
    const t = this.world.terrain, V = t.n + 1;
    const fx = Math.min(Math.max(x, 0), t.n - 0.001), fy = Math.min(Math.max(y, 0), t.n - 0.001);
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const h = t.heights;
    return ((h[iy * V + ix] * (1 - tx) + h[iy * V + ix + 1] * tx) * (1 - ty) + (h[(iy + 1) * V + ix] * (1 - tx) + h[(iy + 1) * V + ix + 1] * tx) * ty) * HS;
  }

  private trainPos(pts: number[], cum: number[], zs: number[], s: number) {
    let lo = 0, hi = cum.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
    const seg = cum[lo + 1] - cum[lo] || 1e-6, t = (s - cum[lo]) / seg;
    const x0 = pts[lo * 2], y0 = pts[lo * 2 + 1], x1 = pts[lo * 2 + 2], y1 = pts[lo * 2 + 3];
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, z: (zs[lo] ?? 0) + ((zs[lo + 1] ?? zs[lo] ?? 0) - (zs[lo] ?? 0)) * t, ang: Math.atan2(y1 - y0, x1 - x0) };
  }

  /** Traffic-signal heads: rebuild list when roads change, recolour each frame. */
  syncSignals(roads: RoadView, traffic: Traffic) {
    const key = `${roads.version}|${roads.furniture.signals.length}`;
    if (key !== this.signalKey) {
      this.signalKey = key;
      if (this.signalMesh) { this.group.remove(this.signalMesh); this.signalMesh.dispose(); this.signalMesh = null; }
      const list = roads.furniture.signals;
      this.signalList = list.map((s) => ({ node: s.node, edge: s.edge }));
      if (list.length) {
        const mb = new MeshBuilder();
        mb.box(0, 0, 0, 0.012, 0.16, 0.012, 0x4b4f52, { noBottom: true });
        mb.box(0, 0.14, 0, 0.034, 0.075, 0.03, 0x303436, { noBottom: true });
        const lights = new MeshBuilder();
        lights.box(0, 0.16, 0.016, 0.022, 0.05, 0.004, W, { noBottom: true });
        const m = new THREE.InstancedMesh(lights.build(), new THREE.MeshBasicMaterial({ vertexColors: false }), list.length);
        const pole = new THREE.InstancedMesh(mb.build(), this.mat, list.length);
        list.forEach((s, i) => {
          const q = new THREE.Quaternion().setFromAxisAngle(this.up, -s.ang + Math.PI);
          const mm = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.z, s.y), q, new THREE.Vector3(1, 1, 1));
          m.setMatrixAt(i, mm); pole.setMatrixAt(i, mm);
          m.setColorAt(i, new THREE.Color(0xff3b30)); pole.setColorAt(i, new THREE.Color(1, 1, 1));
        });
        this.group.add(m, pole);
        this.signalMesh = m;
        (m as any)._pole = pole;
      }
    }
    if (!this.signalMesh) return;
    const colors = [0xff3b30, 0x4cd964, 0xffcc00];
    this.signalList.forEach((s, i) => {
      const plan = traffic.plans.get(s.node);
      const st = plan ? traffic.signal(plan, s.edge) : 0;
      this.col.setHex(colors[st]);
      this.signalMesh!.setColorAt(i, this.col);
    });
    if (this.signalMesh.instanceColor) this.signalMesh.instanceColor.needsUpdate = true;
  }
}

export class FurnitureView {
  group = new THREE.Group();
  meshes: THREE.InstancedMesh[] = [];
  lampHeads: THREE.InstancedMesh | null = null;
  lampMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
  mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  key = '';
  constructor(scene: THREE.Scene) { scene.add(this.group); }

  rebuild(roads: RoadView) {
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = [];
    const f = roads.furniture;
    const up = new THREE.Vector3(0, 1, 0);
    const mk = (geo: THREE.BufferGeometry, data: number[], mat: THREE.Material, scaleFn?: (d: number[], i: number) => number, colored = false) => {
      const n = data.length / 4;
      if (!n) return null;
      const m = new THREE.InstancedMesh(geo, mat, n);
      const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const sc = scaleFn ? scaleFn(data, i) : 1;
        q.setFromAxisAngle(up, -data[i * 4 + 3]);
        s.set(sc, sc, sc);
        p.set(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        mm.compose(p, q, s);
        m.setMatrixAt(i, mm);
        if (colored) m.setColorAt(i, new THREE.Color().setHSL(0.27 + (i % 7) * 0.008, 0.4, 0.34 + (i % 5) * 0.02));
      }
      m.instanceMatrix.needsUpdate = true; m.frustumCulled = false;
      this.group.add(m); this.meshes.push(m);
      return m;
    };
    // lamps
    const lp = new MeshBuilder();
    lp.box(0, 0, 0, 0.008, 0.2, 0.008, 0x5a5f63, { noBottom: true });
    lp.box(0, 0.2, 0.025, 0.008, 0.008, 0.06, 0x5a5f63, { noBottom: true });
    mk(lp.build(), f.lamps, this.mat);
    const lh = new MeshBuilder();
    lh.box(0, 0.19, 0.055, 0.03, 0.012, 0.03, W, { noBottom: true });
    this.lampHeads = mk(lh.build(), f.lamps, this.lampMat);
    // trees
    const tg = new MeshBuilder();
    tg.cylinder(0, 0, 0, 0.012, 0.09, 0x5a4330, 5, 0.01);
    tg.dome(0, 0.07, 0, 0.075, W, 6, 3);
    mk(tg.build(), f.trees, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), (d, i) => d[i * 4 + 3], true);
    // benches
    const bg = new MeshBuilder();
    bg.box(0, 0.015, 0, 0.07, 0.01, 0.025, 0x8b6a45, { noBottom: true });
    bg.box(0, 0.025, -0.012, 0.07, 0.025, 0.006, 0x8b6a45, { noBottom: true });
    mk(bg.build(), f.benches, this.mat);
    // signs
    const sg = new MeshBuilder();
    sg.box(0, 0, 0, 0.006, 0.14, 0.006, 0x6f7377, { noBottom: true });
    sg.box(0, 0.11, 0.004, 0.06, 0.04, 0.006, 0x2f6fb5, { noBottom: true });
    mk(sg.build(), f.signs, this.mat);
    // utility poles
    const pg = new MeshBuilder();
    pg.box(0, 0, 0, 0.01, 0.24, 0.01, 0x6a5d4a, { noBottom: true });
    pg.box(0, 0.21, 0, 0.0, 0.0, 0.0, 0x6a5d4a, { noBottom: true });
    pg.box(0, 0.2, 0, 0.08, 0.008, 0.008, 0x4a4036, { noBottom: true });
    mk(pg.build(), f.poles, this.mat);
  }

  setNight(night: number) {
    this.lampMat.color.setRGB(0.55 + 0.45 * night, 0.55 + 0.4 * night, 0.5 + 0.1 * night);
    if (night > 0.3) this.lampMat.color.setRGB(1, 0.9, 0.55);
  }
}
