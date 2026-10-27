// Безбалочна (плоска) плита на колонах: пружний розрахунок пластини МСЕ (МІТЦ4, ν = 0.2) на сітці колон,
// колона — жорстка вставка розміром перерізу з пружним защемленням від колон вище і нижче (4EI/H),
// армування за моментами Вуда–Армера, усередненими на смузі 0.25·l (ДСТУ Б В.2.6-156, 8.4.1.2),
// перевірки смуги 1 м — модулем залізобетону, продавлювання — ДСТУ Б В.2.6-156, 4.8 (EN 1992-1-1, 6.4).
// Одиниці всередині — мм, Н, МПа; на вході й виході — м, кН/м², кН, кН·м, кН·м/м, мм²/м.
import type { Check, CodeId } from "../codes/types";
import { mkCheck } from "../codes/types";
import { deflectionLimitDSTU } from "../codes/dbn198";
import { shellForces, shellPrepare } from "../analysis/shell";
import type { ShellElement, ShellPrepared } from "../analysis/shell";
import { skyFactor, SkyMatrix, skySolve } from "../analysis/skyline";
import { checkRc, fyd, rcConcrete, rcCurvature, rcUls } from "./rc";
import type { RcConcrete, RcInput, RcResult } from "./rc";
import { slabAs } from "./slab";
import type { SlabBars } from "./slab";

/** поперечна арматура продавлювання: діаметр, кількість стрижнів на одному периметрі, радіальний крок s_r, кількість периметрів, відстань першого від грані колони (0 — 0.5d), мм */
export interface PunchRf { d: number; n: number; sr: number; rows: number; s0?: number; cls?: string }

export interface FlatInput {
  code: CodeId; concrete: string; rebar: string;
  /** прольоти між осями колон, м */
  sx: number[]; sy: number[];
  /** від осі крайніх колон до грані плити, м */
  ov: number;
  /** товщина, захисний шар до крайнього стрижня, мм */
  h: number; c: number;
  /** колона: прямокутна cx × cy або кругла діаметром cx, мм */
  colShape: "rect" | "circle"; cx: number; cy: number;
  /** висота колон нижче і вище плити, м (0 — немає): пружне защемлення плити 4EI/H */
  Hb: number; Ha: number;
  g: number; q: number; selfWeight?: boolean; gammaG?: number; gammaQ?: number; psi2?: number;
  /** низ — по всій плиті, верх — над колонами */
  botX: SlabBars; botY: SlabBars; topX: SlabBars; topY: SlabBars;
  punch?: PunchRf;
  /** β: auto — наближені 1.15/1.4/1.5 (рис. 4.24), якщо прольоти відрізняються не більше ніж на 25 %; fem — за моментами з розрахунку */
  beta?: "auto" | "fem";
  phi?: number; wlim?: number; deflN?: number;
  /** для перевірки: грані плити — площини симетрії (нескінченна плита) */
  sym?: boolean;
  /** елементів на найменшому прольоті (типово 16) */
  mesh?: number;
}

export interface FlatField {
  xs: number[]; ys: number[];
  /** у вузлах (рядки по y): моменти Вуда–Армера, усереднені на 0.25·l, кН·м/м; прогин повний, мм */
  mbx: number[]; mby: number[]; mtx: number[]; mty: number[]; w: number[];
}
export type PunchType = "int" | "edge" | "corner";
export interface PunchResult {
  type: PunchType; d: number; u0: number; u1: number; u1r: number;
  /** ексцентриситети V відносно центра колони, мм */
  ex: number; ey: number;
  beta: number; betaFem: number; betaApprox: number; approx: boolean;
  vEd0: number; vRdMax: number; vEd: number; vRdc: number; vRdcs?: number;
  /** зовнішній периметр без арматури і його відстань від грані колони; найвіддаленіший ряд арматури */
  uOut: number; rOut: number; rLast?: number;
  /** потрібна площа одного периметра при s_r = 0.75d, мм² */
  aswNeed?: number;
  util: number;
}
export interface FlatColumn {
  label: string; ix: number; iy: number; x: number; y: number;
  /** реакція, кН; момент колони на плиту, кН·м (навколо x і y) */
  V: number; Mx: number; My: number;
  /** верх над колоною (8.4.1.2): повний опорний момент, кН·м; розрахунковий у смузі, кН·м/м — для стрижнів уздовж x і y */
  top: { Mx: number; mx: number; My: number; my: number };
  geom: PunchGeom; p: PunchResult;
}
export interface FlatResult {
  wd: number; wqp: number; selfW: number;
  M: { bx: number; by: number; tx: number; ty: number };
  As: { bx: number; by: number; tx: number; ty: number };
  defl: { el: number; k: number; f: number; flim: number; n: number; l: number; cant: boolean };
  field: FlatField; cols: FlatColumn[];
  rc: { x: RcResult; xNeg: RcResult; y: RcResult; yNeg: RcResult };
  /** прольоти відрізняються не більше ніж на 25 % — дозволено наближене β */
  approxOk: boolean;
  checks: Check[]; maxUtil: number;
  need: Partial<Record<"botX" | "botY" | "topX" | "topY", SlabBars>>;
}

const DS = "ДСТУ Б В.2.6-156:2010";
const barA = (d: number) => (Math.PI * d * d) / 4;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** координати сітки: обов'язкові лінії + поділ проміжків на рівні частини розміром ≤ hT */
function grid(keys: number[], hT: number): number[] {
  const k = [...keys].sort((a, b) => a - b).filter((v, j, a) => j === 0 || v - a[j - 1] > 1);
  const out = [k[0]];
  for (let j = 1; j < k.length; j++) {
    const n = Math.max(1, Math.round((k[j] - k[j - 1]) / hT));
    for (let s = 1; s <= n; s++) out.push(k[j - 1] + ((k[j] - k[j - 1]) * s) / n);
  }
  return out;
}

/** розміри колони для МСЕ: кругла — квадрат тієї ж площі */
const feSize = (i: FlatInput) => (i.colShape === "circle" ? [(i.cx * Math.sqrt(Math.PI)) / 2, (i.cx * Math.sqrt(Math.PI)) / 2] : [i.cx, i.cy]);

