// Плоский чотирикутний елемент оболонки: мембрана Q4 з несумісними модами (QM6, Тейлор) + згин МІТЦ4 (Bathe–Dvorkin,
// пластина Міндліна з інтерпольованими зсувними деформаціями — без «замикання» для тонких плит) + штучна жорсткість
// на поворот у площині. 6 ступенів вільності у вузлі (u, v, w, θx, θy, θz), Н, мм, МПа.
// Локальні осі елемента: x — уздовж середини сторін 1–2 / 4–3, z — нормаль (правило правої руки за порядком вузлів), y = z × x.
// Зусилля на одиницю довжини: n — Н/мм (розтяг > 0), m — Н·мм/мм (m > 0 — розтягнута сторона +z), q — Н/мм.

import type { Vec3 } from "./frame3d";

export interface ShellElement {
  id: string;
  nodes: [string, string, string, string];
  /** товщина, мм */
  t: number;
  E: number;
  nu: number;
  /** густина, кг/м³ */
  rho?: number;
}

/** Тиск на елемент: q (МПа) уздовж нормалі елемента (normal) або глобальної осі; projected — на горизонтальну проєкцію */
export interface ShellLoad { shell: string; q: number; dir: "normal" | "gx" | "gy" | "gz"; projected?: boolean }

