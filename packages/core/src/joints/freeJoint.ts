// Вільний вузол: будь-які деталі (пластини, профілі) і будь-які зв'язки між ними (шви, групи болтів).
// Пластини — сітка оболонкових елементів (МІТЦ4 + QM6), профілі — жорсткі тіла, зв'язки — точкові пружини по швах
// і болтах, опорні деталі закріплені. Сила в точці навантаженої деталі розходиться по зв'язках за жорсткостями.
// Перевіряються: кожен зв'язок (шви — як група кутових швів, болти — як група болтів + продавлювання),
// переріз кожної деталі біля зв'язку, еквівалентні напруження в пластинах (згин між зв'язками).
// Осі: x, y, z глобальні; одиниці Н, мм, МПа.

import type { CodeId, Check } from "../codes/types";
import { f, mkCheck } from "../codes/types";
import { steel } from "../catalog/materials";
import type { Section } from "../geometry/sections";
import { BOLT_AS, checkBolts } from "../connections/bolts";
import { checkFillet } from "../connections/welds";
import type { WeldSeg } from "../connections/welds";
import { boltParts, extraParts } from "./steelJoints";
import { shellForces, shellPrepare } from "../analysis/shell";
import type { ShellElement, ShellPrepared } from "../analysis/shell";
import { rcmOrder, SkyMatrix, skyFactor, skySolve } from "../analysis/skyline";
import type { JAxis, JDim, JExtra, JPart } from "./steelJoints";

export type V3 = [number, number, number];
export interface FPart extends JExtra { steel: string; role: "free" | "load" | "support" }
export interface FConn {
  id: string; a: string; b: string; kind: "weld" | "bolts";
  /** площина зв'язку: нормаль n і точка o (центр групи) */
  n: JAxis; o: V3;
  /** шви: відрізки в площині (u, v) від o; u, v — дві інші осі за циклом (n = x → y, z; y → z, x; z → x, y) */
  segs?: { u1: number; v1: number; u2: number; v2: number }[]; kf?: number;
  /** болти: ряди вздовж v, стовпці вздовж u, кроки; діаметр, клас, площин зрізу; фрикційні */
  rows?: number; cols?: number; pu?: number; pv?: number; d?: number; cls?: string; planes?: number; friction?: boolean; edge?: number;
}
export interface FCombo { name: string; Fx?: number; Fy?: number; Fz?: number; Mx?: number; My?: number; Mz?: number }
export interface FreeInput {
  code: CodeId; parts: FPart[]; conns: FConn[];
  /** точка прикладання сил (на навантаженій деталі) */
  at: V3;
  combos: FCombo[];
  gammaC?: number; gammaN?: number;
}
export interface FConnForce { conn: string; N: number; Vu: number; Vv: number; Mn: number; Mu: number; Mv: number }
/** сітка пластини і огинаюча σ_ef / межа по елементах (рядки вздовж V, у рядку — вздовж U) */
export interface FPlateMap {
  part: string; U: JAxis; V: JAxis; u0: number; v0: number; hu: number; hv: number; nu: number; nv: number; util: number[];
  /** зв'язки на пластині в її координатах (U, V): болти — точки, шви — відрізки */
  bolts: [number, number][]; welds: [number, number, number, number][];
}
export interface FreeResult {
  combos: { name: string; checks: Check[]; forces: FConnForce[]; maxUtil: number }[];
  envelope: (Check & { combo: string; conn: string })[];
  maxUtil: number; ok: boolean;
  parts: JPart[]; dims: JDim[];
  /** зв'язок або деталь → огинаючий коефіцієнт */
  connUtil: Record<string, number>;
  /** карти напружень пластин */
  plates: FPlateMap[];
  notes: string[];
}

const UV: Record<JAxis, [JAxis, JAxis]> = { x: ["y", "z"], y: ["z", "x"], z: ["x", "y"] };
const IDX: Record<JAxis, number> = { x: 0, y: 1, z: 2 };
const E = 210000, G = 81000, LREF = 10;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (ax: JAxis): V3 => { const e: V3 = [0, 0, 0]; e[IDX[ax]] = 1; return e; };
const toG = (n: JAxis, o: V3, u: number, v: number): V3 => { const p: V3 = [...o]; const [a, b] = UV[n]; p[IDX[a]] += u; p[IDX[b]] += v; return p; };