/** Пружна плита на колонах від тиску q (МПа, донизу): моменти у вузлах [mx, my, mxy] (Н·мм/мм, m > 0 — розтяг угорі), прогин (мм), реакції колон */
export function flatFem(i: FlatInput, qMPa: number, E: number) {
  const ov = i.sym ? 0 : Math.max(i.ov * 1000, Math.max(i.cx, i.colShape === "circle" ? i.cx : i.cy) / 2);
  const X = [0], Y = [0];
  for (const s of i.sx) X.push(X[X.length - 1] + s * 1000);
  for (const s of i.sy) Y.push(Y[Y.length - 1] + s * 1000);
  const [fx, fy] = feSize(i), hx = fx / 2, hy = fy / 2;
  const Lx = X[X.length - 1] + 2 * ov, Ly = Y[Y.length - 1] + 2 * ov;
  const hT = Math.max(Math.min(...i.sx, ...i.sy) * 1000 / (i.mesh ?? 16), Math.max(Lx, Ly) / 64);
  const kx = [-ov, X[X.length - 1] + ov], ky = [-ov, Y[Y.length - 1] + ov];
  for (const x of X) kx.push(x, x - hx, x + hx);
  for (const y of Y) ky.push(y, y - hy, y + hy);
  const xs = grid(kx.filter((v) => v >= -ov - 1e-6 && v <= X[X.length - 1] + ov + 1e-6), hT);
  const ys = grid(ky.filter((v) => v >= -ov - 1e-6 && v <= Y[Y.length - 1] + ov + 1e-6), hT);
  const nx = xs.length - 1, ny = ys.length - 1, nn = (nx + 1) * (ny + 1), id = (a: number, b: number) => b * (nx + 1) + a;
  const near = (arr: number[], v: number) => { let b = 0; for (let j = 1; j < arr.length; j++) if (Math.abs(arr[j] - v) < Math.abs(arr[b] - v)) b = j; return b; };

  // колони: вузли в межах перерізу — жорстка вставка, ведучий вузол на осі (w = 0, повороти з пружиною)
  const region = new Int32Array(nn).fill(-1);
  const cols: { ix: number; iy: number; a: number; b: number; x: number; y: number; k: number; eq: [number, number] }[] = [];
  for (let iy = 0; iy < Y.length; iy++) for (let ix = 0; ix < X.length; ix++) {
    const a = near(xs, X[ix]), b = near(ys, Y[iy]), r = cols.length;
    cols.push({ ix, iy, a, b, x: xs[a], y: ys[b], k: id(a, b), eq: [-1, -1] });
    for (let bb = 0; bb <= ny; bb++) for (let aa = 0; aa <= nx; aa++)
      if (Math.abs(xs[aa] - xs[a]) <= hx + 1e-6 && Math.abs(ys[bb] - ys[b]) <= hy + 1e-6) region[id(aa, bb)] = r;
  }
  // пружне защемлення: 4EI/H від кожної колони (дальній кінець защемлений)
  const Ix = i.colShape === "circle" ? (Math.PI * i.cx ** 4) / 64 : (i.cx * i.cy ** 3) / 12;
  const Iy = i.colShape === "circle" ? Ix : (i.cy * i.cx ** 3) / 12;
  const Hs = [i.Hb, i.Ha].filter((v) => v > 0).map((v) => v * 1000);
  const kRx = i.sym ? 0 : sum(Hs.map((H) => (4 * E * Ix) / H)), kRy = i.sym ? 0 : sum(Hs.map((H) => (4 * E * Iy) / H));

  // рівняння: звичайний вузол — w, θx, θy; ведучий вузол колони — θx, θy; решта вузлів вставки — через ведучий
  const eq = new Int32Array(nn * 3).fill(-1);
  let n = 0;
  const symFix = (a: number, b: number, r: number) => i.sym && ((r === 2 && (a === 0 || a === nx)) || (r === 1 && (b === 0 || b === ny)));
  for (let b = 0; b <= ny; b++) for (let a = 0; a <= nx; a++) {
    const k = id(a, b), r = region[k];
    if (r >= 0 && cols[r].k !== k) continue;
    for (let d = r >= 0 ? 1 : 0; d < 3; d++) if (!symFix(a, b, d)) eq[k * 3 + d] = n++;
    if (r >= 0) cols[r].eq = [eq[k * 3 + 1], eq[k * 3 + 2]];
  }
  // ступінь d вузла k як лінійна комбінація невідомих: w_s = θx_m·Δy − θy_m·Δx
  const map0 = (k: number, d: number): [number, number][] => {
    const r = region[k];
    if (r < 0 || cols[r].k === k) return eq[k * 3 + d] >= 0 ? [[eq[k * 3 + d], 1]] : [];
    const c = cols[r], [ex, ey] = c.eq, out: [number, number][] = [];
    const a = k % (nx + 1), b = Math.floor(k / (nx + 1));
    if (d === 0) { if (ex >= 0) out.push([ex, ys[b] - c.y]); if (ey >= 0) out.push([ey, -(xs[a] - c.x)]); }
    else if (d === 1 && ex >= 0) out.push([ex, 1]);
    else if (d === 2 && ey >= 0) out.push([ey, 1]);
    return out;
  };
  const MAPS: [number, number][][] = [];
  for (let k = 0; k < nn; k++) for (let d = 0; d < 3; d++) MAPS.push(map0(k, d));
  const map = (k: number, d: number) => MAPS[k * 3 + d];

  const el: ShellElement = { id: "e", nodes: ["1", "2", "3", "4"], t: i.h, E, nu: 0.2 };
  const cache = new Map<string, ShellPrepared>();
  const prep = (dx: number, dy: number) => {
    const key = `${dx.toFixed(3)}_${dy.toFixed(3)}`;
    let sp = cache.get(key);
    if (!sp) { sp = shellPrepare(el, [[0, 0, 0], [dx, 0, 0], [dx, dy, 0], [0, dy, 0]]); cache.set(key, sp); }
    return sp;
  };
  const LOC = [2, 3, 4];
  const elemNodes = (a: number, b: number) => [id(a, b), id(a + 1, b), id(a + 1, b + 1), id(a, b + 1)];
  const K = new SkyMatrix(n), F = new Float64Array(n);
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const dx = xs[a + 1] - xs[a], dy = ys[b + 1] - ys[b], sp = prep(dx, dy), fe = (-qMPa * dx * dy) / 4;
    const nodes = elemNodes(a, b), maps: [number, number][][] = [];
    for (const k of nodes) for (let d = 0; d < 3; d++) maps.push(map(k, d));
    for (let p = 0; p < 12; p++) {
      const rp = Math.floor(p / 3) * 6 + LOC[p % 3];
      for (const [ep, cp] of maps[p]) {
        if (p % 3 === 0) F[ep] += fe * cp;
        for (let q = 0; q < 12; q++) {
          const kv = sp.K[rp][Math.floor(q / 3) * 6 + LOC[q % 3]];
          if (!kv) continue;
          for (const [eqq, cq] of maps[q]) if (eqq <= ep) K.add(ep, eqq, kv * cp * cq);
        }
      }
    }
  }
  for (const c of cols) { if (c.eq[0] >= 0) K.add(c.eq[0], c.eq[0], kRx); if (c.eq[1] >= 0) K.add(c.eq[1], c.eq[1], kRy); }
  const fac = skyFactor(K);
  if (!fac) throw new Error("flat slab: mechanism");
  const u = skySolve(fac, F);
  const UV = new Float64Array(nn * 3);
  for (let j = 0; j < nn * 3; j++) for (const [e, cf] of MAPS[j]) UV[j] += u[e] * cf;
  const U = (k: number, d: number) => UV[k * 3 + d];
  const w = new Array(nn).fill(0), th: [number, number][] = [];
  for (let k = 0; k < nn; k++) { w[k] = -U(k, 0); th.push([U(k, 1), U(k, 2)]); }

  // реакції колон: сума вузлових сил елементів у вузлах вставки мінус прикладене навантаження
  const V = new Array(cols.length).fill(0);
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const nodes = elemNodes(a, b);
    if (!nodes.some((k) => region[k] >= 0)) continue;
    const dx = xs[a + 1] - xs[a], dy = ys[b + 1] - ys[b], sp = prep(dx, dy), fe = (-qMPa * dx * dy) / 4;
    const ue: number[] = [];
    for (const k of nodes) for (let d = 0; d < 3; d++) ue.push(U(k, d));
    nodes.forEach((k, j) => {
      if (region[k] < 0) return;
      let s = 0;
      for (let q = 0; q < 12; q++) s += sp.K[j * 6 + 2][Math.floor(q / 3) * 6 + LOC[q % 3]] * ue[q];
      V[region[k]] += s - fe;
    });
  }
  const colOut = cols.map((c, r) => ({
    ix: c.ix, iy: c.iy, x: c.x, y: c.y, V: V[r],
    Mx: c.eq[0] >= 0 && kRx ? -kRx * u[c.eq[0]] : 0, My: c.eq[1] >= 0 && kRy ? -kRy * u[c.eq[1]] : 0,
  }));

  // моменти у вузлах з похідних поворотів (w_x = −θy, w_y = θx): m_x = D(θy,x − ν·θx,y), m_y = −D(θx,y − ν·θy,x)
  // по межі жорсткої вставки — одностороння різниця з боку плити
  const nu = 0.2, Dp = (E * i.h ** 3) / (12 * (1 - nu * nu));
  const deriv = (crd: number[], val: (j: number) => number, inR: (j: number) => boolean, j: number, last: number) => {
    const L = j > 0 && !(inR(j) && inR(j - 1)), R = j < last && !(inR(j) && inR(j + 1));
    if (L && R) {
      const h1 = crd[j] - crd[j - 1], h2 = crd[j + 1] - crd[j];
      return (-h2 / (h1 * (h1 + h2))) * val(j - 1) + ((h2 - h1) / (h1 * h2)) * val(j) + (h1 / (h2 * (h1 + h2))) * val(j + 1);
    }
    if (R) {
      if (j + 2 > last) return (val(j + 1) - val(j)) / (crd[j + 1] - crd[j]);
      const h1 = crd[j + 1] - crd[j], h2 = crd[j + 2] - crd[j + 1];
      return (-(2 * h1 + h2) / (h1 * (h1 + h2))) * val(j) + ((h1 + h2) / (h1 * h2)) * val(j + 1) - (h1 / (h2 * (h1 + h2))) * val(j + 2);
    }
    if (L) {
      if (j - 2 < 0) return (val(j) - val(j - 1)) / (crd[j] - crd[j - 1]);
      const h1 = crd[j] - crd[j - 1], h2 = crd[j - 1] - crd[j - 2];
      return ((2 * h1 + h2) / (h1 * (h1 + h2))) * val(j) - ((h1 + h2) / (h1 * h2)) * val(j - 1) + (h1 / (h2 * (h1 + h2))) * val(j - 2);
    }
    return 0;
  };
  const m: number[][] = [];
  for (let b = 0; b <= ny; b++) for (let a = 0; a <= nx; a++) {
    const k = id(a, b), r = region[k];
    const inX = (j: number) => r >= 0 && region[id(j, b)] === r, inY = (j: number) => r >= 0 && region[id(a, j)] === r;
    const tyx = deriv(xs, (j) => th[id(j, b)][1], inX, a, nx), txx = deriv(xs, (j) => th[id(j, b)][0], inX, a, nx);
    const txy = deriv(ys, (j) => th[id(a, j)][0], inY, b, ny), tyy = deriv(ys, (j) => th[id(a, j)][1], inY, b, ny);
    m.push([Dp * (tyx - nu * txy), -Dp * (txy - nu * tyx), (-Dp * (1 - nu) * (txx - tyy)) / 2]);
  }
  // усередині плити (чотири сусідні елементи поза вставками) — середнє моментів у центрах елементів (точніше за різниці)
  const z24 = new Array(24).fill(0);
  const ec = (a: number, b: number) => {
    const sp = prep(xs[a + 1] - xs[a], ys[b + 1] - ys[b]), ug = new Array(24).fill(0);
    elemNodes(a, b).forEach((k, j) => { for (let d = 0; d < 3; d++) ug[j * 6 + LOC[d]] = U(k, d); });
    return shellForces(el, sp, ug, z24).c.slice(3, 6);
  };
  const ecs: number[][] = [];
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) ecs.push(ec(a, b));
  for (let b = 1; b < ny; b++) for (let a = 1; a < nx; a++) {
    if ([id(a - 1, b - 1), id(a + 1, b - 1), id(a - 1, b + 1), id(a + 1, b + 1), id(a, b)].some((k) => region[k] >= 0)) continue;
    const e4 = [ecs[(b - 1) * nx + a - 1], ecs[(b - 1) * nx + a], ecs[b * nx + a - 1], ecs[b * nx + a]];
    m[id(a, b)] = [0, 1, 2].map((r) => (e4[0][r] + e4[1][r] + e4[2][r] + e4[3][r]) / 4);
  }
  return { xs, ys, nx, ny, m, w, cols: colOut, X, Y, ov, region };
}

