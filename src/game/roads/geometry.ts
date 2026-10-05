/** Polyline helpers. A polyline is a flat number[] of x,y pairs in tile units. */

export function cumLengths(pts: number[]): number[] {
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  return cum;
}

export function quadBezier(p0: [number, number], c: [number, number], p1: [number, number], spacing = 0.6): number[] {
  const approx = Math.hypot(c[0] - p0[0], c[1] - p0[1]) + Math.hypot(p1[0] - c[0], p1[1] - c[1]);
  const steps = Math.max(2, Math.ceil(approx / spacing));
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push(u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]);
  }
  return out;
}

export function lineSamples(p0: [number, number], p1: [number, number], spacing = 0.6): number[] {
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const steps = Math.max(1, Math.ceil(L / spacing));
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(p0[0] + ((p1[0] - p0[0]) * i) / steps, p0[1] + ((p1[1] - p0[1]) * i) / steps);
  return out;
}

export interface PolyPoint { x: number; y: number; ang: number; i: number; t: number }

/** Point at distance s along polyline (clamped), plus heading and segment info. */
export function pointAt(pts: number[], cum: number[], s: number, out: PolyPoint = { x: 0, y: 0, ang: 0, i: 0, t: 0 }): PolyPoint {
  const n = cum.length;
  if (s <= 0) s = 0;
  const L = cum[n - 1];
  if (s >= L) s = L;
  // binary search segment
  let lo = 0, hi = n - 2;
  if (hi < 0) { out.x = pts[0]; out.y = pts[1]; out.ang = 0; out.i = 0; out.t = 0; return out; }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid - 1;
  }
  const seg = cum[lo + 1] - cum[lo] || 1e-6;
  const t = (s - cum[lo]) / seg;
  const x0 = pts[lo * 2], y0 = pts[lo * 2 + 1], x1 = pts[lo * 2 + 2], y1 = pts[lo * 2 + 3];
  out.x = x0 + (x1 - x0) * t;
  out.y = y0 + (y1 - y0) * t;
  out.ang = Math.atan2(y1 - y0, x1 - x0);
  out.i = lo;
  out.t = t;
  return out;
}

export interface Closest { d: number; s: number; x: number; y: number; seg: number }

export function closestOnPolyline(pts: number[], cum: number[], px: number, py: number): Closest {
  let best: Closest = { d: 1e18, s: 0, x: 0, y: 0, seg: 0 };
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i], y0 = pts[i + 1], dx = pts[i + 2] - x0, dy = pts[i + 3] - y0;
    const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - x0) * dx + (py - y0) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const x = x0 + dx * t, y = y0 + dy * t;
    const d = Math.hypot(px - x, py - y);
    if (d < best.d) best = { d, s: cum[i / 2] + Math.sqrt(l2) * t, x, y, seg: i / 2 };
  }
  return best;
}

/** Intersection of segments a→b and c→d; returns [t,u] or null. */
export function segIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): [number, number] | null {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}

/** Split a polyline at distance s, returning two polylines that share the split point. */
export function splitPolyline(pts: number[], cum: number[], s: number): [number[], number[]] {
  const p = pointAt(pts, cum, s);
  const a: number[] = [];
  const b: number[] = [p.x, p.y];
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] < s - 1e-6) a.push(pts[i * 2], pts[i * 2 + 1]);
    else if (cum[i] > s + 1e-6) b.push(pts[i * 2], pts[i * 2 + 1]);
  }
  a.push(p.x, p.y);
  return [a, b];
}

export function reversePolyline(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

/** Offset point to the left of travel direction (in a y-down map, screen-left). */
export function leftNormal(ang: number): [number, number] {
  // heading (cos,sin); with y pointing "south", driving on the left means the left side is (sin, -cos)
  return [Math.sin(ang), -Math.cos(ang)];
}

/** Moving-average smoothing preserving endpoints. */
export function smoothArray(a: number[], radius: number): number[] {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0, c = 0;
    for (let d = -radius; d <= radius; d++) {
      const k = i + d;
      if (k < 0 || k >= a.length) continue;
      s += a[k]; c++;
    }
    out[i] = s / c;
  }
  return out;
}

/** Rate-limit gradient along a profile (forward & backward passes), ds in metres per step. */
export function limitGrade(z: number[], stepM: number, maxGrade: number): number[] {
  const out = z.slice();
  const maxD = maxGrade * stepM;
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i - 1] - maxD, Math.min(out[i - 1] + maxD, out[i]));
  for (let i = out.length - 2; i >= 0; i--) out[i] = Math.max(out[i + 1] - maxD, Math.min(out[i + 1] + maxD, out[i]));
  return out;
}