/** Точки зв'язку з площами (локально u, v від o): шви — дискретизація відрізків, болти — центри болтів */
function connPoints(c: FConn): { u: number; v: number; A: number }[] {
  if (c.kind === "weld") {
    const a = 0.7 * (c.kf ?? 6), out: { u: number; v: number; A: number }[] = [];
    for (const s of c.segs ?? []) {
      const L = Math.hypot(s.u2 - s.u1, s.v2 - s.v1), n = Math.max(2, Math.ceil(L / 10));
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; out.push({ u: s.u1 + (s.u2 - s.u1) * t, v: s.v1 + (s.v2 - s.v1) * t, A: (a * L) / n }); }
    }
    return out;
  }
  return boltGrid(c).map(([u, v]) => ({ u, v, A: BOLT_AS[c.d ?? 16] ?? 0.78 * (c.d ?? 16) ** 2 }));
}
export function boltGrid(c: FConn): [number, number][] {
  const r = Math.max(1, c.rows ?? 2), k = Math.max(1, c.cols ?? 2), pu = c.pu ?? 60, pv = c.pv ?? 60, out: [number, number][] = [];
  for (let i = 0; i < k; i++) for (let j = 0; j < r; j++) out.push([(i - (k - 1) / 2) * pu, (j - (r - 1) / 2) * pv]);
  return out;
}

const tOf = (p: FPart) => (p.kind === "plate" || !p.sec ? p.t : Math.max(p.sec.dims.tf ?? 0, p.sec.dims.t ?? 0, p.sec.dims.tw ?? 0, 3));
const isPlate = (p: FPart) => p.kind === "plate" || !p.sec;
/** осі в площині пластини (як у кресленні): a — уздовж першої, b — уздовж другої */
const OA: Record<JAxis, [JAxis, JAxis]> = { x: ["y", "z"], y: ["x", "z"], z: ["x", "y"] };
const NU = 0.3;

interface Mesh {
  part: FPart; U: JAxis; V: JAxis; nu: number; nv: number; u0: number; v0: number; hu: number; hv: number; n0: number;
  els: { nodes: number[]; e: ShellElement; sp: ShellPrepared }[];
}
/** переміщення точки як лінійна комбінація ступенів вільності: 3 рядки (x, y, z), «віртуальний» номер → коефіцієнт */
type T3 = [Map<number, number>, Map<number, number>, Map<number, number>];
const t3 = (): T3 => [new Map(), new Map(), new Map()];
const addT = (T: T3, r: number, vd: number, c: number) => { if (c) T[r].set(vd, (T[r].get(vd) ?? 0) + c); };
const axisE = ["x", "y", "z"].map((a) => unit(a as JAxis));

