// Генератор перерізів: шаблонні форми за розмірами → геометричні характеристики (МЦХ).
// Одиниці: мм; маса — кг/м за густиною ρ, кг/м³.

import { arc, Loop, plasticModulusX, Pt, sumMoments, swapXY, translate } from "./polygon";

export type ShapeId =
  | "rect" | "round" | "chs" | "rhs" | "iSym" | "iAsym" | "tee" | "channel" | "angle" | "zed" | "cLip" | "omega";

export const SHAPES: { id: ShapeId; dims: string[]; def: Record<string, number> }[] = [
  { id: "rect", dims: ["h", "b"], def: { h: 200, b: 100 } },
  { id: "round", dims: ["d"], def: { d: 50 } },
  { id: "chs", dims: ["d", "t"], def: { d: 108, t: 4 } },
  { id: "rhs", dims: ["h", "b", "t", "r"], def: { h: 100, b: 50, t: 3, r: 6 } },
  { id: "iSym", dims: ["h", "b", "tw", "tf"], def: { h: 400, b: 200, tw: 8, tf: 12 } },
  { id: "iAsym", dims: ["h", "b1", "tf1", "b2", "tf2", "tw"], def: { h: 500, b1: 200, tf1: 12, b2: 300, tf2: 16, tw: 8 } },
  { id: "tee", dims: ["h", "b", "tw", "tf"], def: { h: 150, b: 150, tw: 8, tf: 10 } },
  { id: "channel", dims: ["h", "b", "tw", "tf"], def: { h: 200, b: 80, tw: 6, tf: 8 } },
  { id: "angle", dims: ["h", "b", "t"], def: { h: 100, b: 63, t: 6 } },
  { id: "zed", dims: ["h", "b", "c", "t"], def: { h: 200, b: 70, c: 20, t: 2 } },
  { id: "cLip", dims: ["h", "b", "c", "t"], def: { h: 200, b: 70, c: 20, t: 2 } },
  { id: "omega", dims: ["h", "b", "bf", "t"], def: { h: 60, b: 50, bf: 25, t: 1.5 } },
];

const PI = Math.PI;
const box = (x0: number, y0: number, x1: number, y1: number): Loop => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** Тонкостінний профіль за осьовою лінією (ламана) і товщиною t: замкнений контур зі з'єднанням «у вус». */
export function thickPolyline(pts: Pt[], t: number): Loop {
  const n = pts.length, h = t / 2;
  const nrm = (a: Pt, b: Pt) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy); return { x: -dy / L, y: dx / L }; };
  const side = (s: number) => pts.map((p, i) => {
    if (i === 0) { const m = nrm(pts[0], pts[1]); return { x: p.x + s * h * m.x, y: p.y + s * h * m.y }; }
    if (i === n - 1) { const m = nrm(pts[n - 2], pts[n - 1]); return { x: p.x + s * h * m.x, y: p.y + s * h * m.y }; }
    const m1 = nrm(pts[i - 1], p), m2 = nrm(p, pts[i + 1]);
    const bx = m1.x + m2.x, by = m1.y + m2.y, k = 1 + m1.x * m2.x + m1.y * m2.y;
    return { x: p.x + (s * h * bx) / k, y: p.y + (s * h * by) / k };
  });
  const L = side(1), R = side(-1);
  const loop = [...R, ...L.reverse()];
  // орієнтація проти годинникової стрілки
  return sumMoments([loop]).A < 0 ? loop.reverse() : loop;
}

function circle(r: number, seg = 360): Pt[] {
  return arc(0, 0, r, 0, 2 * PI, seg).slice(0, -1);
}

export interface ShapeGeom { loops: Loop[]; It: number; closed: boolean; thin: boolean }

