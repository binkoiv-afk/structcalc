// Залізобетонна колона прямокутного перерізу: косий позацентровий стиск за деформаційним методом
// (ДСТУ Б В.2.6-156:2010, 4.5, (4.30)–(4.35)), впливи другого порядку загальним методом (ДБН В.2.6-98:2009, 5.7.4;
// EN 1992-1-1, 5.8.6), неточності (ДСТУ 6.1, EN 5.2), повзучість через φ_ef (ДСТУ 6.4, EN 5.8.4),
// конструювання колон (ДСТУ 8.5, EN 9.5).
// Одиниці всередині — мм, Н, МПа; на вході й виході — кН, кН·м, м.
import type { Check, CodeId } from "../codes/types";
import { mkCheck } from "../codes/types";
import { epsUd, fyd, rcConcrete, rcSigmaC } from "./rc";
import type { RcConcrete } from "./rc";

const ES = 200000;
/** волокон бетону уздовж більшої сторони (16 — відхилення від 24 менше 0.1 %) */
const GRID = 16;
const barA = (d: number) => (Math.PI * d * d) / 4;

export interface RcColInput {
  code: CodeId; concrete: string; rebar: string;
  /** переріз: b — уздовж осі x, h — уздовж осі y, мм; захисний шар до хомута, мм */
  b: number; h: number; c: number;
  /** 4 кутові стрижні Ø d; nb — проміжних на кожній грані довжиною b, nh — на кожній грані довжиною h */
  bars: { d: number; nb: number; nh: number };
  /** хомути: діаметр, крок, клас */
  tie: { d: number; s: number; cls: string };
  /** проміжні стрижні закріплені шпильками або додатковими хомутами (8.5.3.6) */
  tieAll?: boolean;
  /** довжина колони, м; коефіцієнти розрахункової довжини (рис. 6.2): μx — згин у площині h (момент M_x), μy — у площині b */
  L: number; mux: number; muy: number;
  /** розрахункові зусилля: N (+ — стиск), кН; моменти першого порядку на кінцях (верх 1, низ 2), кН·м */
  N: number; Mx1: number; Mx2: number; My1: number; My2: number;
  /** φ(∞, t0) і відношення M_0Eqp / M_0Ed (квазіпостійне до розрахункового) */
  phi: number; qp: number;
}

export interface ColFibres { x: Float64Array; y: Float64Array; A: Float64Array; bars: { x: number; y: number; A: number; d: number }[] }

/** Сітка волокон бетону і стрижні (початок координат — центр перерізу) */
export function colFibres(i: RcColInput): ColFibres {
  const nx = Math.max(8, Math.round((GRID * i.b) / Math.max(i.b, i.h))), ny = Math.max(8, Math.round((GRID * i.h) / Math.max(i.b, i.h)));
  const x = new Float64Array(nx * ny), y = new Float64Array(nx * ny), A = new Float64Array(nx * ny), dA = (i.b / nx) * (i.h / ny);
  for (let p = 0; p < nx; p++) for (let q = 0; q < ny; q++) {
    const k = p * ny + q;
    x[k] = -i.b / 2 + ((p + 0.5) * i.b) / nx; y[k] = -i.h / 2 + ((q + 0.5) * i.h) / ny; A[k] = dA;
  }
  const a = i.c + i.tie.d + i.bars.d / 2, X = i.b / 2 - a, Y = i.h / 2 - a, Ab = barA(i.bars.d), d = i.bars.d;
  const bars: ColFibres["bars"] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) bars.push({ x: sx * X, y: sy * Y, A: Ab, d });
  for (let k = 1; k <= i.bars.nb; k++) for (const sy of [-1, 1]) bars.push({ x: -X + (2 * X * k) / (i.bars.nb + 1), y: sy * Y, A: Ab, d });
  for (let k = 1; k <= i.bars.nh; k++) for (const sx of [-1, 1]) bars.push({ x: sx * X, y: -Y + (2 * Y * k) / (i.bars.nh + 1), A: Ab, d });
  return { x, y, A, bars };
}

