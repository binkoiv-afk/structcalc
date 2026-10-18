// Вільний вузол: будь-які деталі (пластини, профілі) і будь-які зв'язки між ними (шви, групи болтів).
// Деталі — жорсткі тіла, зв'язки — пружні групи (точкові пружини по швах і болтах), опорні деталі закріплені.
// Сила в точці навантаженої деталі розходиться по зв'язках за їх жорсткостями (для ланцюжка — статично визначно),
// кожен зв'язок перевіряється своїми зусиллями: шви — як група кутових швів, болти — як група болтів + продавлювання.
// Осі: x, y, z глобальні; одиниці Н, мм, МПа.

import type { CodeId, Check } from "../codes/types";
import { f, mkCheck } from "../codes/types";
import { steel } from "../catalog/materials";
import type { Section } from "../geometry/sections";
import { BOLT_AS, checkBolts } from "../connections/bolts";
import { checkFillet } from "../connections/welds";
import type { WeldSeg } from "../connections/welds";
import { boltParts, extraParts } from "./steelJoints";
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
export interface FreeResult {
  combos: { name: string; checks: Check[]; forces: FConnForce[]; maxUtil: number }[];
  envelope: (Check & { combo: string; conn: string })[];
  maxUtil: number; ok: boolean;
  parts: JPart[]; dims: JDim[];
  /** зв'язок → огинаючий коефіцієнт */
  connUtil: Record<string, number>;
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

/** Жорсткість групи 6×6 у глобальних осях відносно точки o (точкові пружини: kn = E·A/l, ks = G·A/l) */
function connK(c: FConn): number[][] {
  const n = unit(c.n), [ua, va] = UV[c.n], eu = unit(ua), ev = unit(va);
  const K = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (const p of connPoints(c)) {
    const r: V3 = [eu[0] * p.u + ev[0] * p.v, eu[1] * p.u + ev[1] * p.v, eu[2] * p.u + ev[2] * p.v];
    // точкова пружина: k = kn·n⊗n + ks·(I − n⊗n); переміщення точки = U + θ × r
    const kn = (E * p.A) / LREF, ks = (G * p.A) / LREF;
    const k3 = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ks * (i === j ? 1 : 0) + (kn - ks) * n[i] * n[j]));
    // переміщення точки: U + θ × r, коефіцієнт при θ_j — (e_j × r)_i
    const T = [0, 1, 2].map((i) => [0, 1, 2, 3, 4, 5].map((j) => (j < 3 ? (i === j ? 1 : 0) : cross(unit(["x", "y", "z"][j - 3] as JAxis), r)[i])));
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
      let s = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += T[i][a] * k3[i][j] * T[j][b];
      K[a][b] += s;
    }
  }
  return K;
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  const scale = Math.max(...A.map((r, i) => Math.abs(r[i]))) || 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9 * scale) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const q = M[r][c] / M[c][c]; if (q) for (let k = c; k <= n; k++) M[r][k] -= q * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