// ---------- продавлювання ----------

/** табл. 4.1: k за відношенням c1/c2 */
export function punchK(r: number) {
  const T: [number, number][] = [[0.5, 0.45], [1, 0.6], [2, 0.7], [3, 0.8]];
  if (r <= 0.5) return 0.45;
  if (r >= 3) return 0.8;
  for (let j = 1; j < T.length; j++) if (r <= T[j][0]) return T[j - 1][1] + ((T[j][1] - T[j - 1][1]) * (r - T[j - 1][0])) / (T[j][0] - T[j - 1][0]);
  return 0.8;
}

export interface PunchGeom {
  shape: "rect" | "circle"; cx: number; cy: number;
  /** грань плити: з боку sx (±1) по x на відстані ex від грані колони; null — немає поруч */
  edgeX: { s: 1 | -1; e: number } | null; edgeY: { s: 1 | -1; e: number } | null;
}

/** Контрольний контур на відстані r від грані колони (рис. 4.16, 4.18): найкоротший з повного і обрізаних гранями плити; точки ламаної в осях колони */
export function punchPerimeter(g: PunchGeom, r: number) {
  const ARC = 24;
  const arc = (cx0: number, cy0: number, a0: number, a1: number, R: number) => {
    const p: [number, number][] = [];
    for (let j = 0; j <= ARC; j++) { const t = a0 + ((a1 - a0) * j) / ARC; p.push([cx0 + R * Math.cos(t), cy0 + R * Math.sin(t)]); }
    return p;
  };
  if (g.shape === "circle") {
    const pts = arc(0, 0, 0, 2 * Math.PI, g.cx / 2 + r);
    return { kind: "full" as const, L: Math.PI * (g.cx + 2 * r), pts };
  }
  const a = g.cx / 2, b = g.cy / 2, P = Math.PI;
  const variants: { kind: "full" | "x" | "y" | "xy"; L: number; pts: () => [number, number][] }[] = [];
  variants.push({ kind: "full", L: 2 * (g.cx + g.cy) + 2 * P * r, pts: () => [
    ...arc(a, b, 0, P / 2, r), ...arc(-a, b, P / 2, P, r), ...arc(-a, -b, P, 1.5 * P, r), ...arc(a, -b, 1.5 * P, 2 * P, r), [a + r, b]] });
  if (g.edgeX) {
    const s = g.edgeX.s, xe = s * (a + g.edgeX.e);
    // від грані плити вздовж y = ±(b + r) до тилу колони, дуги навколо тильних кутів, відрізок c_y
    variants.push({ kind: "x", L: g.cy + 2 * (g.cx + g.edgeX.e) + P * r, pts: () => {
      const p: [number, number][] = [[xe, b + r]];
      const back = -s * a;
      p.push(...(s > 0 ? arc(back, b, P / 2, P, r) : arc(back, b, P / 2, 0, r)));
      p.push(...(s > 0 ? arc(back, -b, P, 1.5 * P, r) : arc(back, -b, 0, -P / 2, r)));
      p.push([xe, -b - r]);
      return p;
    } });
  }
  if (g.edgeY) {
    const s = g.edgeY.s, ye = s * (b + g.edgeY.e), back = -s * b;
    variants.push({ kind: "y", L: g.cx + 2 * (g.cy + g.edgeY.e) + P * r, pts: () => {
      const p: [number, number][] = [[a + r, ye]];
      p.push(...(s > 0 ? arc(a, back, 0, -P / 2, r) : arc(a, back, 0, P / 2, r)));
      p.push(...(s > 0 ? arc(-a, back, -P / 2, -P, r) : arc(-a, back, P / 2, P, r)));
      p.push([-a - r, ye]);
      return p;
    } });
  }
  if (g.edgeX && g.edgeY) {
    const sx = g.edgeX.s, sy = g.edgeY.s, xe = sx * (a + g.edgeX.e), ye = sy * (b + g.edgeY.e);
    variants.push({ kind: "xy", L: g.cx + g.cy + g.edgeX.e + g.edgeY.e + (P * r) / 2, pts: () => {
      // кут, протилежний до кута плити: (−sx·a, −sy·b)
      const cx0 = -sx * a, cy0 = -sy * b;
      const t0 = Math.atan2(-sy, 0), t1 = Math.atan2(0, -sx); // від напрямку −sy·y до −sx·x
      let d = t1 - t0; if (d > P) d -= 2 * P; if (d < -P) d += 2 * P;
      const p: [number, number][] = [[xe, cy0 - sy * r]];
      p.push(...arc(cx0, cy0, t0, t0 + d, r));
      p.push([cx0 - sx * r, ye]);
      return p;
    } });
  }
  const best = variants.reduce((m, v) => (v.L < m.L - 1e-9 ? v : m));
  return { kind: best.kind, L: best.L, pts: best.pts() };
}