/** Матеріали для перерізу: φ — коефіцієнт повзучості, на (1 + φ) множаться деформації діаграми бетону (ДБН 5.7.4.4) */
interface Mat { code: CodeId; conc: RcConcrete; fy: number; eud: number; cr: number }
const sigC = (m: Mat, e: number) => rcSigmaC(m.code, m.conc, e / m.cr);
const etC = (m: Mat, e: number) => {
  if (e < 0) return 0;
  const d = 1e-6 * m.cr, a = Math.max(0, e - d);
  return (sigC(m, e + d) - sigC(m, a)) / (e + d - a);
};
const sigS = (m: Mat, e: number) => Math.max(-m.fy, Math.min(m.fy, ES * e));
const etS = (m: Mat, e: number) => (Math.abs(ES * e) < m.fy ? ES : 0);

export interface StrainPlane { e0: number; kx: number; ky: number }

/** Внутрішні зусилля (4.30)–(4.32) і дотична жорсткість; ε = e0 + kx·y + ky·x (стиск +); стрижні — за вирахуванням бетону під ними */
function internal(s: ColFibres, m: Mat, p: StrainPlane) {
  let N = 0, Mx = 0, My = 0;
  const K = [0, 0, 0, 0, 0, 0]; // 00 01 02 11 12 22
  const add = (x: number, y: number, sA: number, tA: number) => {
    N += sA; Mx += sA * y; My += sA * x;
    K[0] += tA; K[1] += tA * y; K[2] += tA * x; K[3] += tA * y * y; K[4] += tA * x * y; K[5] += tA * x * x;
  };
  for (let k = 0; k < s.A.length; k++) {
    const e = p.e0 + p.kx * s.y[k] + p.ky * s.x[k];
    if (e >= 0) add(s.x[k], s.y[k], sigC(m, e) * s.A[k], etC(m, e) * s.A[k]);
  }
  for (const b of s.bars) {
    const e = p.e0 + p.kx * b.y + p.ky * b.x;
    add(b.x, b.y, (sigS(m, e) - sigC(m, e)) * b.A, (etS(m, e) - etC(m, e)) * b.A);
  }
  return { N, Mx, My, K };
}

function solve3(K: number[], r: number[]): number[] | null {
  const a = [[K[0], K[1], K[2]], [K[1], K[3], K[4]], [K[2], K[4], K[5]]];
  const det = a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const sc = Math.abs(a[0][0] * a[1][1] * a[2][2]);
  if (!(Math.abs(det) > 1e-12 * sc) || !Number.isFinite(det)) return null;
  const dx = (r[0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (r[1] * a[2][2] - a[1][2] * r[2]) + a[0][2] * (r[1] * a[2][1] - a[1][1] * r[2])) / det;
  const dy = (a[0][0] * (r[1] * a[2][2] - a[1][2] * r[2]) - r[0] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * r[2] - r[1] * a[2][0])) / det;
  const dz = (a[0][0] * (a[1][1] * r[2] - r[1] * a[2][1]) - a[0][1] * (a[1][0] * r[2] - r[1] * a[2][0]) + r[0] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])) / det;
  return [dx, dy, dz];
}

/** Деформації в крайніх точках: найбільший стиск бетону, найбільший розтяг стрижня, умова стиску всього перерізу (півот C) */
function limitsOk(i: RcColInput, s: ColFibres, m: Mat, p: StrainPlane) {
  const cs = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sy]) => p.e0 + p.kx * (sy * i.h) / 2 + p.ky * (sx * i.b) / 2);
  const eMax = Math.max(...cs), eMin = Math.min(...cs);
  const ecu = m.conc.ecu * m.cr, ec1 = m.conc.ec1 * m.cr;
  if (eMax > ecu * (1 + 1e-9)) return false;
  for (const b of s.bars) if (p.e0 + p.kx * b.y + p.ky * b.x < -m.eud) return false;
  // увесь переріз стиснутий: деформація на відстані (1 − ε_c1/ε_cu)·h від найбільш стиснутої грані ≤ ε_c1 (EN 6.1 (5), рис. 6.1 «C»)
  if (eMin > 0 && eMax - (eMax - eMin) * (1 - ec1 / ecu) > ec1 * (1 + 1e-9)) return false;
  return true;
}