/** сітка пластини: крок ≈ більший розмір / 12 (6…30 мм), не більше ~200 елементів */
function meshPlate(p: FPart, n0: number): Mesh {
  const [U, V] = OA[p.axis];
  let h = Math.min(30, Math.max(6, Math.max(p.a, p.b) / 12));
  let nu = Math.max(2, Math.round(p.a / h)), nv = Math.max(2, Math.round(p.b / h));
  while (nu * nv > 200) { h *= 1.15; nu = Math.max(2, Math.round(p.a / h)); nv = Math.max(2, Math.round(p.b / h)); }
  const m: Mesh = { part: p, U, V, nu, nv, u0: p.c[IDX[U]] - p.a / 2, v0: p.c[IDX[V]] - p.b / 2, hu: p.a / nu, hv: p.b / nv, n0, els: [] };
  const at = (i: number, j: number): V3 => { const q: V3 = [...p.c]; q[IDX[U]] = m.u0 + i * m.hu; q[IDX[V]] = m.v0 + j * m.hv; return q; };
  const nid = (i: number, j: number) => n0 + j * (nu + 1) + i;
  // елементи однакові й лише зсунуті — жорсткість у глобальних осях одна на всю сітку
  const e0: ShellElement = { id: p.id, nodes: ["1", "2", "3", "4"], t: p.t, E, nu: NU };
  const sp = shellPrepare(e0, [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) m.els.push({ nodes: [nid(i, j), nid(i + 1, j), nid(i + 1, j + 1), nid(i, j + 1)], e: e0, sp });
  return m;
}
const meshNodes = (m: Mesh) => (m.nu + 1) * (m.nv + 1);

export function checkFree(i: FreeInput): FreeResult {
  const gc = i.gammaC ?? 1, gn = i.gammaN ?? 1, code = i.code;
  const notes: string[] = [];
  const P = new Map(i.parts.map((p) => [p.id, p]));
  const loadPart = i.parts.find((p) => p.role === "load");
  if (!loadPart) throw new Error("free:noLoad");
  if (!i.parts.some((p) => p.role === "support")) throw new Error("free:noSupport");
  const conns = i.conns.filter((c) => P.has(c.a) && P.has(c.b) && c.a !== c.b);
  // деталі без жодного зв'язку (щойно додані) не входять у розрахунок — лише креслення і примітка
  const linked = new Set(conns.flatMap((c) => [c.a, c.b]));
  for (const p of i.parts) if (p.role !== "support" && !linked.has(p.id) && p !== loadPart) notes.push(`loose:${p.id}`);
  const free = i.parts.filter((p) => p.role !== "support" && (linked.has(p.id) || p === loadPart));
  // пластини — сітка оболонкових елементів (МІТЦ4 + QM6), профілі — жорсткі тіла (6 ступенів у центрі)
  const meshes = new Map<string, Mesh>(), rigid = new Map<string, number>();
  let NN = 0;
  for (const p of free) if (isPlate(p)) { const m = meshPlate(p, NN); meshes.set(p.id, m); NN += meshNodes(m); }
  for (const p of free) if (!isPlate(p)) rigid.set(p.id, rigid.size);
  const vdR = (b: number, k: number) => (NN + b) * 6 + k;
  const off = new Set<string>();
  /** переміщення точки g деталі p */
  const attach = (p: FPart, g: V3, conn: string): T3 => {
    const T = t3();
    if (p.role === "support") return T;
    const b = rigid.get(p.id);
    if (b !== undefined) {
      const r = sub(g, p.c);
      for (let a = 0; a < 3; a++) { addT(T, a, vdR(b, a), 1); for (let j = 0; j < 3; j++) addT(T, a, vdR(b, 3 + j), cross(axisE[j], r)[a]); }
      return T;
    }
    const m = meshes.get(p.id)!, pu = g[IDX[m.U]], pv = g[IDX[m.V]], tol = p.t / 2 + 2;
    if (pu < m.u0 - tol || pu > m.u0 + p.a + tol || pv < m.v0 - tol || pv > m.v0 + p.b + tol) off.add(`offplate:${conn}:${p.id}`);
    // елемент, у якому (або найближчий до якого) лежить точка; поза пластиною — лінійна екстраполяція (статика точна)
    const ii = Math.min(m.nu - 1, Math.max(0, Math.floor((pu - m.u0) / m.hu))), jj = Math.min(m.nv - 1, Math.max(0, Math.floor((pv - m.v0) / m.hv)));
    const xi = (2 * (pu - (m.u0 + (ii + 0.5) * m.hu))) / m.hu, eta = (2 * (pv - (m.v0 + (jj + 0.5) * m.hv))) / m.hv;
    const N = [((1 - xi) * (1 - eta)) / 4, ((1 + xi) * (1 - eta)) / 4, ((1 + xi) * (1 + eta)) / 4, ((1 - xi) * (1 + eta)) / 4];
    const el = m.els[jj * m.nu + ii];
    // зміщення від серединної площини — жорсткий відрізок по товщині
    const d: V3 = [0, 0, 0]; d[IDX[p.axis]] = g[IDX[p.axis]] - p.c[IDX[p.axis]];
    el.nodes.forEach((nd, k) => {
      for (let a = 0; a < 3; a++) { addT(T, a, nd * 6 + a, N[k]); for (let j = 0; j < 3; j++) addT(T, a, nd * 6 + 3 + j, N[k] * cross(axisE[j], d)[a]); }
    });
    return T;
  };
  const avgT = (l: T3[]): T3 => { const T = t3(); for (const x of l) for (let a = 0; a < 3; a++) for (const [vd, c] of x[a]) addT(T, a, vd, c / l.length); return T; };
  // пружини зв'язків: шви — точки через 10 мм; болт — між середніми переміщеннями кілець під головкою/шайбою (r = 0.8·d)
  type Spring = { p: V3; k3: number[][]; T: T3 };
  const springs = new Map<string, Spring[]>();
  for (const c of conns) {
    const pa = P.get(c.a)!, pb = P.get(c.b)!, n = unit(c.n), [ua, va] = UV[c.n], eu = unit(ua), ev = unit(va);
    const list: Spring[] = [];
    for (const q of connPoints(c)) {
      const g = toG(c.n, c.o, q.u, q.v), kn = (E * q.A) / LREF, ks = (G * q.A) / LREF;
      const k3 = [0, 1, 2].map((a) => [0, 1, 2].map((b) => ks * (a === b ? 1 : 0) + (kn - ks) * n[a] * n[b]));
      const side = (p: FPart) => {
        if (c.kind === "weld") return attach(p, g, c.id);
        const r = 0.8 * (c.d ?? 16);
        return avgT([0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
          const f = (k * Math.PI) / 4, h: V3 = [g[0] + r * (Math.cos(f) * eu[0] + Math.sin(f) * ev[0]), g[1] + r * (Math.cos(f) * eu[1] + Math.sin(f) * ev[1]), g[2] + r * (Math.cos(f) * eu[2] + Math.sin(f) * ev[2])];
          return attach(p, h, c.id);
        }));
      };
      const TA = side(pa), TB = side(pb), T = t3();
      for (let a = 0; a < 3; a++) { for (const [vd, x] of TB[a]) addT(T, a, vd, x); for (const [vd, x] of TA[a]) addT(T, a, vd, -x); }
      list.push({ p: g, k3, T });
    }
    springs.set(c.id, list);
  }
  notes.push(...off);
  // нумерація: вузли пластин — за RCM (малий профіль), жорсткі тіла — у кінці
  const adj = Array.from({ length: NN }, () => new Set<number>());
  const link = (ns: number[]) => { for (const a of ns) for (const b of ns) if (a !== b) adj[a].add(b); };
  for (const m of meshes.values()) for (const el of m.els) link(el.nodes);
  for (const l of springs.values()) for (const s of l) {
    const ns = new Set<number>();
    for (const r of s.T) for (const vd of r.keys()) if (vd < NN * 6) ns.add(Math.floor(vd / 6));
    link([...ns]);
  }
  const order = rcmOrder(adj), pos = new Int32Array(NN);
  order.forEach((nd, k) => (pos[nd] = k));
  const nd = (NN + rigid.size) * 6;
  const map = (vd: number) => (vd < NN * 6 ? pos[Math.floor(vd / 6)] * 6 + (vd % 6) : vd);
  const K = new SkyMatrix(nd);
  for (const m of meshes.values()) for (const el of m.els) {
    const g = el.nodes.flatMap((x) => [0, 1, 2, 3, 4, 5].map((k) => map(x * 6 + k)));
    for (let a = 0; a < 24; a++) for (let b = 0; b <= a; b++) {
      const v = el.sp.K[a][b];
      if (!v) continue;
      K.add(g[a], g[b], v);
    }
  }
  for (const l of springs.values()) for (const s of l) {
    const rows = s.T.map((r) => [...r].map(([vd, c]) => [map(vd), c] as [number, number]));
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const k = s.k3[a][b];
      if (!k) continue;
      for (const [da, ca] of rows[a]) for (const [db, cb] of rows[b]) if (da >= db) K.add(da, db, k * ca * cb);
    }
  }
  const Fk = nd ? skyFactor(K) : null;
  if (nd && !Fk) throw new Error("free:mechanism");
  const lm = meshes.get(loadPart.id), lr = rigid.get(loadPart.id);
  const results = i.combos.map((cb) => {
    const F: V3 = [cb.Fx ?? 0, cb.Fy ?? 0, cb.Fz ?? 0], M0: V3 = [cb.Mx ?? 0, cb.My ?? 0, cb.Mz ?? 0];
    const forces: FConnForce[] = [];
    const checks: Check[] = [];
    const plateSvm = new Map<string, number[]>();
    // навантажена деталь опорна — зусилля одразу в опору
    if (!Fk || (lm === undefined && lr === undefined)) return { name: cb.name, checks, forces, maxUtil: 0, plateSvm };
    const rhs = new Float64Array(nd);
    if (lr !== undefined) {
      const Mt = cross(sub(i.at, loadPart.c), F);
      for (let k = 0; k < 3; k++) { rhs[vdR(lr, k)] += F[k]; rhs[vdR(lr, 3 + k)] += M0[k] + Mt[k]; }
    } else if (lm) {
      // сила в точці пластини — на латку вузлів навколо неї (розподіл як RBE3: рівнодійна і момент точні)
      const pu = i.at[IDX[lm.U]], pv = i.at[IDX[lm.V]], R0 = Math.max(1.5 * Math.max(lm.hu, lm.hv), 25);
      const pt = (k: number): V3 => { const q: V3 = [...loadPart.c]; q[IDX[lm.U]] = lm.u0 + (k % (lm.nu + 1)) * lm.hu; q[IDX[lm.V]] = lm.v0 + Math.floor(k / (lm.nu + 1)) * lm.hv; return q; };
      let patch = [...Array(meshNodes(lm)).keys()].filter((k) => { const q = pt(k); return Math.hypot(q[IDX[lm.U]] - pu, q[IDX[lm.V]] - pv) <= R0; });
      if (patch.length < 3) {
        const ii = Math.min(lm.nu - 1, Math.max(0, Math.floor((pu - lm.u0) / lm.hu))), jj = Math.min(lm.nv - 1, Math.max(0, Math.floor((pv - lm.v0) / lm.hv)));
        patch = lm.els[jj * lm.nu + ii].nodes.map((x) => x - lm.n0);
      }
      const pts = patch.map(pt), gc0: V3 = [0, 1, 2].map((a) => pts.reduce((s, q) => s + q[a], 0) / pts.length) as V3;
      const Mg = cross(sub(i.at, gc0), F).map((v, a) => v + M0[a]) as V3;
      const I3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const q of pts) { const r = sub(q, gc0), r2 = r[0] ** 2 + r[1] ** 2 + r[2] ** 2; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) I3[a][b] += (a === b ? r2 : 0) - r[a] * r[b]; }
      const w = inv3(I3).map((row) => row[0] * Mg[0] + row[1] * Mg[1] + row[2] * Mg[2]) as V3;
      patch.forEach((k, q) => {
        const fk = cross(w, sub(pts[q], gc0));
        for (let a = 0; a < 3; a++) rhs[map((lm.n0 + k) * 6 + a)] += F[a] / pts.length + fk[a];
      });
    }
    const u = skySolve(Fk, rhs);
    const uv = (vd: number) => u[map(vd)];
    for (const c of conns) {
      // рівнодійна пружин зв'язку в точці o: f = k·(u_B − u_A); + розтяг, якщо B відходить від A уздовж n
      const Fg: V3 = [0, 0, 0], Mg: V3 = [0, 0, 0];
      for (const s of springs.get(c.id)!) {
        const rel = s.T.map((r) => { let x = 0; for (const [vd, k] of r) x += k * uv(vd); return x; });
        const fs = s.k3.map((row) => row[0] * rel[0] + row[1] * rel[1] + row[2] * rel[2]) as V3, ms = cross(sub(s.p, c.o), fs);
        for (let a = 0; a < 3; a++) { Fg[a] += fs[a]; Mg[a] += ms[a]; }
      }
      const n = unit(c.n), [ua, va] = UV[c.n], eu = unit(ua), ev = unit(va);
      const dt = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const fr: FConnForce = { conn: c.id, N: dt(Fg, n), Vu: dt(Fg, eu), Vv: dt(Fg, ev), Mn: dt(Mg, n), Mu: dt(Mg, eu), Mv: dt(Mg, ev) };
      forces.push(fr);
      checks.push(...connChecks(code, c, fr, P.get(c.a)!, P.get(c.b)!, gc, gn).map((x) => ({ ...x, clause: `${x.clause} · ${c.id}`, conn: c.id }) as Check));
      // переріз кожної деталі біля зв'язку
      for (const p of [P.get(c.a)!, P.get(c.b)!]) {
        if (p.role === "support") continue;
        const x = secCheck(code, c, p, Fg, Mg, gc, gn);
        if (x) checks.push({ ...x, clause: `${x.clause} · ${c.id} · ${p.id}`, conn: p.id } as Check);
      }
    }
    // пластини: еквівалентні напруження на поверхнях у точках Гаусса кожного елемента — згин між зв'язками
    const z24 = new Array(24).fill(0);
    for (const m of meshes.values()) {
      const sv = m.els.map((el) => shellForces(el.e, el.sp, el.nodes.flatMap((x) => [0, 1, 2, 3, 4, 5].map((k) => uv(x * 6 + k))), z24).svm);
      plateSvm.set(m.part.id, sv);
      const k = sv.reduce((b, v, q) => (v > sv[b] ? q : b), 0), mt = mat(m.part.steel, m.part.t), lim = (code === "DBN" ? 1.15 * gc : 1) * mt.R;
      const iu = k % m.nu, jv = Math.floor(k / m.nu), cu = m.u0 + (iu + 0.5) * m.hu, cv = m.v0 + (jv + 0.5) * m.hv;
      const cl = code === "DBN" ? "ДБН В.2.6-198, п. 8.2.1 (σ_ef ≤ 1.15·R_y·γ_c); МСЕ пластини" : "EN 1993-1-5, дод. C (пружний МСЕ); EN 1993-1-1, 6.2.1 (6.1)";
      checks.push({ ...mkCheck("jFreePlate", cl,
        "σ_ef,max = √(σ_x² − σ_xσ_y + σ_y² + 3τ²) на поверхні", `${m.U} = ${f(cu, 0)}, ${m.V} = ${f(cv, 0)} mm; ${m.nu}×${m.nv} el.; ${f(sv[k] * gn, 1)} / ${f(lim, 0)} MPa`, (sv[k] * gn) / lim),
        clause: `${cl} · ${m.part.id}`, conn: m.part.id } as Check);
    }
    const us = checks.map((x) => x.util);
    return { name: cb.name, checks, forces, maxUtil: us.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...us), plateSvm };
  });
  // огинаюча
  const m = new Map<string, Check & { combo: string; conn: string }>();
  for (const r of results) for (const ch of r.checks) {
    const id = ch.key + "|" + ch.clause, cur = m.get(id);
    if (!cur || ch.util > cur.util || Number.isNaN(ch.util)) m.set(id, { ...(ch as Check & { conn: string }), combo: r.name });
  }
  const envelope = [...m.values()];
  const connUtil: Record<string, number> = {};
  for (const e of envelope) if (!DETAIL.has(e.key) || e.util > 1) connUtil[e.conn] = Math.max(connUtil[e.conn] ?? 0, e.util);
  // карта напружень пластин: огинаюча по комбінаціях, у частках від межі
  const plates: FPlateMap[] = [...meshes.values()].map((mm) => {
    const lim = (code === "DBN" ? 1.15 * gc : 1) * mat(mm.part.steel, mm.part.t).R;
    const util = mm.els.map((_, k) => Math.max(0, ...results.map((r) => ((r.plateSvm.get(mm.part.id)?.[k] ?? 0) * gn) / lim)));
    const bolts: [number, number][] = [], welds: [number, number, number, number][] = [];
    const uv = (g: V3): [number, number] => [g[IDX[mm.U]], g[IDX[mm.V]]];
    for (const c of conns) if (c.a === mm.part.id || c.b === mm.part.id) {
      if (c.kind === "bolts") for (const [bu, bv] of boltGrid(c)) bolts.push(uv(toG(c.n, c.o, bu, bv)));
      else for (const sg of c.segs ?? []) welds.push([...uv(toG(c.n, c.o, sg.u1, sg.v1)), ...uv(toG(c.n, c.o, sg.u2, sg.v2))]);
    }
    return { part: mm.part.id, U: mm.U, V: mm.V, u0: mm.u0, v0: mm.v0, hu: mm.hu, hv: mm.hv, nu: mm.nu, nv: mm.nv, util, bolts, welds };
  });
  // креслення
  const parts: JPart[] = [];
  for (const p of i.parts) parts.push(...extraParts(p).map((q) => ({ ...q, cls: `${p.kind === "plate" || !p.sec ? "plate" : "steel"}${p.role === "support" ? " column" : ""}` })));
  for (const c of conns) {
    const ax = IDX[c.n];
    if (c.kind === "weld") {
      const k = c.kf ?? 6;
      for (const s of c.segs ?? []) {
        const L = Math.hypot(s.u2 - s.u1, s.v2 - s.v1) || 1, nu = (-(s.v2 - s.v1) / L) * k / 2, nv = ((s.u2 - s.u1) / L) * k / 2;
        const quad: [number, number][] = [[s.u1 - nu, s.v1 - nv], [s.u2 - nu, s.v2 - nv], [s.u2 + nu, s.v2 + nv], [s.u1 + nu, s.v1 + nv]];
        // полігон у порядку осей призми (POLY: x → y, z; y → x, z; z → x, y)
        const poly = quad.map(([qu, qv]) => { const g = toG(c.n, c.o, qu, qv); return polyOf(c.n, g); });
        parts.push({ id: c.id, cls: "weld", axis: c.n, from: c.o[ax] - k / 2, to: c.o[ax] + k / 2, poly });
      }
    } else {
      const ta = tOf(P.get(c.a)!), tb = tOf(P.get(c.b)!);
      for (const [bu, bv] of boltGrid(c)) {
        const g = toG(c.n, c.o, bu, bv), [pu, pv] = polyOf(c.n, g);
        parts.push(...boltParts(c.id, c.n, c.o[ax] - ta, c.o[ax] + tb, pu, pv, c.d ?? 16));
      }
    }
  }
  const us = envelope.map((x) => x.util);
  return { combos: results.map(({ plateSvm: _, ...r }) => r), envelope, maxUtil: us.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...us), ok: envelope.every((x) => x.ok), parts, dims: [], connUtil, plates, notes };
}
const DETAIL = new Set(["weldKfMin", "weldKfMax", "weldAmin", "weldLmin", "weldLflank", "weldLong"]);
/** глобальна точка → координати полігону призми вздовж axis */
const polyOf = (ax: JAxis, g: V3): [number, number] => (ax === "x" ? [g[1], g[2]] : ax === "y" ? [g[0], g[2]] : [g[0], g[1]]);