const tOf = (p: FPart) => (p.kind === "plate" || !p.sec ? p.t : Math.max(p.sec.dims.tf ?? 0, p.sec.dims.t ?? 0, p.sec.dims.tw ?? 0, 3));

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
  const dofOf = new Map(free.map((p, k) => [p.id, 6 * k]));
  const nd = 6 * free.length;
  // збірка жорсткості: пружина між тілами A і B у точці o
  const K = Array.from({ length: nd }, () => new Array(nd).fill(0));
  const Ts = new Map<string, { kc: number[][]; TA?: number[][]; TB?: number[][]; da?: number; db?: number }>();
  const Tbody = (c0: V3, o: V3) => {
    // переміщення точки o тіла з центром c0: [U + θ × (o − c0); θ]
    const r = sub(o, c0), T = Array.from({ length: 6 }, (_, k) => new Array(6).fill(0).map((_, j) => (k === j ? 1 : 0) as number));
    for (let a = 0; a < 3; a++) for (let j = 0; j < 3; j++) { const e: V3 = [0, 0, 0]; e[j] = 1; T[a][3 + j] = cross(e, r)[a]; }
    return T;
  };
  for (const c of conns) {
    const kc = connK(c), pa = P.get(c.a)!, pb = P.get(c.b)!;
    const da = dofOf.get(pa.id), db = dofOf.get(pb.id);
    const TA = da !== undefined ? Tbody(pa.c, c.o) : undefined, TB = db !== undefined ? Tbody(pb.c, c.o) : undefined;
    Ts.set(c.id, { kc, TA, TB, da, db });
    const blocks: [number[][] | undefined, number | undefined, number][] = [[TA, da, -1], [TB, db, 1]];
    for (const [T1, d1, s1] of blocks) for (const [T2, d2, s2] of blocks) {
      if (!T1 || !T2 || d1 === undefined || d2 === undefined) continue;
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
        let s = 0;
        for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) s += T1[x][a] * kc[x][y] * T2[y][b];
        K[d1 + a][d2 + b] += s1 * s2 * s;
      }
    }
  }
  const lp = dofOf.get(loadPart.id);
  const results = i.combos.map((cb) => {
    const F: V3 = [cb.Fx ?? 0, cb.Fy ?? 0, cb.Fz ?? 0], M0: V3 = [cb.Mx ?? 0, cb.My ?? 0, cb.Mz ?? 0];
    const forces: FConnForce[] = [];
    const checks: Check[] = [];
    if (lp === undefined) {
      // навантажена деталь опорна — зусилля одразу в опору
      return { name: cb.name, checks, forces, maxUtil: 0 };
    }
    const rhs = new Array(nd).fill(0);
    const Mt = cross(sub(i.at, loadPart.c), F);
    for (let k = 0; k < 3; k++) { rhs[lp + k] = F[k]; rhs[lp + 3 + k] = M0[k] + Mt[k]; }
    const u = solve(K, rhs);
    if (!u) throw new Error("free:mechanism");
    for (const c of conns) {
      const t = Ts.get(c.id)!;
      const dA = new Array(6).fill(0), dB = new Array(6).fill(0);
      for (let a = 0; a < 6; a++) for (let j = 0; j < 6; j++) {
        if (t.TA && t.da !== undefined) dA[a] += t.TA[a][j] * u[t.da + j];
        if (t.TB && t.db !== undefined) dB[a] += t.TB[a][j] * u[t.db + j];
      }
      // сила, з якою B тягне зв'язок відносно A (у точці o): f = K·(u_B − u_A); + розтяг, якщо B відходить від A уздовж n
      const rel = dB.map((v, k) => v - dA[k]);
      const fg = t.kc.map((row) => row.reduce((s, v, k) => s + v * rel[k], 0));
      const n = unit(c.n), [ua, va] = UV[c.n], eu = unit(ua), ev = unit(va);
      const dot = (a: number[], b: V3, off = 0) => a[off] * b[0] + a[off + 1] * b[1] + a[off + 2] * b[2];
      const fr: FConnForce = { conn: c.id, N: dot(fg, n), Vu: dot(fg, eu), Vv: dot(fg, ev), Mn: dot(fg, n, 3), Mu: dot(fg, eu, 3), Mv: dot(fg, ev, 3) };
      forces.push(fr);
      checks.push(...connChecks(code, c, fr, P.get(c.a)!, P.get(c.b)!, gc, gn).map((x) => ({ ...x, clause: `${x.clause} · ${c.id}`, conn: c.id }) as Check));
    }
    const us = checks.map((x) => x.util);
    return { name: cb.name, checks, forces, maxUtil: us.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...us) };
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
  return { combos: results, envelope, maxUtil: us.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...us), ok: envelope.every((x) => x.ok), parts, dims: [], connUtil, notes };
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