/** Обернена задача (4.30)–(4.32): площина деформацій за N, Mx, My (Н, Н·мм) методом Ньютона */
function solvePlane(i: RcColInput, s: ColFibres, m: Mat, N: number, Mx: number, My: number, g: StrainPlane): StrainPlane | null {
  const q = newton(i, s, m, N, Mx, My, g);
  return q || (g.e0 === 0 && g.kx === 0 && g.ky === 0) ? q : newton(i, s, m, N, Mx, My, { e0: 0, kx: 0, ky: 0 });
}
function newton(i: RcColInput, s: ColFibres, m: Mat, N: number, Mx: number, My: number, g: StrainPlane): StrainPlane | null {
  let p = { ...g };
  const sc = m.conc.fcd * i.b * i.h, tol = 1e-7 * sc, tolM = 1e-7 * sc * Math.max(i.b, i.h);
  let r = internal(s, m, p);
  const res = (q: typeof r) => Math.max(Math.abs(N - q.N) / tol, Math.abs(Mx - q.Mx) / tolM, Math.abs(My - q.My) / tolM);
  let rn = res(r);
  for (let it = 0; it < 60; it++) {
    if (rn < 1) return p;
    let d = solve3(r.K, [N - r.N, Mx - r.Mx, My - r.My]);
    if (!d) {
      // дотична вироджена (усі волокна текучі або без напружень) — додаємо пружну жорсткість бетону для кроку
      const K = r.K.slice(), E0 = m.conc.Ecd / m.cr, Ac = i.b * i.h;
      K[0] += E0 * Ac * 1e-3; K[3] += (E0 * Ac * i.h * i.h) / 12e3; K[5] += (E0 * Ac * i.b * i.b) / 12e3;
      d = solve3(K, [N - r.N, Mx - r.Mx, My - r.My]);
      if (!d) return null;
    }
    // з нульового стану (злам діаграми при ε = 0) перший крок — пружний, без пошуку вздовж напрямку
    if (it === 0 && p.e0 === 0 && p.kx === 0 && p.ky === 0) {
      p = { e0: d[0], kx: d[1], ky: d[2] }; r = internal(s, m, p); rn = res(r); continue;
    }
    let a = 1, ok = false;
    for (let ls = 0; ls < 12; ls++) {
      const q = { e0: p.e0 + a * d[0], kx: p.kx + a * d[1], ky: p.ky + a * d[2] }, rq = internal(s, m, q), nq = res(rq);
      if (nq < rn || nq < 1) { p = q; r = rq; rn = nq; ok = true; break; }
      a /= 2;
    }
    if (!ok) return null;
    if (Math.abs(p.e0) > 1 || Math.abs(p.kx) * i.h > 1 || Math.abs(p.ky) * i.b > 1) return null;
  }
  return rn < 1 ? p : null;
}

/** Найбільший множник λ до зусиль λ·(N, Mx, My), за якого переріз ще в рівновазі в межах граничних деформацій */
function sectionFactor(i: RcColInput, s: ColFibres, m: Mat, N: number, Mx: number, My: number): { lam: number; plane: StrainPlane } {
  let p: StrainPlane = { e0: 0, kx: 0, ky: 0 }, lo = 0, hi = 0, step = 0.25, pLo = p;
  const at = (l: number, g: StrainPlane) => { const q = solvePlane(i, s, m, l * N, l * Mx, l * My, g); return q && limitsOk(i, s, m, q) ? q : null; };
  for (let k = 0; k < 200; k++) {
    const l = lo + step, q = at(l, pLo);
    if (q) { lo = l; pLo = q; step *= 1.5; if (lo > 1e4) return { lam: Infinity, plane: q }; }
    else { hi = l; break; }
  }
  for (let k = 0; k < 40 && hi - lo > 1e-4 * hi; k++) {
    const l = (lo + hi) / 2, q = at(l, pLo);
    if (q) { lo = l; pLo = q; } else hi = l;
  }
  return { lam: lo, plane: pLo };
}