function mat(id: string, t: number) {
  const g = steel(id);
  const Ryn = g.yieldChar(t, "sheet"), Run = g.ultimate(t, "sheet");
  if (!Number.isFinite(Ryn) || !Number.isFinite(Run)) throw new Error(`steelThk:${id}:${Math.round(t)}`);
  return { Ryn, Run, R: g.strength(t, "sheet") };
}

function connChecks(code: CodeId, c: FConn, fr: FConnForce, pa: FPart, pb: FPart, gc: number, gn: number): Check[] {
  const ta = tOf(pa), tb = tOf(pb), tmin = Math.min(ta, tb), tmax = Math.max(ta, tb);
  const ma = mat(pa.steel, ta), mb = mat(pb.steel, tb);
  const Run = Math.min(ma.Run, mb.Run), Ryn = Math.min(ma.Ryn, mb.Ryn);
  if (c.kind === "weld") {
    const segs: WeldSeg[] = (c.segs ?? []).map((s) => ({ y1: s.u1, z1: s.v1, y2: s.u2, z2: s.v2 }));
    if (!segs.length) return [];
    // зусилля задані в точці o — переносимо моменти в центр ваги швів
    const L = segs.map((s) => Math.hypot(s.y2 - s.y1, s.z2 - s.z1)), Lt = L.reduce((a, b) => a + b, 0) || 1;
    const uc = segs.reduce((a, s, k) => a + (L[k] * (s.y1 + s.y2)) / 2, 0) / Lt, vc = segs.reduce((a, s, k) => a + (L[k] * (s.z1 + s.z2)) / 2, 0) / Lt;
    // M_c = M_o − r × F, r = (0, uc, vc) у локальних (n, u, v)
    const Mn = fr.Mn - (uc * fr.Vv - vc * fr.Vu), Mu = fr.Mu - (vc * fr.N), Mv = fr.Mv + uc * fr.N;
    return checkFillet({ code, segs, kf: c.kf ?? 6, process: "manual", Run, Ryn, tmin, tmax,
      N: fr.N, Vy: fr.Vu, Vz: fr.Vv, Mx: Mn, My: Mu, Mz: Mv, gammaC: gc, gammaN: gn }).checks;
  }
  const grid = boltGrid(c), nb = grid.length, d = c.d ?? 16;
  const Su = grid.reduce((a, [u]) => a + u * u, 0), Sv = grid.reduce((a, [, v]) => a + v * v, 0);
  const umax = Math.max(...grid.map(([u]) => Math.abs(u))), vmax = Math.max(...grid.map(([, v]) => Math.abs(v)));
  // розтяг болта: N/n + згин групи пружно навколо центра (у запас, без зони стиску і підважування)
  const Tb = Math.max(0, fr.N / nb + (Sv ? (Math.abs(fr.Mu) * vmax) / Sv : 0) + (Su ? (Math.abs(fr.Mv) * umax) / Su : 0));
  const out = checkBolts({ code, kind: c.friction ? "friction" : "bearing", d, boltClass: c.cls ?? (code === "DBN" ? "5.6" : "8.8"), shearPlanes: c.planes ?? 1,
    tmin, Ryn, Run, group: { rows: Math.max(1, c.rows ?? 2), cols: Math.max(1, c.cols ?? 2), px: c.pu ?? 60, py: c.pv ?? 60 }, a: c.edge ?? 2 * d,
    Fx: fr.Vu, Fy: fr.Vv, M: fr.Mn, T: Tb * nb, gammaC: gc, gammaN: gn }).checks;
  if (Tb > 0) {
    const dm = 1.6 * d, R = Math.min(ma.R, mb.R), fu = Run;
    const Bp = code === "DBN" ? Math.PI * dm * tmin * 0.58 * R * gc : (0.6 * Math.PI * dm * tmin * fu) / 1.25;
    out.push(mkCheck("jPunchPlate", code === "DBN" ? "зріз листа по контуру шайби π·d_m·t·R_s (за EN 1993-1-8, табл. 3.4)" : "EN 1993-1-8, табл. 3.4 (B_p,Rd)",
      "F_t ≤ B_p", `d_m = ${f(dm, 0)}, t = ${tmin} mm; ${f((Tb * gn) / 1e3, 1)} / ${f(Bp / 1e3, 1)} kN`, (Tb * gn) / Bp));
  }
  return out;
}