export interface ShellForces {
  /** у центрі елемента: [nx, ny, nxy, mx, my, mxy, qx, qy] */
  c: number[];
  /** у точках Гаусса 2×2 */
  gp: number[][];
  /** у вузлах 1–4 (екстраполяція з точок Гаусса) */
  corner: number[][];
  /** еквівалентні напруження (фон Мізес) на верхній і нижній поверхні: максимум по точках Гаусса, МПа */
  svm: number;
  /** зусилля від вузлів на елемент, глобальні, по 6 на вузол */
  nodal: number[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const XI = [-1, 1, 1, -1], ETA = [-1, -1, 1, 1];
const G2 = 1 / Math.sqrt(3);
const GP: [number, number][] = [[-G2, -G2], [G2, -G2], [G2, G2], [-G2, G2]];

/** Локальна система елемента: рядки R — e1, e2, n; xy — локальні координати вузлів у площині */
export function shellFrame(P: Vec3[]) {
  const n = unit(cross(sub(P[2], P[0]), sub(P[3], P[1])));
  let e1 = sub(add(P[1], P[2]), add(P[0], P[3]));
  e1 = unit(sub(e1, [n[0] * dot(e1, n), n[1] * dot(e1, n), n[2] * dot(e1, n)]));
  const e2 = cross(n, e1);
  const c: Vec3 = [(P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4, (P[0][1] + P[1][1] + P[2][1] + P[3][1]) / 4, (P[0][2] + P[1][2] + P[2][2] + P[3][2]) / 4];
  const xy = P.map((p) => { const d = sub(p, c); return [dot(d, e1), dot(d, e2)] as [number, number]; });
  return { R: [e1, e2, n] as [Vec3, Vec3, Vec3], xy, c };
}

function shape(xi: number, eta: number) {
  const N = XI.map((a, k) => ((1 + a * xi) * (1 + ETA[k] * eta)) / 4);
  const dxi = XI.map((a, k) => (a * (1 + ETA[k] * eta)) / 4);
  const deta = XI.map((a, k) => (ETA[k] * (1 + a * xi)) / 4);
  return { N, dxi, deta };
}

function jac(xy: [number, number][], xi: number, eta: number) {
  const s = shape(xi, eta);
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0; // x,ξ y,ξ x,η y,η
  for (let k = 0; k < 4; k++) { x1 += s.dxi[k] * xy[k][0]; y1 += s.dxi[k] * xy[k][1]; x2 += s.deta[k] * xy[k][0]; y2 += s.deta[k] * xy[k][1]; }
  const det = x1 * y2 - y1 * x2;
  // J = [[x,ξ y,ξ],[x,η y,η]], J⁻¹ = 1/det [[y,η −y,ξ],[−x,η x,ξ]]
  const inv = [[y2 / det, -y1 / det], [-x2 / det, x1 / det]];
  const dx = s.dxi.map((v, k) => inv[0][0] * v + inv[0][1] * s.deta[k]);
  const dy = s.dxi.map((v, k) => inv[1][0] * v + inv[1][1] * s.deta[k]);
  return { ...s, det, inv, J: [[x1, y1], [x2, y2]], dx, dy };
}

const Dplane = (E: number, nu: number, f: number) => { const c = (E * f) / (1 - nu * nu); return [[c, c * nu, 0], [c * nu, c, 0], [0, 0, (c * (1 - nu)) / 2]]; };

/** Матриці B у точці: мембрана (3×24), згин (3×24), зсув МІТЦ4 (2×24) — у локальних ступенях вузлів */
function Bmats(xy: [number, number][], xi: number, eta: number) {
  const j = jac(xy, xi, eta);
  const Bm = [new Array(24).fill(0), new Array(24).fill(0), new Array(24).fill(0)];
  const Bb = [new Array(24).fill(0), new Array(24).fill(0), new Array(24).fill(0)];
  for (let k = 0; k < 4; k++) {
    const o = k * 6;
    Bm[0][o] = j.dx[k]; Bm[1][o + 1] = j.dy[k]; Bm[2][o] = j.dy[k]; Bm[2][o + 1] = j.dx[k];
    // κx = ∂θy/∂x, κy = −∂θx/∂y, κxy = ∂θy/∂y − ∂θx/∂x
    Bb[0][o + 4] = j.dx[k]; Bb[1][o + 3] = -j.dy[k]; Bb[2][o + 4] = j.dy[k]; Bb[2][o + 3] = -j.dx[k];
  }
  // коваріантні зсувні деформації в точках прив'язки: γξ = w,ξ + θy·x,ξ − θx·y,ξ ; γη = w,η + θy·x,η − θx·y,η
  const gxi = (a: number, b: number) => {
    const t = jac(xy, a, b), r = new Array(24).fill(0);
    for (let k = 0; k < 4; k++) { r[k * 6 + 2] = t.dxi[k]; r[k * 6 + 4] = t.N[k] * t.J[0][0]; r[k * 6 + 3] = -t.N[k] * t.J[0][1]; }
    return r;
  };
  const geta = (a: number, b: number) => {
    const t = jac(xy, a, b), r = new Array(24).fill(0);
    for (let k = 0; k < 4; k++) { r[k * 6 + 2] = t.deta[k]; r[k * 6 + 4] = t.N[k] * t.J[1][0]; r[k * 6 + 3] = -t.N[k] * t.J[1][1]; }
    return r;
  };
  const A = gxi(0, 1), C = gxi(0, -1), B = geta(-1, 0), D = geta(1, 0);
  const gx = A.map((v, q) => 0.5 * (1 + eta) * v + 0.5 * (1 - eta) * C[q]);
  const ge = D.map((v, q) => 0.5 * (1 + xi) * v + 0.5 * (1 - xi) * B[q]);
  // [γxz; γyz] = J⁻¹ [γξ; γη]
  const Bs = [gx.map((v, q) => j.inv[0][0] * v + j.inv[0][1] * ge[q]), gx.map((v, q) => j.inv[1][0] * v + j.inv[1][1] * ge[q])];
  return { j, Bm, Bb, Bs };
}

/** Несумісні моди QM6 (Тейлор: похідні з якобіаном центру) — B 3×4 для α = [a1 a2 a3 a4] (u: 1−ξ², 1−η²; v: те саме) */
function Binc(xy: [number, number][], xi: number, eta: number) {
  const j0 = jac(xy, 0, 0);
  const dPdxi = [-2 * xi, 0], dPdeta = [0, -2 * eta];
  const dx = [0, 1].map((k) => j0.inv[0][0] * dPdxi[k] + j0.inv[0][1] * dPdeta[k]);
  const dy = [0, 1].map((k) => j0.inv[1][0] * dPdxi[k] + j0.inv[1][1] * dPdeta[k]);
  return [[dx[0], dx[1], 0, 0], [0, 0, dy[0], dy[1]], [dy[0], dy[1], dx[0], dx[1]]];
}

function invSmall(A: number[][]) {
  const n = A.length, a = A.map((r, i) => [...r, ...r.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let q = 0; q < 2 * n; q++) a[c][q] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const k = a[r][c]; if (k) for (let q = 0; q < 2 * n; q++) a[r][q] -= k * a[c][q]; }
  }
  return a.map((r) => r.slice(n));
}

/** Додає Bᵀ D B · w до K */
function addBtDB(K: number[][], B: number[][], D: number[][], w: number) {
  const nq = B.length, n = B[0].length;
  const nz: number[] = [];
  for (let c = 0; c < n; c++) for (let q = 0; q < nq; q++) if (B[q][c]) { nz.push(c); break; }
  const DB = D.map((row) => { const o = new Array(n).fill(0); for (const c of nz) { let s = 0; for (let q = 0; q < nq; q++) s += row[q] * B[q][c]; o[c] = s; } return o; });
  for (const r of nz) for (const c of nz) { let s = 0; for (let q = 0; q < nq; q++) s += B[q][r] * DB[q][c]; K[r][c] += s * w; }
}

export interface ShellPrepared {
  R: [Vec3, Vec3, Vec3]; xy: [number, number][];
  /** глобальна 24×24 */
  K: number[][];
  /** для відновлення несумісних мод: α = −Kaa⁻¹ Kau u */
  KaaInvKau: number[][];
  area: number;
}

export function shellPrepare(e: ShellElement, P: Vec3[]): ShellPrepared {
  const { R, xy } = shellFrame(P);
  const Dm = Dplane(e.E, e.nu, e.t), Db = Dplane(e.E, e.nu, (e.t ** 3) / 12);
  const Gs = (e.E / (2 * (1 + e.nu))) * e.t * (5 / 6);
  const Ds = [[Gs, 0], [0, Gs]];
  const K = Array.from({ length: 24 }, () => new Array(24).fill(0));
  const Kaa = Array.from({ length: 4 }, () => new Array(4).fill(0));
  const Kau = Array.from({ length: 4 }, () => new Array(24).fill(0));
  let area = 0;
  for (const [xi, eta] of GP) {
    const { j, Bm, Bb, Bs } = Bmats(xy, xi, eta);
    const w = j.det;
    area += w;
    addBtDB(K, Bm, Dm, w); addBtDB(K, Bb, Db, w); addBtDB(K, Bs, Ds, w);
    const Ba = Binc(xy, xi, eta);
    const DBa = Dm.map((row) => [0, 1, 2, 3].map((c) => row.reduce((s, v, q) => s + v * Ba[q][c], 0)));
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) Kaa[a][b] += (Ba[0][a] * DBa[0][b] + Ba[1][a] * DBa[1][b] + Ba[2][a] * DBa[2][b]) * w;
    for (let c = 0; c < 24; c++) {
      if (!Bm[0][c] && !Bm[1][c] && !Bm[2][c]) continue;
      const d0 = Dm[0][0] * Bm[0][c] + Dm[0][1] * Bm[1][c] + Dm[0][2] * Bm[2][c];
      const d1 = Dm[1][0] * Bm[0][c] + Dm[1][1] * Bm[1][c] + Dm[1][2] * Bm[2][c];
      const d2 = Dm[2][0] * Bm[0][c] + Dm[2][1] * Bm[1][c] + Dm[2][2] * Bm[2][c];
      for (let a = 0; a < 4; a++) Kau[a][c] += (Ba[0][a] * d0 + Ba[1][a] * d1 + Ba[2][a] * d2) * w;
    }
  }
  // конденсація несумісних мод
  const Ki = invSmall(Kaa);
  const KaaInvKau = Ki.map((row) => Kau[0].map((_, c) => row.reduce((s, v, q) => s + v * Kau[q][c], 0)));
  for (let r = 0; r < 24; r++) for (let c = 0; c < 24; c++) { let s = 0; for (let q = 0; q < 4; q++) s += Kau[q][r] * KaaInvKau[q][c]; K[r][c] -= s; }
  // поворот у площині — мала штучна жорсткість
  const kd = 1e-3 * e.E * e.t * area;
  for (let k = 0; k < 4; k++) K[k * 6 + 5][k * 6 + 5] += kd;
  // у глобальні: Kg = Tᵀ K T, T — блоки R (рядки e1, e2, n)
  const Kg = Array.from({ length: 24 }, () => new Array(24).fill(0));
  const KT = Array.from({ length: 24 }, () => new Array(24).fill(0));
  for (let r = 0; r < 24; r++) for (let c = 0; c < 24; c++) {
    const b = Math.floor(c / 3) * 3, cc = c % 3;
    KT[r][c] = K[r][b] * R[0][cc] + K[r][b + 1] * R[1][cc] + K[r][b + 2] * R[2][cc];
  }
  for (let r = 0; r < 24; r++) {
    const b = Math.floor(r / 3) * 3, rr = r % 3;
    for (let c = 0; c < 24; c++) Kg[r][c] = R[0][rr] * KT[b][c] + R[1][rr] * KT[b + 1][c] + R[2][rr] * KT[b + 2][c];
  }
  return { R, xy, K: Kg, KaaInvKau, area };
}

/** Вузлові сили (глобальні, 24) від тиску q і/або власної ваги (2×2 Гаусс, білінійні функції) */
export function shellLoadVector(e: ShellElement, sp: ShellPrepared, loads: ShellLoad[], selfWeight: number): number[] {
  const f = new Array(24).fill(0);
  const n = sp.R[2];
  for (const [xi, eta] of GP) {
    const j = jac(sp.xy, xi, eta);
    let F: Vec3 = [0, 0, 0];
    for (const l of loads) {
      const d: Vec3 = l.dir === "normal" ? n : l.dir === "gx" ? [1, 0, 0] : l.dir === "gy" ? [0, 1, 0] : [0, 0, 1];
      const k = l.q * (l.projected ? Math.abs(n[2]) : 1);
      F = add(F, [d[0] * k, d[1] * k, d[2] * k]);
    }
    if (selfWeight && e.rho) F = add(F, [0, 0, -e.rho * 1e-9 * 9.81 * e.t * selfWeight]);
    for (let k = 0; k < 4; k++) for (let q = 0; q < 3; q++) f[k * 6 + q] += j.N[k] * F[q] * j.det;
  }
  return f;
}

/** Зусилля в елементі за глобальними переміщеннями вузлів (24) */
export function shellForces(e: ShellElement, sp: ShellPrepared, ug: number[], fload: number[]): ShellForces {
  const R = sp.R;
  const ul = new Array(24).fill(0);
  for (let b = 0; b < 8; b++) for (let r = 0; r < 3; r++) ul[b * 3 + r] = R[r][0] * ug[b * 3] + R[r][1] * ug[b * 3 + 1] + R[r][2] * ug[b * 3 + 2];
  const alpha = sp.KaaInvKau.map((row) => -row.reduce((s, v, q) => s + v * ul[q], 0));
  const Dm = Dplane(e.E, e.nu, e.t), Db = Dplane(e.E, e.nu, (e.t ** 3) / 12);
  const Gs = (e.E / (2 * (1 + e.nu))) * e.t * (5 / 6);
  const at = (xi: number, eta: number) => {
    const { Bm, Bb, Bs } = Bmats(sp.xy, xi, eta);
    const Ba = Binc(sp.xy, xi, eta);
    const eps = [0, 1, 2].map((q) => Bm[q].reduce((s, v, c) => s + v * ul[c], 0) + Ba[q].reduce((s, v, c) => s + v * alpha[c], 0));
    const kap = [0, 1, 2].map((q) => Bb[q].reduce((s, v, c) => s + v * ul[c], 0));
    const gam = [0, 1].map((q) => Bs[q].reduce((s, v, c) => s + v * ul[c], 0));
    const nn = Dm.map((row) => row.reduce((s, v, q) => s + v * eps[q], 0));
    const mm = Db.map((row) => row.reduce((s, v, q) => s + v * kap[q], 0));
    return [...nn, ...mm, Gs * gam[0], Gs * gam[1]];
  };
  const gp = GP.map(([a, b]) => at(a, b));
  const c = at(0, 0);
  // екстраполяція з точок Гаусса у вузли: значення білінійної інтерполяції в ξ, η = ±√3
  const s3 = Math.sqrt(3);
  const corner = [0, 1, 2, 3].map((k) => {
    const N = [0, 1, 2, 3].map((g) => ((1 + Math.sign(GP[g][0]) * XI[k] * s3) * (1 + Math.sign(GP[g][1]) * ETA[k] * s3)) / 4);
    return c.map((_, q) => gp.reduce((s, v, g) => s + v[q] * N[g], 0));
  });
  const svm = Math.max(...gp.map((f) => shellVonMises(f, e.t)));
  const nodal = sp.K.map((row, r) => row.reduce((s, v, q) => s + v * ug[q], 0) - fload[r]);
  return { c, gp, corner, svm, nodal };
}

/** Еквівалентні напруження на поверхнях за зусиллями [nx, ny, nxy, mx, my, mxy] */
export function shellVonMises(f: number[], t: number) {
  let mx = 0;
  for (const sg of [1, -1]) {
    const sx = f[0] / t + (sg * 6 * f[3]) / (t * t), sy = f[1] / t + (sg * 6 * f[4]) / (t * t), txy = f[2] / t + (sg * 6 * f[5]) / (t * t);
    mx = Math.max(mx, Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * txy * txy));
  }
  return mx;
}