export interface ColAxis {
  /** розрахункова довжина, мм; радіус інерції, мм; гнучкість (6.8) і гранична (6.7) */
  l0: number; i: number; lam: number; lamLim: number; A: number; B: number; C: number; rm: number;
  /** еквівалентний момент першого порядку M0e = max(0.6·M02 + 0.4·M01; 0.4·M02), кН·м */
  M0e: number; M02: number;
  /** номінальна кривизна (EN 5.8.8) — для порівняння: e2, мм; M_Ed, кН·м */
  e2nc: number; MEdNc: number;
}
export interface ColCase {
  /** у якій площині прикладено неточність */
  imp: "x" | "y";
  /** множник навантаження до вичерпання (загальний метод) і стан при λ = 1 */
  lamU: number; ok1: boolean; u: { x: number; y: number }; M: { x: number; y: number }; plane?: StrainPlane;
  /** форма прогину при λ = 1 (ξ = 0…1), мм */
  ux: number[]; uy: number[];
}
export interface RcColResult {
  conc: RcConcrete; fyd: number; Ac: number; As: number; nBars: number; phiEf: number; creepIgnored: boolean;
  ei: { x: number; y: number }; e0min: number; omega: number; n: number;
  ax: { x: ColAxis; y: ColAxis };
  cases: ColCase[]; gov: ColCase;
  /** кінці колони без впливів другого порядку: множник λ і переріз */
  ends: { lam: number; Mx: number; My: number }[];
  /** діаграми взаємодії N–M (без повзучості) для згину M_x і M_y: N, кН; M, кН·м */
  diag: { x: { N: number; M: number }[]; y: { N: number; M: number }[] };
  checks: Check[]; maxUtil: number;
  bars: ColFibres["bars"];
}

/** Еквівалентний момент (ДСТУ 6.2.2.1: r_m = M01/M02; EN 5.8.8.2 (2)) */
function m0e(M1: number, M2: number) {
  const [a, b] = Math.abs(M1) > Math.abs(M2) ? [M2, M1] : [M1, M2];
  if (b === 0) return { M0e: 0, M02: 0, rm: 1 };
  const rm = a / b; // > 0 — однозначна кривина
  return { M0e: Math.sign(b) * Math.max(0.6 * Math.abs(b) + 0.4 * rm * Math.abs(b), 0.4 * Math.abs(b)), M02: b, rm };
}

/** Прогин шарнірного стрижня довжиною l0 від кривини κ(ξ) у вузлах (функція Гріна) */
function deflect(kap: number[], l0: number) {
  const n = kap.length - 1, u: number[] = [];
  for (let j = 0; j <= n; j++) {
    const xi = j / n;
    let s = 0;
    for (let k = 0; k <= n; k++) {
      const z = k / n, w = k === 0 || k === n ? 0.5 / n : 1 / n;
      s += w * kap[k] * (z <= xi ? z * (1 - xi) : xi * (1 - z));
    }
    u.push(s * l0 * l0);
  }
  return u;
}