function inv3(A: number[][]): number[][] {
  const [a, b, c] = A[0], [d, e, g] = A[1], [h, k, l] = A[2];
  const det = a * (e * l - g * k) - b * (d * l - g * h) + c * (d * k - e * h);
  if (Math.abs(det) < 1e-12 * (Math.abs(a * e * l) + 1e-30)) return [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  return [[e * l - g * k, c * k - b * l, b * g - c * e], [g * h - d * l, a * l - c * h, c * d - a * g], [d * k - e * h, b * h - a * k, a * e - b * d]].map((r) => r.map((v) => v / det));
}

/**
 * Переріз деталі біля зв'язку (зусилля зв'язку F, M у точці o, глобальні).
 * Пластина: зв'язок на грані (n ∥ нормалі) — два перерізи нетто через центр групи, поперек кожної осі площини,
 * на дію в площині (з площини — у розрахунку МСЕ); зв'язок на торці — переріз уздовж площини зв'язку на всі зусилля. Ширина — розмір пластини, нетто за отворами болтів у перерізі.
 * Профіль: переріз ⊥ осі на рівні o, A, W, A_v з каталогу (нетто за отворами — пропорційно).
 */
function secCheck(code: CodeId, c: FConn, p: FPart, F: V3, M: V3, gc: number, gn: number): Check | null {
  const t = tOf(p), mt = mat(p.steel, t), R = mt.R * (code === "DBN" ? gc : 1);
  const d0 = (c.d ?? 16) + (c.d && c.d > 24 ? 3 : 2), [ua, va] = UV[c.n];
  const holes = (along: JAxis) => (c.kind !== "bolts" ? 0 : along === va ? Math.max(1, c.rows ?? 2) : along === ua ? Math.max(1, c.cols ?? 2) : 0);
  const at = (cs: V3) => { const r = sub(c.o, cs), m = cross(r, F); return [M[0] + m[0], M[1] + m[1], M[2] + m[2]] as V3; };
  const util = (sig: number, tau: number) => {
    const se = Math.sqrt(sig * sig + 3 * tau * tau);
    return { se, u: gn * (code === "DBN" ? Math.max(sig / R, se / (1.15 * R)) : se / R) };
  };
  const clause = code === "DBN" ? "ДБН В.2.6-198, п. 8.2.1 (σ ≤ R_y·γ_c, σ_ef ≤ 1.15·R_y·γ_c)" : "EN 1993-1-1, 6.2.1 (6.1)";
  let best: { u: number; sub: string } | null = null;
  if (isPlate(p)) {
    const [U] = OA[p.axis], ext = (s: JAxis) => (s === U ? p.a : p.b);
    const cuts: [JAxis, JAxis][] = c.n === p.axis ? [[ua, va], [va, ua]] : [[c.n, (["x", "y", "z"] as JAxis[]).find((x) => x !== c.n && x !== p.axis)!]];
    for (const [A, S] of cuts) {
      const Lc = ext(S), Ln = Math.max(0.2 * Lc, Lc - holes(S) * d0), An = Ln * t;
      const cs: V3 = [...p.c]; cs[IDX[A]] = c.o[IDX[A]];
      const Mc = at(cs), ax = p.axis;
      // на грані — лише дія в площині пластини (згин із площини між зв'язками — у розрахунку МСЕ); на торці — усе
      const face = c.n === p.axis;
      const sig = Math.abs(F[IDX[A]]) / An + (6 * Math.abs(Mc[IDX[ax]])) / (t * Ln * Ln) + (face ? 0 : (6 * Math.abs(Mc[IDX[S]])) / (Ln * t * t));
      const tau = (1.5 * Math.hypot(F[IDX[S]], face ? 0 : F[IDX[ax]])) / An + (face ? 0 : (3 * Math.abs(Mc[IDX[A]])) / (Ln * t * t));
      const x = util(sig, tau);
      if (!best || x.u > best.u) best = { u: x.u, sub: `⊥${A}: ${f(Ln, 0)}×${f(t, 0)} mm${holes(S) ? ` (−${holes(S)}·d₀)` : ""}; σ = ${f(sig * gn, 1)}, τ = ${f(tau * gn, 1)}; σ_ef = ${f(x.se * gn, 1)} / ${f((code === "DBN" ? 1.15 : 1) * R, 0)} MPa` };
    }
    return mkCheck("jFreeSec", clause, "σ = N/A_n + M/W (у площині і з площини), τ = 1.5·V/A_n", best!.sub, best!.u);
  }
  const s = p.sec!, A = p.axis, [U, V] = OA[A], ia = IDX[A];
  const cs: V3 = [...p.c]; cs[ia] = Math.min(p.c[ia] + p.a / 2, Math.max(p.c[ia] - p.a / 2, c.o[ia]));
  const Mc = at(cs);
  // без повороту: висота перерізу — уздовж V (згин навколо U — сильна вісь), з поворотом — уздовж U
  const H = p.rot ? U : V, B = p.rot ? V : U;
  const nh = holes(A === ua ? va : A === va ? ua : A);
  const An = Math.max(0.3 * s.A, s.A - nh * d0 * t), q = An / s.A;
  const Avy = Math.max(s.A - s.Avz, 0.3 * s.A);
  const tw = s.dims.t ?? s.dims.tw ?? t;
  const Wt = s.kind === "RHS" ? 2 * (s.b - tw) * (s.h - tw) * tw : s.kind === "CHS" ? 2 * Math.PI * ((s.h - tw) / 2) ** 2 * tw : s.It / Math.max(t, 1);
  const sig = Math.abs(F[ia]) / An + Math.abs(Mc[IDX[B]]) / (s.Wy * q) + Math.abs(Mc[IDX[H]]) / (s.Wz * q);
  const tau = Math.abs(F[IDX[H]]) / s.Avz + Math.abs(F[IDX[B]]) / Avy + Math.abs(Mc[ia]) / Wt;
  const x = util(sig, tau);
  return mkCheck("jFreeSec", clause, "σ = N/A_n + M_y/W_y + M_z/W_z, τ = V/A_v + T/W_t",
    `${s.name}${nh ? ` (−${nh}·d₀)` : ""}; σ = ${f(sig * gn, 1)}, τ = ${f(tau * gn, 1)}; σ_ef = ${f(x.se * gn, 1)} / ${f((code === "DBN" ? 1.15 : 1) * R, 0)} MPa`, x.u);
}