export function buildShape(id: ShapeId, d: Record<string, number>): ShapeGeom {
  switch (id) {
    case "rect": {
      const a = Math.max(d.h, d.b), b = Math.min(d.h, d.b);
      const It = a * b ** 3 * (1 / 3 - 0.21 * (b / a) * (1 - b ** 4 / (12 * a ** 4)));
      return { loops: [box(0, 0, d.b, d.h)], It, closed: false, thin: false };
    }
    case "round":
      return { loops: [circle(d.d / 2)], It: (PI * d.d ** 4) / 32, closed: false, thin: false };
    case "chs": {
      const ro = d.d / 2, ri = ro - d.t;
      return { loops: [circle(ro), circle(ri).reverse()], It: (PI * (ro ** 4 - ri ** 4)) / 2, closed: true, thin: true };
    }
    case "rhs": {
      const { h, b, t } = d, ro = Math.min(d.r ?? 0, b / 2, h / 2), ri = Math.max(0, ro - t);
      const rr = (w: number, hh: number, r: number) => r > 0 ? [
        ...arc(w / 2 - r, -hh / 2 + r, r, -PI / 2, 0, 12), ...arc(w / 2 - r, hh / 2 - r, r, 0, PI / 2, 12),
        ...arc(-w / 2 + r, hh / 2 - r, r, PI / 2, PI, 12), ...arc(-w / 2 + r, -hh / 2 + r, r, PI, 1.5 * PI, 12),
      ] : box(-w / 2, -hh / 2, w / 2, hh / 2);
      const hm = h - t, bm = b - t, rm = Math.max(0, ro - t / 2);
      const Ap = hm * bm - (4 - PI) * rm * rm, p = 2 * (hm + bm) - 2 * rm * (4 - PI);
      return { loops: [rr(b, h, ro), rr(b - 2 * t, h - 2 * t, ri).reverse()], It: (4 * Ap * Ap * t) / p, closed: true, thin: true };
    }
    case "iSym":
    case "iAsym": {
      const sym = id === "iSym";
      const b1 = sym ? d.b : d.b1, t1 = sym ? d.tf : d.tf1, b2 = sym ? d.b : d.b2, t2 = sym ? d.tf : d.tf2, tw = d.tw, h = d.h;
      const p: Pt[] = [
        { x: -b2 / 2, y: 0 }, { x: b2 / 2, y: 0 }, { x: b2 / 2, y: t2 }, { x: tw / 2, y: t2 }, { x: tw / 2, y: h - t1 },
        { x: b1 / 2, y: h - t1 }, { x: b1 / 2, y: h }, { x: -b1 / 2, y: h }, { x: -b1 / 2, y: h - t1 }, { x: -tw / 2, y: h - t1 },
        { x: -tw / 2, y: t2 }, { x: -b2 / 2, y: t2 },
      ];
      return { loops: [p], It: (b1 * t1 ** 3 + b2 * t2 ** 3 + (h - t1 - t2) * tw ** 3) / 3, closed: false, thin: true };
    }
    case "tee": {
      const { h, b, tw, tf } = d;
      const p: Pt[] = [
        { x: -tw / 2, y: 0 }, { x: tw / 2, y: 0 }, { x: tw / 2, y: h - tf }, { x: b / 2, y: h - tf }, { x: b / 2, y: h },
        { x: -b / 2, y: h }, { x: -b / 2, y: h - tf }, { x: -tw / 2, y: h - tf },
      ];
      return { loops: [p], It: (b * tf ** 3 + (h - tf) * tw ** 3) / 3, closed: false, thin: true };
    }
    case "channel": {
      const { h, b, tw, tf } = d;
      const p: Pt[] = [
        { x: 0, y: 0 }, { x: b, y: 0 }, { x: b, y: tf }, { x: tw, y: tf }, { x: tw, y: h - tf }, { x: b, y: h - tf },
        { x: b, y: h }, { x: 0, y: h },
      ];
      return { loops: [p], It: (2 * b * tf ** 3 + (h - 2 * tf) * tw ** 3) / 3, closed: false, thin: true };
    }
    case "angle": {
      const { h, b, t } = d;
      const p: Pt[] = [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: b, y: t }, { x: t, y: t }, { x: t, y: h }, { x: 0, y: h }];
      return { loops: [p], It: ((h + b - t) * t ** 3) / 3, closed: false, thin: true };
    }
    case "zed": {
      const { h, b, c, t } = d;
      const hc = h - t, bc = b - t, cc = c - t / 2;
      const pts = [
        ...(c > 0 ? [{ x: bc, y: cc }] : []), { x: bc, y: 0 }, { x: 0, y: 0 }, { x: 0, y: hc }, { x: -bc, y: hc },
        ...(c > 0 ? [{ x: -bc, y: hc - cc }] : []),
      ];
      const L = hc + 2 * bc + (c > 0 ? 2 * cc : 0);
      return { loops: [thickPolyline(pts, t)], It: (L * t ** 3) / 3, closed: false, thin: true };
    }
    case "cLip": {
      const { h, b, c, t } = d;
      const hc = h - t, bc = b - t, cc = c - t / 2;
      const pts = [
        ...(c > 0 ? [{ x: bc, y: cc }] : []), { x: bc, y: 0 }, { x: 0, y: 0 }, { x: 0, y: hc }, { x: bc, y: hc },
        ...(c > 0 ? [{ x: bc, y: hc - cc }] : []),
      ];
      const L = hc + 2 * bc + (c > 0 ? 2 * cc : 0);
      return { loops: [thickPolyline(pts, t)], It: (L * t ** 3) / 3, closed: false, thin: true };
    }
    case "omega": {
      const { h, b, bf, t } = d;
      const hc = h - t, bc = b - t, fc = bf - t / 2;
      const pts = [
        { x: -bc / 2 - fc, y: 0 }, { x: -bc / 2, y: 0 }, { x: -bc / 2, y: hc }, { x: bc / 2, y: hc }, { x: bc / 2, y: 0 }, { x: bc / 2 + fc, y: 0 },
      ];
      const L = 2 * fc + 2 * hc + bc;
      return { loops: [thickPolyline(pts, t)], It: (L * t ** 3) / 3, closed: false, thin: true };
    }
  }
}

