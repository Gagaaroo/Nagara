import * as THREE from 'three';
import { clamp } from '../utils/math';

export interface CameraPose { tx: number; tz: number; yaw: number; pitch: number; dist: number }

/** Orbit camera: pan, zoom, rotate and tilt with smoothing. */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  pose: CameraPose = { tx: 64, tz: 64, yaw: Math.PI * 0.25, pitch: 0.95, dist: 46 };
  goal: CameraPose = { ...this.pose };
  ty = 0;
  keys = new Set<string>();
  maxDist = 260;
  minDist = 4;
  mapSize = 128;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.2, 900);
  }

  setAspect(a: number) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  focus(x: number, z: number, dist?: number) {
    this.goal.tx = x; this.goal.tz = z;
    if (dist) this.goal.dist = dist;
  }

  pan(dx: number, dz: number) {
    // screen-space delta → world, rotated by yaw
    const c = Math.cos(this.goal.yaw), s = Math.sin(this.goal.yaw);
    const k = this.goal.dist * 0.0021;
    this.goal.tx -= (dx * c + dz * s) * k;
    this.goal.tz -= (dz * c - dx * s) * k;
    this.clampGoal();
  }

  rotate(dyaw: number, dpitch: number) {
    this.goal.yaw += dyaw;
    this.goal.pitch = clamp(this.goal.pitch + dpitch, 0.18, 1.5);
  }

  zoom(factor: number) {
    this.goal.dist = clamp(this.goal.dist * factor, this.minDist, this.maxDist);
  }

  clampGoal() {
    const m = this.mapSize;
    this.goal.tx = clamp(this.goal.tx, -4, m + 4);
    this.goal.tz = clamp(this.goal.tz, -4, m + 4);
  }

  update(dt: number, groundY: (x: number, z: number) => number) {
    // keyboard
    const sp = this.goal.dist * 0.9 * dt;
    let fx = 0, fz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) fz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) fz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) fx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) fx += 1;
    if (fx || fz) {
      const c = Math.cos(this.goal.yaw), s = Math.sin(this.goal.yaw);
      this.goal.tx += (fx * c + fz * s) * sp;
      this.goal.tz += (fz * c - fx * s) * sp;
      this.clampGoal();
    }
    if (this.keys.has('q')) this.goal.yaw -= dt * 1.4;
    if (this.keys.has('e')) this.goal.yaw += dt * 1.4;
    if (this.keys.has('r')) this.goal.pitch = clamp(this.goal.pitch + dt, 0.18, 1.5);
    if (this.keys.has('f')) this.goal.pitch = clamp(this.goal.pitch - dt, 0.18, 1.5);
    const k = 1 - Math.exp(-dt * 10);
    const p = this.pose, g = this.goal;
    p.tx += (g.tx - p.tx) * k; p.tz += (g.tz - p.tz) * k;
    p.yaw += (g.yaw - p.yaw) * k; p.pitch += (g.pitch - p.pitch) * k; p.dist += (g.dist - p.dist) * k;
    this.ty += (groundY(p.tx, p.tz) - this.ty) * Math.min(1, dt * 6);
    const cp = Math.cos(p.pitch), sp2 = Math.sin(p.pitch);
    this.camera.position.set(p.tx + Math.sin(p.yaw) * cp * p.dist, this.ty + sp2 * p.dist, p.tz + Math.cos(p.yaw) * cp * p.dist);
    this.camera.lookAt(p.tx, this.ty, p.tz);
  }
}