/** Довжина і момент опору контуру W = ∫|e − ē| dl (4.8.3.3) уздовж x і y; центр ваги ламаної */
export function perimeterW(pts: [number, number][]) {
  let L = 0, sx = 0, sy = 0;
  for (let j = 1; j < pts.length; j++) {
    const l = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
    L += l; sx += (l * (pts[j][0] + pts[j - 1][0])) / 2; sy += (l * (pts[j][1] + pts[j - 1][1])) / 2;
  }
  const gx = sx / L, gy = sy / L;
  let Wx = 0, Wy = 0;
  // точне інтегрування |лінійної функції| на відрізку
  const absInt = (p: number, q: number) => (p * q >= 0 ? (Math.abs(p) + Math.abs(q)) / 2 : (p * p + q * q) / (2 * (Math.abs(p) + Math.abs(q))));
  for (let j = 1; j < pts.length; j++) {
    const l = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
    Wx += l * absInt(pts[j - 1][0] - gx, pts[j][0] - gx); Wy += l * absInt(pts[j - 1][1] - gy, pts[j][1] - gy);
  }
  return { L, gx, gy, Wx, Wy };
}

export interface PunchInput {
  code: CodeId; conc: RcConcrete; geom: PunchGeom;
  /** реакція, Н; ексцентриситети, мм; робоча висота, мм; ρ_l; товщина, мм */
  V: number; ex: number; ey: number; d: number; rho: number; h: number;
  approx: boolean; rf?: PunchRf; rebar: string;
}

