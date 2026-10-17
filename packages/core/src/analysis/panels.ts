// Вантажні панелі (обшивка, настил, стінка): площинне навантаження на всю панель або її частину
// розподіляється на стрижні по краях панелі — за найближчим краєм (вантажна площа «конвертом»)
// або балочно (одностороння робота на два протилежні краї).
// Одиниці: Н, мм, МПа (Н/мм²).

import type { FrameModel, MemberLoad, Vec3 } from "./frame3d";

export interface Panel {
  id: string;
  /** 3 або 4 вузли по контуру; нормаль — за правилом правої руки */
  nodes: string[];
  /** two — на всі краї зі стрижнями; one — лише на краї 0 і 2 (span = 0) або 1 і 3 (span = 1) */
  mode: "two" | "one";
  span?: 0 | 1;
}

export interface PanelLoad {
  panel: string;
  case: string;
  /** інтенсивність, МПа (Н/мм²); для normal — «+» уздовж нормалі панелі */
  q: number;
  dir: "normal" | "gx" | "gy" | "gz";
  /** частина панелі в параметрах u (від краю 0→1) і v (від краю 0→3), 0…1 */
  region?: { u0: number; u1: number; v0: number; v1: number };
  /** на горизонтальну проєкцію (сніг) замість фактичної площі */
  projected?: boolean;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(...a);

/** Стрижні, що лежать на відрізку AB: параметри t початку і кінця кожного */
function edgeMembers(model: FrameModel, A: Vec3, B: Vec3) {
  const L = len(sub(B, A)), d = mul(sub(B, A), 1 / L);
  const P = new Map(model.nodes.map((n) => [n.id, [n.x, n.y, n.z] as Vec3]));
  const tol = Math.max(1, L * 1e-4);
  const on = (p: Vec3) => {
    const t = dot(sub(p, A), d);
    const off = len(sub(sub(p, A), mul(d, t)));
    return off < tol && t > -tol && t < L + tol ? t / L : null;
  };
  const out: { member: string; t0: number; t1: number; Lm: number }[] = [];
  for (const m of model.members) {
    const ti = on(P.get(m.i)!), tj = on(P.get(m.j)!);
    if (ti === null || tj === null || Math.abs(tj - ti) < 1e-9) continue;
    out.push({ member: m.id, t0: ti, t1: tj, Lm: Math.abs(tj - ti) * L });
  }
  // покриття краю
  const iv = out.map((o) => [Math.min(o.t0, o.t1), Math.max(o.t0, o.t1)]).sort((a, b) => a[0] - b[0]);
  let cov = 0, end = 0;
  for (const [a, b] of iv) { if (b > end) { cov += b - Math.max(a, end); end = b; } }
  return { list: out, covered: cov > 0.99 };
}

export interface PanelInfo { id: string; area: number; normal: Vec3; edges: { supported: boolean }[]; error?: string }

export function panelGeometry(model: FrameModel, p: Panel) {
  const P = new Map(model.nodes.map((n) => [n.id, [n.x, n.y, n.z] as Vec3]));
  const c = p.nodes.map((id) => P.get(id));
  if (c.some((x) => !x) || c.length < 3 || c.length > 4) throw new Error(`panel ${p.id}: needs 3–4 nodes`);
  const C = c as Vec3[];
  const Q = C.length === 3 ? [C[0], C[1], C[2], C[2]] : C;
  const X = (u: number, v: number): Vec3 => add(add(mul(Q[0], (1 - u) * (1 - v)), mul(Q[1], u * (1 - v))), add(mul(Q[2], u * v), mul(Q[3], (1 - u) * v)));
  const du = (u: number, v: number): Vec3 => add(mul(sub(Q[1], Q[0]), 1 - v), mul(sub(Q[2], Q[3]), v));
  const dv = (u: number, v: number): Vec3 => add(mul(sub(Q[3], Q[0]), 1 - u), mul(sub(Q[2], Q[1]), u));
  const edges = C.map((a, k) => [a, C[(k + 1) % C.length]] as [Vec3, Vec3]);
  return { C, X, du, dv, edges };
}

/** Розподіл навантажень панелей на стрижні. Повертає навантаження за загруженнями і довідку по панелях. */
export function panelLoads(model: FrameModel, panels: Panel[], loads: PanelLoad[], grid = 24, bins = 16) {
  const byCase = new Map<string, MemberLoad[]>();
  const info: PanelInfo[] = [];
  for (const p of panels) {
    let g: ReturnType<typeof panelGeometry>;
    try { g = panelGeometry(model, p); } catch (e) { info.push({ id: p.id, area: 0, normal: [0, 0, 1], edges: [], error: String((e as Error).message) }); continue; }
    const em = g.edges.map(([A, B]) => edgeMembers(model, A, B));
    const nE = g.edges.length;
    // краї, що сприймають навантаження
    const sup = em.map((e, k) => e.covered && (p.mode === "two" || (nE === 4 && k % 2 === (p.span ?? 0))));
    let area = 0;
    const n0 = cross(g.du(0.5, 0.5), g.dv(0.5, 0.5));
    const normal = mul(n0, 1 / (len(n0) || 1));
    for (let a = 0; a < grid; a++) for (let b = 0; b < grid; b++) area += len(cross(g.du((a + 0.5) / grid, (b + 0.5) / grid), g.dv((a + 0.5) / grid, (b + 0.5) / grid))) / grid / grid;
    info.push({ id: p.id, area, normal, edges: sup.map((s) => ({ supported: s })), error: sup.some(Boolean) ? undefined : "noSupport" });
    if (!sup.some(Boolean)) continue;
    for (const pl of loads.filter((l) => l.panel === p.id)) {
      const r = pl.region ?? { u0: 0, u1: 1, v0: 0, v1: 1 };
      // сили в бінах кожного краю
      const acc = g.edges.map(() => Array.from({ length: bins }, () => [0, 0, 0] as Vec3));
      for (let a = 0; a < grid; a++) for (let b = 0; b < grid; b++) {
        const u = (a + 0.5) / grid, v = (b + 0.5) / grid;
        if (u < r.u0 || u > r.u1 || v < r.v0 || v > r.v1) continue;
        const nv = cross(g.du(u, v), g.dv(u, v));
        let dA = len(nv) / grid / grid;
        if (pl.projected) dA = Math.abs(nv[2]) / grid / grid;
        if (dA <= 0) continue;
        const dirv: Vec3 = pl.dir === "normal" ? mul(nv, 1 / len(nv)) : pl.dir === "gx" ? [1, 0, 0] : pl.dir === "gy" ? [0, 1, 0] : [0, 0, 1];
        const F = mul(dirv, pl.q * dA);
        const pt = g.X(u, v);
        // найближчий несучий край; на бісектрисі — порівну між рівновіддаленими краями
        const cand: { k: number; d: number; t: number }[] = [];
        g.edges.forEach(([A, B], k) => {
          if (!sup[k]) return;
          const AB = sub(B, A), L2 = dot(AB, AB);
          const t = Math.max(0, Math.min(1, dot(sub(pt, A), AB) / L2));
          cand.push({ k, d: len(sub(pt, add(A, mul(AB, t)))), t });
        });
        const dmin = Math.min(...cand.map((c) => c.d));
        const near = cand.filter((c) => c.d <= dmin * (1 + 1e-6) + 1e-9);
        for (const c of near) {
          const bi = Math.min(bins - 1, Math.floor(c.t * bins));
          acc[c.k][bi] = add(acc[c.k][bi], mul(F, 1 / near.length));
        }
      }
      const list = byCase.get(pl.case) ?? [];
      g.edges.forEach(([A, B], k) => {
        if (!sup[k]) return;
        const L = len(sub(B, A));
        for (let bi = 0; bi < bins; bi++) {
          const Fb = acc[k][bi];
          if (!Fb[0] && !Fb[1] && !Fb[2]) continue;
          const t0 = bi / bins, t1 = (bi + 1) / bins, wv = mul(Fb, 1 / ((t1 - t0) * L)); // Н/мм
          for (const m of em[k].list) {
            const lo = Math.max(t0, Math.min(m.t0, m.t1)), hi = Math.min(t1, Math.max(m.t0, m.t1));
            if (hi <= lo) continue;
            // параметр краю → відстань від вузла i стрижня
            const toA = (t: number) => (Math.abs(t - m.t0) / Math.abs(m.t1 - m.t0)) * m.Lm;
            const a = Math.min(toA(lo), toA(hi)), b = Math.max(toA(lo), toA(hi));
            (["gx", "gy", "gz"] as const).forEach((d, q) => { if (Math.abs(wv[q]) > 1e-12) list.push({ member: m.member, kind: "dist", dir: d, w1: wv[q], a, b }); });
          }
        }
      });
      byCase.set(pl.case, list);
    }
  }
  return { byCase, info };
}