export function checkRcColumn(i: RcColInput): RcColResult {
  const code = i.code, conc = rcConcrete(code, i.concrete), checks: Check[] = [];
  const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");
  const DS = "ДСТУ Б В.2.6-156:2010";
  const s = colFibres(i), Ac = i.b * i.h, As = s.bars.reduce((a, b) => a + b.A, 0);
  const fy = fyd(code, i.rebar, i.bars.d);
  const NN = i.N * 1000;
  const n = NN / (Ac * conc.fcd), omega = (As * fy) / (Ac * conc.fcd);

  // повзучість: φ_ef = φ(∞, t0)·M0Eqp/M0Ed (6.15)
  const L = i.L * 1000, l0x = i.mux * L, l0y = i.muy * L, ix = i.h / Math.sqrt(12), iy = i.b / Math.sqrt(12);
  const mx = m0e(i.Mx1, i.Mx2), my = m0e(i.My1, i.My2);
  let phiEf = i.phi * i.qp;
  // 6.4.3: φ ≤ 2, λ ≤ 75, M0Eqp/N_Ed ≥ h — у кожному напрямку
  const lamX = l0x / ix, lamY = l0y / iy;
  const creepIgnored = i.N > 0 && i.phi <= 2 && Math.max(lamX, lamY) <= 75 &&
    (i.qp * Math.abs(mx.M0e) * 1e6) / NN >= i.h && (i.qp * Math.abs(my.M0e) * 1e6) / NN >= i.b;
  if (creepIgnored) phiEf = 0;
  const mat = (cr: number): Mat => ({ code, conc, fy, eud: epsUd(code, i.rebar), cr });
  const m0 = mat(1), mc = mat(1 + phiEf);

  // неточності: e_i = θ_i·l0/2, θ_i = θ0·α_h, θ0 = 1/200, α_h = 2/√l, 2/3 ≤ α_h ≤ 1 (6.1), (6.2)
  const ah = Math.min(1, Math.max(2 / 3, 2 / Math.sqrt(Math.max(i.L, 1e-6))));
  const ei = { x: (ah / 200) * l0x / 2, y: (ah / 200) * l0y / 2 };
  const e0min = code === "EN" ? Math.max(20, Math.max(i.h, i.b) / 30) : 0;

  // гнучкість і гранична гнучкість (6.7), (6.8)
  const axis = (l0: number, rad: number, e: ReturnType<typeof m0e>, h: number): ColAxis => {
    const A = phiEf > 0 ? 1 / (1 + 0.2 * phiEf) : 0.7, B = Math.sqrt(1 + 2 * omega), C = 1.7 - e.rm;
    const lam = l0 / rad, lamLim = n > 0 ? (20 * A * B * C) / Math.sqrt(n) : Infinity;
    // номінальна кривизна EN 5.8.8.3: 1/r = K_r·K_φ·ε_yd/(0.45·d), d = h/2 + i_s
    const isR = Math.sqrt(s.bars.reduce((a, b) => a + b.A * (h === i.h ? b.y : b.x) ** 2, 0) / As);
    const d = h / 2 + isR, nu = 1 + omega, Kr = Math.min(1, Math.max(0, (nu - n) / (nu - 0.4)));
    const beta = 0.35 + (parseFloat(conc.id.slice(1)) || conc.fck) / 200 - lam / 150, Kphi = Math.max(1, 1 + beta * phiEf);
    const e2 = ((Kr * Kphi * (fy / ES)) / (0.45 * d)) * (l0 * l0) / 10;
    return { l0, i: rad, lam, lamLim, A, B, C, rm: e.rm, M0e: e.M0e, M02: e.M02, e2nc: e2, MEdNc: Math.abs(e.M0e) + (NN * (e2 + (h === i.h ? ei.x : ei.y))) / 1e6 };
  };
  const ax = { x: axis(l0x, ix, mx, i.h), y: axis(l0y, iy, my, i.b) };

  // перший порядок у середині (рівномірно по довжині): M0e + N·e_i у площині неточності; EN — не менше N·e0 (6.1 (4))
  const mid = (imp: "x" | "y") => {
    const sx = Math.sign(mx.M0e) || 1, sy = Math.sign(my.M0e) || 1;
    let Mx = mx.M0e * 1e6, My = my.M0e * 1e6;
    if (imp === "x") Mx = sx * Math.max(Math.abs(Mx) + NN * ei.x, NN * e0min);
    else My = sy * Math.max(Math.abs(My) + NN * ei.y, NN * e0min);
    return { Mx, My };
  };

  // загальний метод: шарнірний стрижень довжиною l0 (окремо в кожній площині), M(ξ) = λ·(M0 + N·u(ξ)), u — з кривини
  const NODES = 10;
  const column = (lam: number, M0: { Mx: number; My: number }, guess?: StrainPlane[]) => {
    let ux = new Array(NODES + 1).fill(0), uy = new Array(NODES + 1).fill(0);
    let planes: StrainPlane[] = guess ? guess.slice() : new Array(NODES + 1).fill({ e0: 0, kx: 0, ky: 0 });
    for (let it = 0; it < 150; it++) {
      const kx: number[] = [], ky: number[] = [], np: StrainPlane[] = [];
      for (let j = 0; j <= NODES; j++) {
        const Mx = lam * (M0.Mx + NN * uy[j]), My = lam * (M0.My + NN * ux[j]);
        const q = solvePlane(i, s, mc, lam * NN, Mx, My, planes[j]);
        if (!q || !limitsOk(i, s, mc, q)) return null;
        kx.push(q.kx); ky.push(q.ky); np.push(q);
      }
      planes = np;
      const nuy = deflect(kx, l0x), nux = deflect(ky, l0y);
      const du = Math.max(...nuy.map((v, j) => Math.abs(v - uy[j])), ...nux.map((v, j) => Math.abs(v - ux[j])));
      const big = Math.max(...nuy.map(Math.abs), ...nux.map(Math.abs));
      uy = nuy; ux = nux;
      if (big > 5 * Math.max(i.b, i.h)) return null;
      if (du < 1e-4 * Math.max(1, big) && it > 0) return { ux, uy, planes, Mx: lam * (M0.Mx + NN * uy[NODES / 2]), My: lam * (M0.My + NN * ux[NODES / 2]) };
    }
    return null;
  };
  const runCase = (imp: "x" | "y"): ColCase => {
    const M0 = mid(imp);
    let lo = 0, hi = 0, step = 0.25, gLo: StrainPlane[] | undefined;
    for (let k = 0; k < 60; k++) {
      const l = lo + step, r = column(l, M0, gLo);
      if (r) { lo = l; gLo = r.planes; step *= 1.5; if (lo > 1e3) break; } else { hi = l; break; }
    }
    for (let k = 0; k < 18 && hi > 0 && hi - lo > 2e-3 * hi; k++) {
      const l = (lo + hi) / 2, r = column(l, M0, gLo);
      if (r) { lo = l; gLo = r.planes; } else hi = l;
    }
    // стан при λ = 1 — продовженням від меншого навантаження
    let r1: ReturnType<typeof column> = null, g1: StrainPlane[] | undefined;
    for (const l of [0.25, 0.5, 0.75, 1]) { r1 = column(l, M0, g1); if (!r1) break; g1 = r1.planes; }
    return {
      imp, lamU: lo, ok1: !!r1, plane: r1?.planes[NODES / 2],
      u: { x: r1 ? r1.ux[NODES / 2] : NaN, y: r1 ? r1.uy[NODES / 2] : NaN },
      M: { x: r1 ? r1.Mx / 1e6 : NaN, y: r1 ? r1.My / 1e6 : NaN },
      ux: r1 ? r1.ux : [], uy: r1 ? r1.uy : [],
    };
  };
  const cases = i.N > 0 ? [runCase("x"), runCase("y")] : [];
  const gov = cases.length ? cases.reduce((a, b) => (b.lamU < a.lamU ? b : a)) : runCase("x");

  // кінці колони: перший порядок без прогину
  const ends = [[i.Mx1, i.My1], [i.Mx2, i.My2]].map(([Mx, My]) => {
    const r = sectionFactor(i, s, m0, NN, Mx * 1e6, My * 1e6);
    return { lam: r.lam, Mx, My };
  });

  // діаграми взаємодії: промені в площині (N, M) — переріз без повзучості
  const Nref = (Ac * conc.fcd + As * fy), Mref = Nref * Math.max(i.b, i.h) * 0.1;
  const diagOf = (dir: "x" | "y") => {
    const pts: { N: number; M: number }[] = [];
    for (let k = 0; k <= 48; k++) {
      const t = -Math.PI / 2 + (Math.PI * k) / 48, Nr = Math.sin(t) * Nref, Mr = Math.cos(t) * Mref;
      const r = sectionFactor(i, s, m0, Nr, dir === "x" ? Mr : 0, dir === "y" ? Mr : 0);
      if (Number.isFinite(r.lam)) pts.push({ N: (r.lam * Nr) / 1000, M: (r.lam * Mr) / 1e6 });
    }
    return pts;
  };
  const diag = { x: diagOf("x"), y: diagOf("y") };

  // перевірки
  const clGen = code === "DBN" ? `ДБН В.2.6-98:2009, 5.7.4; ${DS}, 4.5 (4.30)–(4.34), 6.1 (6.2), 6.4 (6.15)` : "EN 1992-1-1, 5.8.6, 5.2 (5.2), 5.8.4 (5.19), 6.1";
  if (i.N > 0) {
    const g = gov;
    checks.push(mkCheck("colMid", clGen, "λ_u ≥ 1 (загальний метод, неточність у найгіршій площині)",
      `λ_u = ${f(g.lamU, 3)} (e_i у площині ${g.imp === "x" ? "h" : "b"}); при λ = 1: u_y = ${f(g.u.y, 1)}, u_x = ${f(g.u.x, 1)} mm; M_x = ${f(g.M.x)}, M_y = ${f(g.M.y)} kN·m; φ_ef = ${f(phiEf, 2)}`,
      1 / Math.max(g.lamU, 1e-9)));
  }
  ends.forEach((e, k) => {
    if (e.Mx === 0 && e.My === 0 && i.N <= 0) return;
    checks.push(mkCheck(k === 0 ? "colEnd1" : "colEnd2", code === "DBN" ? `${DS}, 4.5 (4.30)–(4.34)` : "EN 1992-1-1, 6.1",
      "λ ≥ 1 (переріз на кінці, перший порядок)", `N = ${f(i.N, 1)} kN; M_x = ${f(e.Mx)}, M_y = ${f(e.My)} kN·m; λ = ${f(e.lam, 3)}`, 1 / Math.max(e.lam, 1e-9)));
  });
  const AsMin = Math.max((0.1 * Math.max(0, NN)) / fy, 0.002 * Ac);
  checks.push(mkCheck("colAsMin", code === "DBN" ? `${DS}, 8.5.1.3 (8.12)` : "EN 1992-1-1, 9.5.2 (2) (9.12N)", "A_s ≥ max(0.10·N_Ed/f_yd; 0.002·A_c)", `${f(As, 0)} ≥ ${f(AsMin, 0)} mm²`, AsMin / As));
  checks.push(mkCheck("colAsMax", code === "DBN" ? `${DS}, 8.5.1.4` : "EN 1992-1-1, 9.5.2 (3)", "A_s ≤ 0.04·A_c", `${f(As, 0)} ≤ ${f(0.04 * Ac, 0)} mm²`, As / (0.04 * Ac)));
  checks.push(mkCheck("colBarD", code === "DBN" ? `${DS}, 8.5.1.2` : "EN 1992-1-1, 9.5.2 (1)", "Ø ≥ 8 mm", `Ø${i.bars.d}`, 8 / i.bars.d));
  const tdMin = Math.max(6, i.bars.d / 4);
  checks.push(mkCheck("colTieD", code === "DBN" ? `${DS}, 8.5.3.1` : "EN 1992-1-1, 9.5.3 (1)", "Ø_sw ≥ max(6; Ø/4)", `Ø${i.tie.d} ≥ ${f(tdMin, 1)} mm`, tdMin / i.tie.d));
  const sMax = Math.min(20 * i.bars.d, i.b, i.h, 400);
  checks.push(mkCheck("colTieS", code === "DBN" ? `${DS}, 8.5.3.3` : "EN 1992-1-1, 9.5.3 (3)", "s ≤ min(20·Ø; b; h; 400)", `${f(i.tie.s, 0)} ≤ ${f(sMax, 0)} mm (біля балок і стиків — ×0.6, 8.5.3.4)`, i.tie.s / sMax));
  checks.push(mkCheck("colShape", code === "DBN" ? `${DS}, 8.5.1.1` : "EN 1992-1-1, 9.5.1", "max(b; h) ≤ 4·min(b; h)", `${Math.max(i.b, i.h)} ≤ ${4 * Math.min(i.b, i.h)} mm`, Math.max(i.b, i.h) / (4 * Math.min(i.b, i.h))));
  // просвіт між стрижнями на гранях (ДСТУ 7.1.4: ≥ max(Ø; d_g + 5; 20), d_g = 20)
  const a = i.c + i.tie.d + i.bars.d / 2, need = Math.max(i.bars.d, 25);
  const gapB = (i.b - 2 * a) / (i.bars.nb + 1) - i.bars.d, gapH = (i.h - 2 * a) / (i.bars.nh + 1) - i.bars.d, gap = Math.min(gapB, gapH);
  checks.push(mkCheck("colGap", code === "DBN" ? `${DS}, 7.1.4` : "EN 1992-1-1, 8.2 (2)", "a ≥ max(Ø; d_g + 5; 20) mm", `a = ${f(gap, 0)} ≥ ${f(need, 0)} mm`, gap > 0 ? need / gap : Infinity));
  // 8.5.3.6: жоден стрижень стиснутої зони не далі 150 мм від закріпленого (кутового) — без додаткових шпильок
  const farOf = (len: number, nb: number) => (Math.floor((nb + 1) / 2) * len) / (nb + 1);
  const far = Math.max(i.bars.nb > 0 ? farOf(i.b - 2 * a, i.bars.nb) : 0, i.bars.nh > 0 ? farOf(i.h - 2 * a, i.bars.nh) : 0);
  if (far > 0 && !i.tieAll) checks.push(mkCheck("colTieFar", code === "DBN" ? `${DS}, 8.5.3.6` : "EN 1992-1-1, 9.5.3 (6)", "відстань до закріпленого стрижня ≤ 150 mm",
    `${f(far, 0)} ≤ 150 mm (лише кутові закріплені; інакше — шпильки)`, far / 150));

  const maxUtil = Math.max(0, ...checks.map((c) => c.util));
  return {
    conc, fyd: fy, Ac, As, nBars: s.bars.length, phiEf, creepIgnored, ei, e0min, omega, n, ax, cases, gov, ends, diag, checks, maxUtil, bars: s.bars,
  };
}