/** Продавлювання однієї колони: ДСТУ Б В.2.6-156, 4.8.2–4.8.5 (EN 1992-1-1, 6.4) */
export function punchCheck(p: PunchInput): PunchResult {
  const { geom: g, d, conc } = p, P = Math.PI;
  const per = punchPerimeter(g, 2 * d), u1 = per.L, W = perimeterW(per.pts);
  const type: PunchType = per.kind === "full" ? "int" : per.kind === "xy" ? "corner" : "edge";
  const cx = g.shape === "circle" ? (P * g.cx) / 4 : g.cx, cy = g.shape === "circle" ? (P * g.cx) / 4 : g.cy;
  // u0 (4.93): середня — контур колони; крайня — c2 + 3d ≤ c2 + 2c1; кутова — 3d ≤ c1 + c2
  let u0 = g.shape === "circle" ? P * g.cx : 2 * (cx + cy), u1r = u1;
  const a15 = (c: number) => Math.min(1.5 * d, 0.5 * c);
  if (per.kind === "x") { u0 = Math.min(cy + 3 * d, cy + 2 * cx); u1r = Math.min(u1, 2 * a15(cx) + cy + 2 * P * d); }
  if (per.kind === "y") { u0 = Math.min(cx + 3 * d, cx + 2 * cy); u1r = Math.min(u1, 2 * a15(cy) + cx + 2 * P * d); }
  if (per.kind === "xy") { u0 = Math.min(3 * d, cx + cy); u1r = Math.min(u1, a15(cx) + a15(cy) + P * d); }
  // β за моментами: (4.78) по кожному напрямку (сума — у запас щодо (4.82)), (4.81) кругла, (4.83) крайня, (4.85) кутова
  const ex = p.ex, ey = p.ey;
  const kX = punchK(cx / cy), kY = punchK(cy / cx);
  const b478 = (ox: number, oy: number) => 1 + (kX * u1 * Math.abs(ex - ox)) / W.Wx + (kY * u1 * Math.abs(ey - oy)) / W.Wy;
  let betaFem: number;
  if (per.kind === "full") betaFem = g.shape === "circle" ? 1 + (0.6 * P * Math.hypot(ex, ey)) / (g.cx + 4 * d) : b478(0, 0);
  else if (per.kind === "x" || per.kind === "y") {
    const isX = per.kind === "x", s = (isX ? g.edgeX : g.edgeY)!.s, ePerp = isX ? ex : ey, ePar = isX ? ey : ex;
    // до середини плити — e·s ≤ 0 (від грані): (4.83) з k для c1/(2c2), W — для контуру крайньої колони вздовж грані
    betaFem = ePerp * s <= 0
      ? u1 / u1r + (punchK(isX ? cx / (2 * cy) : cy / (2 * cx)) * u1 * Math.abs(ePar)) / (isX ? W.Wy : W.Wx)
      : b478(W.gx, W.gy);
  } else {
    betaFem = ex * g.edgeX!.s <= 0 && ey * g.edgeY!.s <= 0 ? u1 / u1r : b478(W.gx, W.gy);
  }
  betaFem = Math.max(1, betaFem);
  const betaApprox = type === "int" ? 1.15 : type === "edge" ? 1.4 : 1.5;
  const beta = p.approx ? betaApprox : betaFem;

  const gc = p.code === "DBN" ? 1.3 : 1.5, fck = conc.fck;
  const k = Math.min(2, 1 + Math.sqrt(200 / d)), rho = Math.min(0.02, p.rho);
  const vmin = 0.035 * k ** 1.5 * Math.sqrt(fck);
  const vRdc = Math.max((0.18 / gc) * k * (100 * rho * fck) ** (1 / 3), vmin);
  const vRdMax = 0.5 * 0.6 * (1 - fck / 250) * conc.fcd;
  const vEd0 = (beta * p.V) / (u0 * d), vEd = (beta * p.V) / (u1 * d);
  const uOut = (beta * p.V) / (vRdc * d);
  // відстань від грані колони до контуру u_out: обернене до довжини контуру L(r)
  const Lr = (r: number) => punchPerimeter(g, r).L;
  let lo = 0, hi = 50 * d;
  if (Lr(lo) >= uOut) hi = 0;
  else { for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (Lr(mid) < uOut) lo = mid; else hi = mid; } }
  const rOut = hi;
  const res: PunchResult = { type, d, u0, u1, u1r, ex, ey, beta, betaFem, betaApprox, approx: p.approx, vEd0, vRdMax, vEd, vRdc, uOut, rOut, util: 0 };
  const fywdEf = (dd: number) => Math.min(250 + 0.25 * d, fyd(p.code, p.rf?.cls ?? p.rebar, dd));
  if (vEd > vRdc) {
    const sr = 0.75 * d;
    res.aswNeed = Math.max(0, ((vEd - 0.75 * vRdc) * u1 * d) / (1.5 * (d / sr) * fywdEf(p.rf?.d || 10)));
  }
  const rf = p.rf && p.rf.d > 0 && p.rf.n > 0 && p.rf.sr > 0 && p.rf.rows > 0 ? p.rf : undefined;
  if (rf) {
    const Asw = rf.n * barA(rf.d);
    res.vRdcs = 0.75 * vRdc + 1.5 * (d / rf.sr) * Asw * fywdEf(rf.d) * (1 / (u1 * d));
    res.rLast = (rf.s0 && rf.s0 > 0 ? rf.s0 : 0.5 * d) + (rf.rows - 1) * rf.sr;
  }
  res.util = Math.max(vEd0 / vRdMax, vEd <= vRdc || !rf ? vEd / vRdc : vEd / res.vRdcs!);
  return res;
}

// ---------- плита ----------