export interface GeomProps {
  A: number; mass: number;
  /** центр ваги від лівого нижнього кута габариту */
  yc: number; zc: number;
  H: number; B: number;
  Iy: number; Iz: number; Iyz: number;
  I1: number; I2: number; alpha: number; // головні моменти, кут головної осі (рад) від y
  Wy_top: number; Wy_bot: number; Wz_left: number; Wz_right: number;
  iy: number; iz: number; i1: number; i2: number;
  Wply: number; Wplz: number;
  Sy: number; Sz: number; // статичний момент половини перерізу відносно осей через центр ваги
  It: number; Ip: number;
  loops: Loop[];
}

export function shapeProps(id: ShapeId, dims: Record<string, number>, rho = 7850): GeomProps {
  const g = buildShape(id, dims);
  const m0 = sumMoments(g.loops);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const l of g.loops) for (const p of l) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
  const cx = m0.Sy / m0.A, cy = m0.Sx / m0.A;
  const loops = translate(g.loops, -cx, -cy);
  const m = sumMoments(loops);
  const Iy = m.Ixx, Iz = m.Iyy, Iyz = m.Ixy;
  const avg = (Iy + Iz) / 2, dif = Math.sqrt(((Iy - Iz) / 2) ** 2 + Iyz ** 2);
  const I1 = avg + dif, I2 = avg - dif;
  const alpha = Math.abs(Iyz) < 1e-9 * (Iy + Iz) ? 0 : 0.5 * Math.atan2(-2 * Iyz, Iy - Iz);
  const half = (ls: Loop[]) => {
    // статичний момент частини вище осі через центр ваги
    const top = sumMoments(ls.map((l) => clipY(l)));
    return top.Sx;
  };
  return {
    A: m.A, mass: (m.A * rho) / 1e6,
    yc: cx - xmin, zc: cy - ymin, H: ymax - ymin, B: xmax - xmin,
    Iy, Iz, Iyz, I1, I2, alpha,
    Wy_top: Iy / (ymax - cy), Wy_bot: Iy / (cy - ymin), Wz_left: Iz / (cx - xmin), Wz_right: Iz / (xmax - cx),
    iy: Math.sqrt(Iy / m.A), iz: Math.sqrt(Iz / m.A), i1: Math.sqrt(I1 / m.A), i2: Math.sqrt(Math.max(0, I2) / m.A),
    Wply: plasticModulusX(loops), Wplz: plasticModulusX(swapXY(loops)),
    Sy: half(loops), Sz: half(swapXY(loops)),
    It: g.It, Ip: Iy + Iz,
    loops,
  };
}

function clipY(p: Loop): Loop {
  const out: Loop = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (a.y >= 0) out.push(a);
    if ((a.y >= 0) !== (b.y >= 0)) { const t = -a.y / (b.y - a.y); out.push({ x: a.x + t * (b.x - a.x), y: 0 }); }
  }
  return out;
}

/** Густини, кг/м³ */
export const DENSITIES: { id: string; rho: number }[] = [
  { id: "steel", rho: 7850 }, { id: "stainless", rho: 7950 }, { id: "aluminium", rho: 2700 },
  { id: "concrete", rho: 2500 }, { id: "timber", rho: 500 }, { id: "glulam", rho: 450 },
];