export function checkFlat(i: FlatInput): FlatResult {
  const code = i.code, conc = rcConcrete(code, i.concrete), checks: Check[] = [];
  const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");
  const selfW = i.selfWeight === false ? 0 : (25 * i.h) / 1000;
  const gG = i.gammaG ?? (code === "DBN" ? 1.1 : 1.35), gQ = i.gammaQ ?? (code === "DBN" ? 1.2 : 1.5), psi2 = i.psi2 ?? 0.3, phi = i.phi ?? 2;
  const wd = gG * (i.g + selfW) + gQ * i.q, wqp = i.g + selfW + psi2 * i.q, kq = wqp / wd;
  const fem = flatFem(i, wd / 1000, conc.Ecm);
  const { xs, ys, nx, ny } = fem, nn = fem.m.length, id = (a: number, b: number) => b * (nx + 1) + a;

  // Вуд–Армер у вузлах
  const wa = { bx: [] as number[], by: [] as number[], tx: [] as number[], ty: [] as number[] };
  fem.m.forEach(([mx, my, mxy], k) => {
    const t = Math.abs(mxy), inCol = fem.region[k] >= 0 && !onFace(k);
    wa.bx.push(inCol ? 0 : Math.max(0, -mx + t) / 1000); wa.by.push(inCol ? 0 : Math.max(0, -my + t) / 1000);
    wa.tx.push(inCol ? 0 : Math.max(0, mx + t) / 1000); wa.ty.push(inCol ? 0 : Math.max(0, my + t) / 1000);
  });
  function onFace(k: number) {
    const a = k % (nx + 1), b = Math.floor(k / (nx + 1)), r = fem.region[k];
    return [[a - 1, b], [a + 1, b], [a, b - 1], [a, b + 1]].some(([p, q]) => p < 0 || p > nx || q < 0 || q > ny || fem.region[id(p, q)] !== r);
  }
  // усереднення поперек напрямку арматури на ширині 0.25·l місцевого прольоту (8.4.1.2: половина верхньої арматури — у смузі 0.125·l з кожного боку колони)
  const local = (axes: number[], spans: number[], v: number) => {
    for (let j = 1; j < axes.length; j++) if (v <= axes[j]) return spans[j - 1] * 1000;
    return spans[spans.length - 1] * 1000;
  };
  const trib = (crd: number[], j: number) => ((j < crd.length - 1 ? crd[j + 1] - crd[j] : 0) + (j > 0 ? crd[j] - crd[j - 1] : 0)) / 2;
  const smooth = (arr: number[], alongY: boolean) => {
    const out = new Array(nn).fill(0);
    for (let b = 0; b <= ny; b++) for (let a = 0; a <= nx; a++) {
      const crd = alongY ? ys : xs, j0 = alongY ? b : a, half = 0.125 * (alongY ? local(fem.Y, i.sy, ys[b]) : local(fem.X, i.sx, xs[a]));
      let s = 0, wsum = 0;
      for (let j = 0; j < crd.length; j++) {
        if (Math.abs(crd[j] - crd[j0]) > half + 1e-6) continue;
        const t = trib(crd, j), k = alongY ? id(a, j) : id(j, b);
        s += arr[k] * t; wsum += t;
      }
      out[id(a, b)] = wsum > 0 ? s / wsum : arr[id(a, b)];
    }
    return out;
  };
  const mbx = smooth(wa.bx, true), mtx = smooth(wa.tx, true), mby = smooth(wa.by, false), mty = smooth(wa.ty, false);
  const mx = (a: number[]) => Math.max(0, ...a);
  // верхня арматура над колонами (8.4.1.2): повний опорний момент M_t на ширині двох половин панелей біля грані колони,
  // половина — у смузі 0.125·l з кожного боку колони: m_t = 0.5·M_t / ширина смуги
  const [fx, fy] = feSize(i);
  const nearI = (arr: number[], v: number) => { let b = 0; for (let j = 1; j < arr.length; j++) if (Math.abs(arr[j] - v) < Math.abs(arr[b] - v)) b = j; return b; };
  const colTop = fem.cols.map((c) => {
    const one = (dirX: boolean) => {
      const axes = dirX ? fem.Y : fem.X, spans = dirX ? i.sy : i.sx, j = dirX ? c.iy : c.ix, crd = dirX ? ys : xs;
      const lo = j > 0 ? (spans[j - 1] * 1000) / 2 : fem.ov, hiW = j < spans.length ? (spans[j] * 1000) / 2 : fem.ov;
      const l = lo + hiW, band = Math.min(lo, 0.125 * l) + Math.min(hiW, 0.125 * l), c0 = axes[j];
      let best = 0;
      for (const sgn of [-1, 1]) {
        const face = nearI(dirX ? xs : ys, (dirX ? c.x : c.y) + (sgn * (dirX ? fx : fy)) / 2);
        let Mt = 0;
        for (let q = 0; q < crd.length - 1; q++) {
          const y0 = Math.max(crd[q], c0 - lo), y1 = Math.min(crd[q + 1], c0 + hiW);
          if (y1 <= y0) continue;
          const v0 = dirX ? wa.tx[id(face, q)] : wa.ty[id(q, face)], v1 = dirX ? wa.tx[id(face, q + 1)] : wa.ty[id(q + 1, face)];
          const t0 = (y0 - crd[q]) / (crd[q + 1] - crd[q]), t1 = (y1 - crd[q]) / (crd[q + 1] - crd[q]);
          Mt += ((v0 + (v1 - v0) * t0 + v0 + (v1 - v0) * t1) / 2) * (y1 - y0);
        }
        best = Math.max(best, Mt);
      }
      return { Mt: best / 1000, band, m: (0.5 * best) / band };
    };
    return { x: one(true), y: one(false) };
  });
  const M = { bx: mx(mbx), by: mx(mby), tx: Math.max(0, ...colTop.map((t) => t.x.m)), ty: Math.max(0, ...colTop.map((t) => t.y.m)) };

  // перерізи смуг 1 м: x — крайні ряди, y — другі ряди
  const As = { bx: slabAs(i.botX), by: slabAs(i.botY), tx: slabAs(i.topX), ty: slabAs(i.topY) };
  const lay = (b: SlabBars, A: number) => (b.d > 0 && b.s > 0 ? [{ n: Math.max(2, Math.round(1000 / b.s)), d: b.d, As: A }] : []);
  const strip = (dir: "x" | "y", Mb: number, Mt: number, neg: boolean): RcInput => {
    const [bot, top, bo, to] = dir === "x" ? [i.botX, i.topX, 0, 0] : [i.botY, i.topY, i.botX.d, i.topX.d];
    const c = i.c + Math.max(bo, to);
    return {
      code, concrete: i.concrete, rebar: i.rebar, b: 1000, h: i.h, c, sw: { d: 0, legs: 0, s: 0, cls: i.rebar },
      bot: lay(bot, dir === "x" ? As.bx : As.by), top: lay(top, dir === "x" ? As.tx : As.ty), mode: "section",
      M: neg ? -Mt : Mb, N: 0, V: 0, Mqp: neg ? -Mt * kq : Mb * kq, phi, wlim: i.wlim ?? 0.3,
    };
  };
  const rc = { x: checkRc(strip("x", M.bx, M.tx, false)), xNeg: checkRc(strip("x", M.bx, M.tx, true)), y: checkRc(strip("y", M.by, M.ty, false)), yNeg: checkRc(strip("y", M.by, M.ty, true)) };
  const take = (r: RcResult, keys: string[], sfx: "X" | "Y") => {
    for (const c of r.checks) if (keys.includes(c.key)) checks.push({ ...c, key: `${c.key}${sfx}` });
  };
  const posKeys = ["rcM", "rcAsMin", "rcAsMax", "rcCrack", "rcAsMinCr"], negKeys = ["rcMneg", "rcCrackNeg", "rcAsMinCrNeg"];
  if (M.bx > 0) take(rc.x, posKeys, "X");
  if (M.tx > 0) take(rc.xNeg, negKeys, "X");
  if (M.by > 0) take(rc.y, posKeys, "Y");
  if (M.ty > 0) take(rc.yNeg, negKeys, "Y");

  // конструювання: крок (8.3.1.3), не менше двох нижніх стрижнів через колону в кожному напрямку (8.4.1.3)
  const sMain = Math.min(3 * i.h, 400), clS = code === "DBN" ? `${DS}, 8.3.1.3` : "EN 1992-1-1, 9.3.1.1 (3)";
  for (const [nm, b] of [["botX", i.botX], ["botY", i.botY], ["topX", i.topX], ["topY", i.topY]] as const) {
    if (!(b.d > 0 && b.s > 0)) continue;
    checks.push(mkCheck("slSmain", clS, "s ≤ min(3h; 400) mm", `${nm}: Ø${b.d}/${b.s}; ${b.s} ≤ ${f(sMain, 0)} mm`, b.s / sMain));
  }
  const cMinX = i.colShape === "circle" ? i.cx : i.cy, cMinY = i.cx;
  for (const [nm, b, cw] of [["botX", i.botX, cMinX], ["botY", i.botY, cMinY]] as const) {
    const nThrough = b.d > 0 && b.s > 0 ? Math.floor(cw / b.s) + 1 : 0;
    checks.push(mkCheck("fsBotCol", code === "DBN" ? `${DS}, 8.4.1.3` : "EN 1992-1-1, 9.4.1 (3)", "≥ 2 нижні стрижні через колону",
      `${nm}: Ø${b.d}/${b.s} на ширині колони ${f(cw, 0)} mm — ${nThrough} шт.`, nThrough > 0 ? 2 / nThrough : Infinity));
  }

  // прогин: пружний від квазіпостійного × κ_eff/κ_el у точці найбільшого прогину
  let kMax = 0;
  for (let k = 1; k < nn; k++) if (Math.abs(fem.w[k]) > Math.abs(fem.w[kMax])) kMax = k;
  const wEl = Math.abs(fem.w[kMax]) * kq;
  const [mxK, myK, mxyK] = fem.m[kMax];
  const dirD: "x" | "y" = Math.abs(mxK) >= Math.abs(myK) ? "x" : "y";
  const Mq = (((dirD === "x" ? Math.max(0, -mxK) : Math.max(0, -myK)) + Math.abs(mxyK)) / 1000) * kq;
  const cur = rcCurvature(strip(dirD, 0, 0, false), Mq, phi, false);
  const kEl = (Mq * 1e6) / (conc.Ecm * ((1000 * i.h ** 3) / 12));
  const kD = kEl > 0 ? cur.k / kEl : 1 + phi;
  const fTot = wEl * kD;
  const xk = xs[kMax % (nx + 1)], yk = ys[Math.floor(kMax / (nx + 1))];
  const Xl = fem.X[fem.X.length - 1], Yl = fem.Y[fem.Y.length - 1];
  const cant = xk < -1 || xk > Xl + 1 || yk < -1 || yk > Yl + 1;
  // прольот панелі: більший з двох (для плоских плит — за більшим прольотом); консоль — 2·виліт
  const lD = cant ? (2 * fem.ov) / 1000 : Math.max(local(fem.X, i.sx, xk), local(fem.Y, i.sy, yk)) / 1000;
  const nDen = i.deflN && i.deflN > 0 ? i.deflN : code === "DBN" ? deflectionLimitDSTU(lD) : 250, flim = (lD * 1000) / nDen;
  checks.push(mkCheck("slDefl", code === "DBN" ? `ДБН В.2.6-98:2009, 7.4.4; ${DS}, 5.4; ДСТУ Б В.1.2-3:2006, табл. 1` : "EN 1992-1-1, 7.4.1 (4), 7.4.3 (7.18)",
    `f ≤ ${cant ? "2l" : "l"}/${f(nDen, 0)}`, `f_el = ${f(wEl, 1)} mm × ${f(kD, 2)} (тріщини, φ = ${f(phi, 1)}) = ${f(fTot, 1)} ≤ ${f(flim, 1)} mm`, fTot / flim));

  // продавлювання
  const sx = i.sx, sy = i.sy;
  const adj = (s: number[]) => s.every((v, j) => j === 0 || Math.max(v, s[j - 1]) / Math.min(v, s[j - 1]) <= 1.25 + 1e-9);
  const approxOk = adj(sx) && adj(sy);
  const approx = (i.beta ?? "auto") === "auto" && approxOk;
  const dX = i.h - i.c - i.topX.d / 2, dY = i.h - i.c - i.topX.d - i.topY.d / 2, dEff = (dX + dY) / 2;
  const rho = Math.sqrt((As.tx / (1000 * dX)) * (As.ty / (1000 * dY)));
  const half = (i.colShape === "circle" ? [i.cx / 2, i.cx / 2] : [i.cx / 2, i.cy / 2]);
  const edgeDist = fem.ov;
  const LET = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const cols: FlatColumn[] = fem.cols.map((c, ci) => {
    const nxA = fem.X.length - 1, nyA = fem.Y.length - 1;
    const exE = i.sym ? Infinity : edgeDist - half[0], eyE = i.sym ? Infinity : edgeDist - half[1];
    const geom: PunchGeom = {
      shape: i.colShape, cx: i.cx, cy: i.colShape === "circle" ? i.cx : i.cy,
      edgeX: !i.sym && (c.ix === 0 || c.ix === nxA) ? { s: c.ix === 0 ? -1 : 1, e: exE } : null,
      edgeY: !i.sym && (c.iy === 0 || c.iy === nyA) ? { s: c.iy === 0 ? -1 : 1, e: eyE } : null,
    };
    // рівнодійна V зміщена на e: e_y = M_x/V, e_x = −M_y/V (M — момент колони на плиту)
    const ex = c.V > 0 ? -c.My / c.V : 0, ey = c.V > 0 ? c.Mx / c.V : 0;
    const p = punchCheck({ code, conc, geom, V: c.V, ex, ey, d: dEff, rho, h: i.h, approx, rf: i.punch, rebar: i.rebar });
    return { label: `${LET[c.iy] ?? c.iy + 1}-${c.ix + 1}`, ix: c.ix, iy: c.iy, x: c.x / 1000, y: c.y / 1000, V: c.V / 1000, Mx: c.Mx / 1e6, My: c.My / 1e6,
      top: { Mx: colTop[ci].x.Mt, mx: colTop[ci].x.m, My: colTop[ci].y.Mt, my: colTop[ci].y.m }, geom, p };
  });
  const gov = (fn: (c: FlatColumn) => number) => cols.reduce((m, c) => (fn(c) > fn(m) ? c : m), cols[0]);
  const TY: Record<PunchType, string> = { int: "середня", edge: "крайня", corner: "кутова" };
  const desc = (c: FlatColumn) => `${c.label} (${TY[c.p.type]}): V_Ed = ${f(c.V, 1)} kN, β = ${f(c.p.beta, 3)}${c.p.approx ? " (рис. 4.24)" : ""}, d = ${f(c.p.d, 0)} mm`;
  const cl = (dbn: string, en: string) => (code === "DBN" ? `${DS}, ${dbn}` : `EN 1992-1-1, ${en}`);
  if (cols.length) {
    const c0 = gov((c) => c.p.vEd0 / c.p.vRdMax);
    checks.push(mkCheck("punchMax", cl("4.8.5.3 (4.93)", "6.4.5 (3) (6.53)"), "v_Ed,0 = β·V_Ed/(u_0·d) ≤ v_Rd,max = 0.5·ν·f_cd",
      `${desc(c0)}; u_0 = ${f(c0.p.u0, 0)} mm; ${f(c0.p.vEd0, 3)} ≤ ${f(c0.p.vRdMax, 3)} MPa`, c0.p.vEd0 / c0.p.vRdMax));
    const rf = i.punch && i.punch.d > 0 && i.punch.n > 0 && i.punch.sr > 0 && i.punch.rows > 0 ? i.punch : undefined;
    const needRf = cols.filter((c) => c.p.vEd > c.p.vRdc);
    if (!rf || !needRf.length) {
      const cC = gov((c) => c.p.vEd / c.p.vRdc);
      checks.push(mkCheck("punchC", cl("4.8.3.3 (4.77), 4.8.4.1 (4.86)", "6.4.3 (6.38), 6.4.4 (6.47)"), "v_Ed = β·V_Ed/(u_1·d) ≤ v_Rd,c",
        `${desc(cC)}; u_1 = ${f(cC.p.u1, 0)} mm; ρ_l = ${f(rho * 100, 3)} %; ${f(cC.p.vEd, 3)} ≤ ${f(cC.p.vRdc, 3)} MPa${cC.p.aswNeed ? `; потрібна поперечна арматура: A_sw ≥ ${f(cC.p.aswNeed, 0)} mm² на периметр при s_r = 0.75d` : ""}`,
        cC.p.vEd / cC.p.vRdc));
    }
    if (rf && needRf.length) {
      const cs = needRf.reduce((m, c) => (c.p.vEd / c.p.vRdcs! > m.p.vEd / m.p.vRdcs! ? c : m));
      checks.push(mkCheck("punchCs", cl("4.8.5.1 (4.92)", "6.4.5 (1) (6.52)"), "v_Ed ≤ v_Rd,cs = 0.75·v_Rd,c + 1.5·(d/s_r)·A_sw·f_ywd,ef/(u_1·d)",
        `${desc(cs)}; ${rf.n}Ø${rf.d} на периметр, s_r = ${rf.sr} mm; v_Rd,c = ${f(cs.p.vRdc, 3)}; ${f(cs.p.vEd, 3)} ≤ ${f(cs.p.vRdcs!, 3)} MPa`, cs.p.vEd / cs.p.vRdcs!));
      const co = needRf.reduce((m, c) => (c.p.rOut - c.p.rLast! > m.p.rOut - m.p.rLast! ? c : m));
      const req = co.p.rOut - 1.5 * co.p.d;
      checks.push(mkCheck("punchOut", cl("4.8.5.4 (4.94), 8.4.3.1", "6.4.5 (4) (6.54), 9.4.3 (1)"), "останній ряд ≥ r_out − 1.5·d",
        `${co.label}: u_out = ${f(co.p.uOut, 0)} mm на ${f(co.p.rOut, 0)} mm від грані; останній ряд ${f(co.p.rLast!, 0)} ≥ ${f(req, 0)} mm`, req > 0 ? req / co.p.rLast! : 0));
      checks.push(mkCheck("punchSr", cl("8.4.3.1", "9.4.3 (1)"), "s_r ≤ 0.75·d", `${rf.sr} ≤ ${f(0.75 * dEff, 0)} mm`, rf.sr / (0.75 * dEff)));
      checks.push(mkCheck("punchRows", cl("8.4.3.1", "9.4.3 (1)"), "не менше двох периметрів", `${rf.rows} ≥ 2`, 2 / rf.rows));
      if (code === "DBN") checks.push(mkCheck("punchH", `${DS}, 8.3.2.1`, "h ≥ 200 mm (плита з поперечною арматурою)", `${i.h} ≥ 200 mm`, 200 / i.h));
    }
  }

  const scale = kD * kq;
  const field: FlatField = { xs: xs.map((v) => v / 1000), ys: ys.map((v) => v / 1000), mbx, mby, mtx, mty, w: fem.w.map((v) => Math.abs(v) * scale) };
  const need: FlatResult["need"] = {};
  for (const [k, Med, dir, top] of [["botX", M.bx, "x", false], ["botY", M.by, "y", false], ["topX", M.tx, "x", true], ["topY", M.ty, "y", true]] as const) {
    const r = dir === "x" ? (top ? rc.xNeg : rc.x) : top ? rc.yNeg : rc.y, have = top ? r.neg?.MRd ?? 0 : r.pos.MRd;
    if (Med <= have) continue;
    const cur0 = i[k], opts: SlabBars[] = [];
    for (const d of [8, 10, 12, 14, 16, 18, 20, 22, 25].filter((d) => d >= Math.max(8, cur0.d))) for (const sp of [100, 125, 150, 175, 200, 250, 300].filter((x) => x <= sMain)) opts.push({ d, s: sp });
    opts.sort((a, b) => slabAs(a) - slabAs(b));
    // M_Rd зростає з площею — двійковий пошук найменшої достатньої
    const ok = (o: SlabBars) => rcUls({ ...strip(dir, 0, 0, false), [top ? "top" : "bot"]: lay(o, slabAs(o)) } as RcInput, conc, 0, top).MRd >= Med;
    let lo = 0, hi = opts.length - 1;
    if (opts.length && ok(opts[hi])) {
      while (lo < hi) { const mid = (lo + hi) >> 1; if (ok(opts[mid])) hi = mid; else lo = mid + 1; }
      need[k] = opts[lo];
    }
  }
  const maxUtil = Math.max(0, ...checks.map((c) => c.util));
  return { wd, wqp, selfW, M, As, defl: { el: wEl, k: kD, f: fTot, flim, n: nDen, l: lD, cant }, field, cols, rc, approxOk, checks, maxUtil, need };
}
