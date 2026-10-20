// Збірка конструкції: вузли, стрижні з профілів сортаменту, стики (шарнір / жорстко) з їх кріпленням
// (зварювання, болти, заклепки, саморези), вантажні панелі, опори (у т.ч. база з плитою й анкерами),
// загруження → сполучення → МСЕ → перевірки стрижнів, стиків і опор.
// Одиниці: Н, мм, МПа.

import type { CodeId, Check } from "../codes/types";
import { f, mkCheck } from "../codes/types";
import { checkMemberDBN } from "../codes/dbn198";
import { checkMemberEN } from "../codes/en1993";
import { findSection } from "../catalog/profiles";
import { steel } from "../catalog/materials";
import type { Section } from "../geometry/sections";
import { buildCombinations } from "../loads/combinations";
import type { LoadCategory } from "../loads/combinations";
import { axialForces, combineFrame, memberAxes, frameBuckling, frameModes, frameSecondOrder, imperfectionCases, G_MM, mergeMemberParts, solveFrame, splitMemberLoads } from "../analysis/frame3d";
import { driftLimit, rhoCQC, rhoDBN, seisSa } from "../loads/seismic";
import type { SeismicInput } from "../loads/seismic";
import type { Dof, FrameMember, FrameModel, FrameNode, FrameResult, LoadCase, MemberForces, MemberLoad, Vec3 } from "../analysis/frame3d";
import { panelGeometry } from "../analysis/panels";
import { shellVonMises } from "../analysis/shell";
import type { ShellElement, ShellLoad } from "../analysis/shell";
import { panelLoads } from "../analysis/panels";
import type { Panel, PanelLoad, PanelInfo } from "../analysis/panels";
import { checkBolts, checkScrews } from "../connections/bolts";
import { checkFillet, weldShape } from "../connections/welds";
import type { WeldSeg } from "../connections/welds";
import { checkBasePlate } from "../joints/basePlate";
import type { BasePlateInput, NodeResult } from "../joints/basePlate";

export type ConnectorKind = "weld" | "bolts" | "rivets" | "screws" | "none";

/** Стик кінця стрижня з вузлом */
export interface EndConn {
  /** робота стику: жорстко (передає моменти) або шарнір (моменти M_y, M_z = 0) */
  behaviour: "rigid" | "pin";
  kind: ConnectorKind;
  /** зварювання по контуру профілю: катет, мм */
  kf?: number;
  /** болти / заклепки: діаметр, клас, ряди × колонки, кроки, товщина фасонки чи листа, площина */
  d?: number; boltClass?: string; rows?: number; cols?: number; px?: number; py?: number;
  /** товщина листа, до якого кріпиться стрижень (фасонка, накладка), мм */
  tp?: number;
  /** web — у площині стінки (фасонка); end — торцева плита (болти на розтяг) */
  plane?: "web" | "end";
  planes?: number;
  /** відстань до краю вздовж зусилля, мм */
  edge?: number;
  /** саморези: кількість, опір зрізу/відриву (виробник), Н; товщина опорного елемента */
  n?: number; FvRk?: number; FtRk?: number; t1?: number;
}

export interface AsmNode {
  id: string; x: number; y: number; z: number;
  support?: "none" | "fixed" | "pinned" | "roller" | "base";
  /** додаткові закріплення окремих ступенів (зв'язки, упори) */
  fix?: Partial<Record<Dof, boolean>>;
  /** база колони: плита, анкери, бетон (профіль — від стрижня у вузлі) */
  base?: Omit<BasePlateInput, "code" | "kind" | "profile" | "profileSteel" | "combos">;
}

export interface AsmMember {
  id: string; i: string; j: string;
  family: string; size: string; steel: string;
  beta?: number;
  /** коефіцієнти розрахункової довжини відносно y і z */
  mu?: { y: number; z: number };
  endI: EndConn; endJ: EndConn;
  /** раскріплення в прольоті (прогони, зв'язки) з кроком step, мм: закріплюється зміщення вздовж локальної осі dir
   *  (y — з площини, за замовчуванням; z — у площині); flange — раскріплює стиснутий пояс (для стійкості плоскої форми згину) */
  brace?: { step: number; dir?: "y" | "z"; flange?: boolean };
}

export interface AsmCase {
  id: string; label: string; cat: LoadCategory;
  gf?: number; psi0?: number; group?: string;
  /** власна вага стрижнів */
  selfWeight?: boolean;
  nodal?: { node: string; F: number[] }[];
  members?: MemberLoad[];
}

/** Панель збірки: вантажна площа (load) або пластина-оболонка (plate), що працює сама і разом зі стрижнями */
export type AsmPanel = Panel & {
  mass?: number;
  kind?: "load" | "plate";
  /** пластина: товщина, мм; сталь; кількість елементів по сторонах (авто, якщо не задано) */
  t?: number; steel?: string; mesh?: number;
};

export interface Assembly {
  code: CodeId;
  nodes: AsmNode[];
  members: AsmMember[];
  panels: AsmPanel[];
  panelLoads: PanelLoad[];
  cases: AsmCase[];
  gammaC?: number; gammaN?: number;
  /** сейсмічний вплив (спектральний метод) */
  seismic?: SeismicInput;
  /** розрахунок за деформованою схемою (2-й порядок) з початковим нахилом φ = 1/phiInv */
  secondOrder?: { on: boolean; phiInv?: number };
}

export interface MemberCheck { member: string; checks: (Check & { combo: string })[]; util: number; ok: boolean; section: string }
export interface ConnCheck { member: string; end: "i" | "j"; kind: ConnectorKind; checks: (Check & { combo: string })[]; util: number; ok: boolean }
export interface SupportCheck { node: string; result?: NodeResult; error?: string }
/** Пластина: сітка (для креслення), розрахунковий опір, перевірки */
export interface PlateCheck {
  panel: string; t: number; R: number;
  /** вузли сітки (nu+1)×(nv+1) і id елементів nu×nv */
  pts: Vec3[][]; elems: string[][]; ids: string[][];
  checks: (Check & { combo: string })[]; util: number; ok: boolean;
  /** максимальне σ_ef (МПа) і прогин пластини (SLS або ULS), мм */
  smax: number; wmax: number;
}

export interface SeisMode { T: number; meff: Vec3; Sa: Vec3 }
export interface DriftCheck { member: string; ratio: number; limit: number; util: number }
export interface AsmSeismic {
  modes: SeisMode[];
  /** сума ефективних мас за напрямками, частки */
  sum: Vec3;
  /** сумарна маса, т; поперечна сила в основі від сейсміки (комбінована), Н */
  Mtot: Vec3; Vbase: Vec3;
  /** форми для креслення: поле переміщень від сил ω²·M·φ (= φ, нормовано за масою) */
  shapes: FrameResult[];
  /** коефіцієнти сполучень / мас загружень */
  coef: Record<string, number>;
  drift: DriftCheck[];
  warnings: string[];
}

export interface AsmStability {
  /** α_cr за сполученнями ULS (статичні); Infinity — без стиску */
  alpha: { combo: string; alpha: number }[];
  min: number; minCombo: string;
  /** перша форма втрати стійкості для найменшого α_cr (переміщення нормовані до 1) */
  shape?: FrameResult;
  /** чи виконано розрахунок за деформованою схемою; прийнятий і нормований нахил φ */
  on: boolean; phi: number; phiDefault: number;
  /** ітерації за сполученнями, якщо on */
  iters?: number[];
  warnings: string[];
}

export interface AsmResult {
  combos: { name: string; text: string; kind: string; factors: Record<string, number> }[];
  /** результати за сполученнями (ULS і характеристичні SLS) */
  uls: FrameResult[];
  sls: FrameResult[];
  members: MemberCheck[];
  conns: ConnCheck[];
  supports: SupportCheck[];
  panels: PanelInfo[];
  plates: PlateCheck[];
  maxUtil: number; ok: boolean;
  /** максимальне переміщення (SLS), мм */
  maxDisp: { node: string; v: number };
  sections: Record<string, Section>;
  seismic?: AsmSeismic;
  stability?: AsmStability;
}

const SUPPORTS: Record<string, Partial<Record<Dof, boolean>>> = {
  fixed: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  base: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  pinned: { ux: true, uy: true, uz: true },
  roller: { uz: true },
};

export const GF_DEFAULT: Record<CodeId, Record<LoadCategory, number>> = { DBN: { G: 1.1, L: 1.2, Q: 1.4, A: 1 }, EN: { G: 1.35, L: 1.5, Q: 1.5, A: 1 } };

function sectionOf(m: AsmMember): Section {
  const s = findSection(m.family, m.size);
  if (!s) throw new Error(`section:${m.id}:${m.family} ${m.size}`);
  return s;
}

/** Точки раскріплення стрижня: x від вузла i, положення і глобальний ступінь, найближчий до локальної осі (skew — відхилення > 18°) */
export function bracePoints(a: Assembly, m: AsmMember): { x: number; P: Vec3; dof: "ux" | "uy" | "uz"; skew: boolean }[] {
  const b = m.brace;
  if (!b || !(b.step > 0)) return [];
  const ni = a.nodes.find((n) => n.id === m.i), nj = a.nodes.find((n) => n.id === m.j);
  if (!ni || !nj) return [];
  const A: Vec3 = [ni.x, ni.y, ni.z], B: Vec3 = [nj.x, nj.y, nj.z], L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  if (!(L > 0)) return [];
  const ax = memberAxes(A, B, m.beta)[b.dir === "z" ? 2 : 1];
  const q = [0, 1, 2].reduce((p, c) => (Math.abs(ax[c]) > Math.abs(ax[p]) ? c : p), 0);
  const out: { x: number; P: Vec3; dof: "ux" | "uy" | "uz"; skew: boolean }[] = [];
  for (let k = 1; k * b.step < L - Math.max(1, 0.05 * b.step) && out.length < 200; k++) {
    const t = (k * b.step) / L;
    out.push({ x: k * b.step, P: [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t], dof: (["ux", "uy", "uz"] as const)[q], skew: Math.abs(ax[q]) < 0.95 });
  }
  return out;
}

/** Модель МСЕ зі збірки */
export function toFrame(a: Assembly): { model: FrameModel; sections: Record<string, Section> } {
  const sections: Record<string, Section> = {};
  const nodes = a.nodes.map((n) => {
    const fx = { ...(n.support && n.support !== "none" ? SUPPORTS[n.support] : {}), ...(n.fix ?? {}) };
    return { id: n.id, x: n.x, y: n.y, z: n.z, fix: Object.keys(fx).length ? fx : undefined };
  });
  const members = a.members.map((m) => {
    const s = sectionOf(m), st = steel(m.steel);
    sections[m.id] = s;
    const rel = (e: EndConn) => (e.behaviour === "pin" ? { my: true, mz: true } : undefined);
    return { id: m.id, i: m.i, j: m.j, sec: { A: s.A, Iy: s.Iy, Iz: s.Iz, It: s.It }, E: st.E, G: st.G, rho: st.density ?? 7850, beta: m.beta, rel: { i: rel(m.endI), j: rel(m.endJ) } };
  });
  return { model: { nodes, members }, sections };
}

/** Сітка пластин: вузли (спільні з наявними за координатами), елементи оболонки, поділ стрижнів у вузлах сітки */
export function meshPlates(a: Assembly, model: FrameModel) {
  const plates = a.panels.filter((p) => p.kind === "plate");
  const key = (p: Vec3) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)},${Math.round(p[2] * 10)}`;
  const byKey = new Map(model.nodes.map((n) => [key([n.x, n.y, n.z]), n.id]));
  const nodes: FrameNode[] = [...model.nodes], shells: ShellElement[] = [];
  const created = new Set<string>();
  const info: { panel: string; t: number; steel: string; nu: number; nv: number; pts: Vec3[][]; elems: string[][]; ids: string[][] }[] = [];
  for (const p of plates) {
    const g = panelGeometry(model, p);
    const C = g.C, Q = C.length === 3 ? [C[0], C[1], C[2], C[2]] : C;
    const d = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const Lu = Math.max(d(Q[0], Q[1]), d(Q[3], Q[2])), Lv = Math.max(d(Q[0], Q[3]), d(Q[1], Q[2]));
    const h = Math.max(Math.max(Lu, Lv) / 12, 40);
    const cl = (v: number) => Math.max(2, Math.min(20, v));
    const nu = cl(p.mesh ?? Math.ceil(Lu / h)), nv = cl(p.mesh ?? Math.ceil(Lv / h));
    const pts: Vec3[][] = [], ids: string[][] = [];
    for (let i = 0; i <= nu; i++) {
      pts.push([]); ids.push([]);
      for (let j = 0; j <= nv; j++) {
        const X = g.X(i / nu, j / nv), k = key(X);
        let id = byKey.get(k);
        if (!id) { id = `${p.id}:${i}.${j}`; byKey.set(k, id); nodes.push({ id, x: X[0], y: X[1], z: X[2] }); created.add(id); }
        pts[i].push(X); ids[i].push(id);
      }
    }
    const st = steel(p.steel ?? (a.code === "DBN" ? "C245" : "S235"));
    const elems: string[][] = [];
    for (let i = 0; i < nu; i++) {
      elems.push([]);
      for (let j = 0; j < nv; j++) {
        const id = `${p.id}#${i}.${j}`;
        const ns = [ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]] as [string, string, string, string];
        elems[i].push(id);
        // вироджений (трикутний) край: два однакові вузли — елемент пропускаємо, якщо площа нульова
        if (new Set(ns).size < 3) continue;
        shells.push({ id, nodes: ns, t: p.t ?? 8, E: st.E, nu: 0.3, rho: st.density ?? 7850 });
      }
    }
    info.push({ panel: p.id, t: p.t ?? 8, steel: st.id, nu, nv, pts, elems, ids });
  }
  // точки раскріплення стрижнів (прогони, зв'язки): вузли з закріпленим ступенем
  for (const m of a.members) bracePoints(a, m).forEach((bp, k) => {
    const kk = key(bp.P);
    let id = byKey.get(kk);
    if (!id) { id = `${m.id}^${k + 1}`; byKey.set(kk, id); nodes.push({ id, x: bp.P[0], y: bp.P[1], z: bp.P[2] }); created.add(id); }
    const at = nodes.findIndex((n) => n.id === id);
    nodes[at] = { ...nodes[at], fix: { ...(nodes[at].fix ?? {}), [bp.dof]: true } };
  });
  // поділ стрижнів у вузлах сітки, що лежать на них
  const pos = new Map(nodes.map((n) => [n.id, [n.x, n.y, n.z] as Vec3]));
  const split = new Map<string, { id: string; x0: number; L: number }[]>();
  const members: FrameMember[] = [];
  for (const m of model.members) {
    const A = pos.get(m.i)!, B = pos.get(m.j)!, L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const u: Vec3 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L, (B[2] - A[2]) / L];
    const on: { id: string; t: number }[] = [];
    for (const id of created) {
      const P = pos.get(id)!, w: Vec3 = [P[0] - A[0], P[1] - A[1], P[2] - A[2]];
      const t = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
      if (t <= 0.5 || t >= L - 0.5) continue;
      const off = Math.hypot(w[0] - u[0] * t, w[1] - u[1] * t, w[2] - u[2] * t);
      if (off < 0.5) on.push({ id, t });
    }
    if (!on.length) { members.push(m); continue; }
    on.sort((p, q) => p.t - q.t);
    const chain = [{ id: m.i, t: 0 }, ...on, { id: m.j, t: L }];
    const parts: { id: string; x0: number; L: number }[] = [];
    for (let k = 0; k < chain.length - 1; k++) {
      const id = `${m.id}~${k}`;
      parts.push({ id, x0: chain[k].t, L: chain[k + 1].t - chain[k].t });
      members.push({ ...m, id, i: chain[k].id, j: chain[k + 1].id, rel: { i: k === 0 ? m.rel?.i : undefined, j: k === chain.length - 2 ? m.rel?.j : undefined } });
    }
    split.set(m.id, parts);
  }
  return { model: { nodes, members, shells } as FrameModel, split, info };
}

/** Навантаження на стрижень, поділений на частини */
const splitLoads = splitMemberLoads, mergeParts = mergeMemberParts;

const absMax = (v: number[]) => v.reduce((a, b) => Math.max(a, Math.abs(b)), 0);

/** Перевірка стрижня за огинаючою зусиль одного сполучення */
function memberChecks(code: CodeId, s: Section, st: string, mf: MemberForces, L: number, mu: { y: number; z: number }, gc: number, gn: number, brace?: AsmMember["brace"]): Check[] {
  const Nc = Math.max(0, -Math.min(...mf.N)), Nt = Math.max(0, Math.max(...mf.N));
  const My = absMax(mf.My), Mz = absMax(mf.Mz), Vz = absMax(mf.Vz), Vy = absMax(mf.Vy);
  const checks: Check[] = [];
  // раскріплення в прольоті скорочує розрахункову довжину відповідної осі до кроку
  const bs = brace && brace.step > 0 ? brace.step : Infinity;
  const Lcr = { y: brace?.dir === "z" ? Math.min(mu.y * L, bs) : mu.y * L, z: brace?.dir !== "z" ? Math.min(mu.z * L, bs) : mu.z * L };
  const Lltb = brace?.flange && brace.dir !== "z" ? Math.min(mu.z * L, bs) : mu.z * L;
  const mi = {
    code, section: s, steel: st, gammaC: gc, gammaN: gn, NEd: Nc, MEd: My, VEd: Vz,
    buckling: { Lcr_y: Lcr.y, Lcr_z: Lcr.z },
    ltb: My > 0 && s.ltbProne ? { restrained: false, Lcr: Lltb, C1: 1, C2: 0, loadAt: "center" as const,
      dbn: { cantilever: false, load: "uniform" as const, flange: "compressed" as const, restraints: 0 as const } } : undefined,
  };
  try { checks.push(...(code === "EN" ? checkMemberEN(mi) : checkMemberDBN(mi)).checks); } catch { /* перевірки, що не застосовні до форми перерізу */ }
  // міцність при розтягу/стиску зі згином відносно двох осей у кожному перерізі
  const g = steel(st), t = Math.max(s.dims.tf ?? 0, s.dims.t ?? 0, s.dims.tw ?? 0, 4);
  const R = code === "DBN" ? g.strength(t, "shaped") * gc : g.yieldChar(t, "shaped");
  let worst = { u: 0, k: 0 };
  mf.x.forEach((_, k) => {
    const sg = Math.abs(mf.N[k]) / s.A + Math.abs(mf.My[k]) / s.Wy + Math.abs(mf.Mz[k]) / s.Wz;
    if (sg * gn / R > worst.u) worst = { u: (sg * gn) / R, k };
  });
  const k = worst.k;
  checks.push(mkCheck("frameBiaxial", code === "DBN" ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.1); п. 9.1 (пружна стадія, в запас)" : "EN 1993-1-1, 6.2.1, (6.1)",
    `|N|/A + |M_y|/W_y + |M_z|/W_z ≤ ${code === "DBN" ? "R_y·γ_c" : "f_y/γ_M0"}`,
    `x = ${f(mf.x[k], 0)} mm: ${f(Math.abs(mf.N[k]) / 1000, 1)} kN, M_y = ${f(Math.abs(mf.My[k]) / 1e6, 2)}, M_z = ${f(Math.abs(mf.Mz[k]) / 1e6, 2)} kN·m; σ = ${f(worst.u * R / gn, 1)} / ${f(R, 0)} MPa`, worst.u));
  if (Nt > 0 && Nc === 0) checks.push(mkCheck("frameTension", code === "DBN" ? "ДБН В.2.6-198, п. 8.1.1, ф. (8.1)" : "EN 1993-1-1, 6.2.3", `N/A ≤ ${code === "DBN" ? "R_y·γ_c" : "f_y/γ_M0"}`,
    `${f(Nt / 1000, 1)} kN / ${f(s.A, 0)} mm² = ${f(Nt / s.A, 1)} / ${f(R, 0)} MPa`, (Nt * gn) / s.A / R));
  if (Vy > 0 && s.kind === "I") checks.push(mkCheck("frameShearY", code === "DBN" ? "ДБН В.2.6-198, ф. (9.2)" : "EN 1993-1-1, 6.2.6", "V_y / (A_f·R_s) ≤ 1",
    `V_y = ${f(Vy / 1000, 1)} kN; A_f = ${f(2 * s.b * (s.dims.tf ?? 1), 0)} mm²`, (Vy * gn) / (2 * s.b * (s.dims.tf ?? 1)) / (R / Math.sqrt(3))));
  return checks;
}

/** Зварювання по контуру профілю */
function profileWeld(s: Section): WeldSeg[] {
  if (s.kind === "CHS") return Array.from({ length: 36 }, (_, k) => {
    const a0 = (k / 36) * 2 * Math.PI, a1 = ((k + 1) / 36) * 2 * Math.PI, r = s.h / 2;
    return { y1: r * Math.cos(a0), z1: r * Math.sin(a0), y2: r * Math.cos(a1), z2: r * Math.sin(a1) };
  });
  if (s.kind === "RHS") return weldShape("rhs", { b: s.b, h: s.h });
  if (s.kind === "I") return weldShape("iProfile", { b: s.b, h: s.h, tf: s.dims.tf ?? 10, tw: s.dims.tw ?? 6 });
  // швелер, кутик — по контуру полиць (прямокутник габариту — наближено)
  return weldShape("rect", { b: s.b, h: s.h });
}

/** Перевірка кріплення кінця стрижня за зусиллями з боку вузла (локальні осі стрижня) */
function connChecks(code: CodeId, s: Section, st: string, e: EndConn, F: number[], gc: number, gn: number): Check[] {
  const [Nx, Vy, Vz, T, My, Mz] = F;
  const g = steel(st), t = Math.max(s.dims.tf ?? 0, s.dims.t ?? 0, 4);
  const pin = e.behaviour === "pin";
  if (e.kind === "weld") {
    const r = checkFillet({
      code, segs: profileWeld(s), kf: e.kf ?? 6, process: "manual", Run: g.ultimate(t, "shaped"), Ryn: g.yieldChar(t, "shaped"),
      tmin: Math.min(t, e.tp ?? t), tmax: Math.max(t, e.tp ?? t),
      N: -Nx, Vy, Vz, Mx: T, My: pin ? 0 : My, Mz: pin ? 0 : Mz, gammaC: gc, gammaN: gn,
    });
    return r.checks.filter((c) => c.key !== "weldLmin" || s.kind !== "CHS");
  }
  if (e.kind === "bolts" || e.kind === "rivets") {
    const rows = e.rows ?? 1, cols = e.cols ?? 2, n = rows * cols;
    const tp = Math.min(e.tp ?? 10, Math.max(s.dims.tw ?? s.dims.t ?? t, 1));
    if (e.plane === "end") {
      // торцева плита: зріз від V, розтяг від N і моментів (пружно, найдальший ряд)
      const py = e.py ?? 80, px = e.px ?? 80;
      const ys = Array.from({ length: rows }, (_, k) => (k - (rows - 1) / 2) * py), xs = Array.from({ length: cols }, (_, k) => (k - (cols - 1) / 2) * px);
      const Iy = cols * ys.reduce((a, y) => a + y * y, 0), Ix = rows * xs.reduce((a, x) => a + x * x, 0);
      const Ntmax = Math.max(0, -Nx) / n + (pin || !Iy ? 0 : (Math.abs(My) * Math.max(...ys)) / Iy) + (pin || !Ix ? 0 : (Math.abs(Mz) * Math.max(...xs)) / Ix);
      return checkBolts({ code, kind: e.kind === "rivets" ? "rivet" : "bearing", d: e.d ?? 16, boltClass: e.boltClass ?? (code === "DBN" ? "5.6" : "8.8"), shearPlanes: 1,
        tmin: e.tp ?? 10, Ryn: g.yieldChar(e.tp ?? 10, "sheet"), Run: g.ultimate(e.tp ?? 10, "sheet"), group: { rows, cols, px, py }, a: e.edge ?? 2 * (e.d ?? 16),
        Fx: Vy, Fy: Vz, M: T, T: Ntmax * n, gammaC: gc, gammaN: gn }).checks;
    }
    // у площині стінки: уздовж стрижня N, поперек V_z, момент M_y у площині групи (якщо стик жорсткий)
    return checkBolts({ code, kind: e.kind === "rivets" ? "rivet" : "bearing", d: e.d ?? 16, boltClass: e.boltClass ?? (code === "DBN" ? "5.6" : "8.8"), shearPlanes: e.planes ?? 1,
      tmin: tp, Ryn: g.yieldChar(tp, "sheet"), Run: g.ultimate(tp, "sheet"), group: { rows, cols, px: e.px ?? 3 * (e.d ?? 16), py: e.py ?? 3 * (e.d ?? 16) },
      a: e.edge ?? 2 * (e.d ?? 16), Fx: Nx, Fy: Vz, M: pin ? 0 : My, T: Math.abs(Vy), gammaC: gc, gammaN: gn }).checks;
  }
  if (e.kind === "screws") {
    const n = e.n ?? 4;
    return checkScrews({ d: e.d ?? 5.5, t: Math.min(e.tp ?? 1, 4), t1: e.t1 ?? Math.max(s.dims.t ?? s.dims.tw ?? 2, 1), fu: 360, fu1: g.ultimate(t, "shaped"),
      dw: 14, FvRk: e.FvRk ?? 4000, FtRk: e.FtRk, e1: 3 * (e.d ?? 5.5), n, V: Math.hypot(Nx, Vz), T: Math.abs(Vy) }).checks;
  }
  return [];
}

/** Довідка по пластинах (площа, нормаль) — у тому ж вигляді, що для вантажних панелей */
function plateInfo(a: Assembly, model: FrameModel, isPlate: Set<string>): PanelInfo[] {
  return a.panels.filter((p) => isPlate.has(p.id)).map((p) => {
    const r = panelLoads(model, [{ ...p, mode: "two" }], []).info[0];
    return { ...r, error: undefined };
  });
}

/** Коефіцієнт сполучення (і маси) загруження для сейсміки: ДБН табл. 6.1 (сталь), EN 1990 (6.12b) ψ2; вітер, температура — 0 */
export function seisCoefDefault(code: CodeId, c: AsmCase): number {
  const tag = `${c.id} ${c.label} ${c.group ?? ""}`.toLowerCase();
  if (/\bw\b|^w|wind|віт|вет|temp|темп/.test(tag)) return 0;
  if (c.cat === "A") return 0;
  if (code === "DBN") return c.cat === "G" ? 0.95 : c.cat === "L" ? 0.8 : 0.5;
  if (c.cat === "G") return 1;
  return /^s|snow|сн/.test(c.label.toLowerCase()) ? 0 : 0.3;
}

/** Квадратична форма відгуків за формами: √(Σ ρ_ij·v_i·v_j) для кожного числа поля (однакові станції) */
function quadField(rs: FrameResult[], rho: number[][]): FrameResult {
  const n = rs.length, f0 = rs[0];
  const q = (get: (r: FrameResult) => number[]): number[] => {
    const vs = rs.map(get);
    return vs[0].map((_, k) => { let s = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (rho[i][j]) s += rho[i][j] * vs[i][k] * vs[j][k]; return Math.sqrt(Math.max(0, s)); });
  };
  const out: FrameResult = { u: {}, reactions: {}, members: {} };
  for (const id of Object.keys(f0.u)) out.u[id] = q((r) => r.u[id]);
  for (const id of Object.keys(f0.reactions)) out.reactions[id] = q((r) => r.reactions[id]);
  if (f0.shells) {
    out.shells = {};
    for (const e of Object.keys(f0.shells)) {
      const g = (r: FrameResult) => r.shells![e];
      out.shells[e] = { c: q((r) => g(r).c), gp: [0, 1, 2, 3].map((k) => q((r) => g(r).gp[k])), corner: [0, 1, 2, 3].map((k) => q((r) => g(r).corner[k])), nodal: q((r) => g(r).nodal), svm: NaN };
    }
  }
  for (const m of Object.keys(f0.members)) {
    const mf0 = f0.members[m], g = (r: FrameResult) => r.members[m];
    const mf: MemberForces = { x: mf0.x, N: q((r) => g(r).N), Vy: q((r) => g(r).Vy), Vz: q((r) => g(r).Vz), T: q((r) => g(r).T), My: q((r) => g(r).My), Mz: q((r) => g(r).Mz),
      endI: q((r) => g(r).endI), endJ: q((r) => g(r).endJ), disp: [] };
    const d = [0, 1, 2].map((c) => q((r) => g(r).disp.map((v) => v[c])));
    mf.disp = mf0.x.map((_, k) => [d[0][k], d[1][k], d[2][k]] as Vec3);
    out.members[m] = mf;
  }
  return out;
}

export function analyzeAssembly(a: Assembly): AsmResult {
  const gc = a.gammaC ?? 1, gn = a.gammaN ?? 1;
  const { model: base, sections } = toFrame(a);
  // панелі: навантаження + власна вага з маси, кг/м²
  const pl: PanelLoad[] = [...a.panelLoads];
  const gCase = a.cases.find((c) => c.cat === "G");
  for (const p of a.panels) if (p.mass && gCase) pl.push({ panel: p.id, case: gCase.id, q: -p.mass * 9.81e-6, dir: "gz" });
  const isPlate = new Set(a.panels.filter((p) => p.kind === "plate").map((p) => p.id));
  const pan = panelLoads(base, a.panels.filter((p) => !isPlate.has(p.id)), pl.filter((l) => !isPlate.has(l.panel)));
  // пластини: сітка оболонки, тиск — на елементи в межах вибраної частини
  const { model, split, info: mesh } = meshPlates(a, base);
  const Lof = (id: string) => { const m = a.members.find((x) => x.id === id)!; const i = a.nodes.find((n) => n.id === m.i)!, j = a.nodes.find((n) => n.id === m.j)!; return Math.hypot(j.x - i.x, j.y - i.y, j.z - i.z); };
  const shellLoads = new Map<string, ShellLoad[]>();
  for (const l of pl) {
    const mi = mesh.find((x) => x.panel === l.panel);
    if (!mi) continue;
    const r = l.region ?? { u0: 0, u1: 1, v0: 0, v1: 1 };
    const list = shellLoads.get(l.case) ?? [];
    for (let i = 0; i < mi.nu; i++) for (let j = 0; j < mi.nv; j++) {
      const u = (i + 0.5) / mi.nu, v = (j + 0.5) / mi.nv;
      if (u < r.u0 || u > r.u1 || v < r.v0 || v > r.v1) continue;
      list.push({ shell: mi.elems[i][j], q: l.q, dir: l.dir, projected: l.projected });
    }
    shellLoads.set(l.case, list);
  }
  const lcs: LoadCase[] = a.cases.map((c) => ({ id: c.id, nodal: c.nodal, members: splitLoads([...(c.members ?? []), ...(pan.byCase.get(c.id) ?? [])], split, Lof),
    shellLoads: shellLoads.get(c.id), selfWeight: c.selfWeight ? 1 : 0 }));
  const res = solveFrame(model, lcs);
  for (const r of Object.values(res)) mergeParts(r, split);
  // сполучення
  const loads = a.cases.map((c) => ({ cat: c.cat, label: c.label, group: c.group, gf: c.gf ?? GF_DEFAULT[a.code][c.cat], psi0: c.psi0 }));
  const influence = a.cases.map((c) => {
    const r = res[c.id];
    return Object.values(r.members).reduce((s, m) => Math.max(s, absMax(m.My), absMax(m.Mz), absMax(m.N) * 100), 0);
  });
  const all = buildCombinations(loads, { code: a.code, gammaG: GF_DEFAULT[a.code].G, gammaQ: GF_DEFAULT[a.code].Q, influence });
  const combos: { name: string; text: string; kind: string; factors: Record<string, number> }[] = all.map((c, k) => ({ name: `${c.kind === "SLS" ? "s" : c.kind === "ACC" ? "A" : ""}${k + 1}`, text: c.text, kind: c.kind as string,
    factors: Object.fromEntries(a.cases.map((cs, q) => [cs.id, c.factors[q]])) }));
  const ulsC = combos.filter((c) => c.kind !== "SLS"), slsC = combos.filter((c) => c.kind === "SLS");
  const ulsStat = ulsC.map((c) => combineFrame(res, c.factors));
  const sls = slsC.map((c) => combineFrame(res, c.factors));
  // ---- стійкість системи (α_cr) і, за вибором, розрахунок за деформованою схемою
  const stab = stabilityPart(a, model, lcs, split, ulsC, ulsStat);
  // ---- сейсміка: власні форми → спектральні сили за формами → сполучення форм і напрямків → аварійне сполучення ± E
  const seis = a.seismic?.on ? seismicPart(a, model, lcs, split, res) : undefined;
  const seisC = seis ? seis.combos : [];
  combos.push(...seisC.map((c) => ({ name: c.name, text: c.text, kind: "SEIS", factors: c.factors })));
  ulsC.push(...seisC.map((c) => ({ name: c.name, text: c.text, kind: "SEIS", factors: c.factors })));
  // коефіцієнт m (ДБН В.1.1-12, табл. 6.13; ф. 6.12 — сейсмічна частка ділиться на m): сталь 1.3, шви 1.0, болти 1.1
  const byM = new Map<number, FrameResult[]>();
  const ulsBy = (mk: number) => {
    const m = a.code === "DBN" ? mk : 1;
    if (!byM.has(m)) byM.set(m, [...ulsStat, ...seisC.map((c) => combineFrame({ ...res, __E: seis!.E }, { ...c.factors, __E: c.sign / m }))]);
    return byM.get(m)!;
  };
  const uls = ulsBy(1);
  // перевірки стрижнів і стиків — огинаюча за сполученнями
  const env = (list: { combo: string; checks: Check[] }[]) => {
    const m = new Map<string, Check & { combo: string }>();
    for (const r of list) for (const ch of r.checks) {
      const id = ch.key + "|" + ch.clause, cur = m.get(id);
      if (!cur || ch.util > cur.util || Number.isNaN(ch.util)) m.set(id, { ...ch, combo: r.combo });
    }
    const checks = [...m.values()], u = checks.map((c) => c.util);
    return { checks, util: u.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...u), ok: checks.every((c) => c.ok) };
  };
  const P = new Map(a.nodes.map((n) => [n.id, n]));
  const members: MemberCheck[] = a.members.map((m) => {
    const s = sections[m.id], ni = P.get(m.i)!, nj = P.get(m.j)!;
    const L = Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z);
    const e = env(ulsBy(1.3).map((r, k) => ({ combo: ulsC[k].name, checks: memberChecks(a.code, s, m.steel, r.members[m.id], L, m.mu ?? { y: 1, z: 1 }, gc, gn, m.brace) })));
    return { member: m.id, section: s.name, ...e };
  });
  const conns: ConnCheck[] = [];
  for (const m of a.members) for (const [end, ec] of [["i", m.endI], ["j", m.endJ]] as ["i" | "j", EndConn][]) {
    if (ec.kind === "none") continue;
    const s = sections[m.id];
    const e = env(ulsBy(ec.kind === "weld" ? 1 : 1.1).map((r, k) => {
      const mf = r.members[m.id], F = end === "i" ? mf.endI : mf.endJ.map((v) => -v);
      return { combo: ulsC[k].name, checks: connChecks(a.code, s, m.steel, ec, F, gc, gn) };
    }));
    conns.push({ member: m.id, end, kind: ec.kind, ...e });
  }
  // опори «база»: реакції → зусилля на плиту (вертикальна колона, плита горизонтальна)
  const supports: SupportCheck[] = a.nodes.filter((n) => n.support === "base").map((n) => {
    const at = a.members.filter((m) => m.i === n.id || m.j === n.id);
    if (at.length !== 1 || !n.base) return { node: n.id, error: at.length !== 1 ? "baseOneMember" : "baseNoPlate" };
    const m = at[0], s = sections[m.id];
    const prof = s.kind === "CHS" ? { kind: "CHS" as const, h: s.h, b: s.h, tw: s.dims.t ?? 5, tf: s.dims.t ?? 5 }
      : s.kind === "RHS" ? { kind: "RHS" as const, h: s.h, b: s.b, tw: s.dims.t ?? 5, tf: s.dims.t ?? 5 }
      : { kind: "I" as const, h: s.h, b: s.b, tw: s.dims.tw ?? 6, tf: s.dims.tf ?? 10 };
    try {
      const result = checkBasePlate({
        ...n.base, code: a.code, kind: "base", profile: prof, profileSteel: m.steel,
        // реакції опори = зусилля, що колона передає на фундамент; профіль h — уздовж глобальної X
        combos: uls.map((r, k) => {
          const R = r.reactions[n.id] ?? [0, 0, 0, 0, 0, 0];
          return { name: ulsC[k].name, N: R[2], My: R[4], Mz: -R[3], Vz: R[0], Vy: R[1], T: R[5] };
        }),
        gammaC: gc, gammaN: gn,
      });
      return { node: n.id, result };
    } catch (e) { return { node: n.id, error: String((e as Error).message) }; }
  });
  // пластини: σ_ef на поверхнях у точках Гаусса ≤ 1.15·R_y·γ_c (ДБН) або f_y/γ_M0 (EN)
  const plates: PlateCheck[] = mesh.map((mi) => {
    const st = steel(mi.steel), t = mi.t;
    const R = a.code === "DBN" ? 1.15 * st.strength(t, "sheet") * gc : st.yieldChar(t, "sheet");
    let best = { s: 0, combo: "", el: "" };
    ulsBy(1.3).forEach((r, k) => {
      for (const row of mi.elems) for (const id of row) {
        const sf = r.shells?.[id];
        if (!sf) continue;
        const sv = Math.max(...sf.gp.map((g) => shellVonMises(g, t)));
        if (sv > best.s) best = { s: sv, combo: ulsC[k].name, el: id };
      }
    });
    const ids = new Set(mi.ids.flat());
    let wmax = 0;
    for (const r of sls.length ? sls : uls) for (const id of ids) { const u = r.u[id]; if (u) wmax = Math.max(wmax, Math.hypot(u[0], u[1], u[2])); }
    const util = (best.s * gn) / R;
    const ch = { ...mkCheck("plateVonMises", a.code === "DBN" ? "ДБН В.2.6-198, розд. 8 (плоский напружений стан, σ_ef ≤ 1.15·R_y·γ_c); пружна стадія" : "EN 1993-1-1, 6.2.1, (6.1)",
      `σ_ef = √(σx² − σxσy + σy² + 3τ²) ≤ ${a.code === "DBN" ? "1.15·R_y·γ_c" : "f_y/γ_M0"}`,
      `t = ${f(t, 1)} mm; σ = n/t ± 6m/t²; σ_ef = ${f(best.s, 1)} MPa / ${f(R, 0)} MPa (елемент ${best.el.split("#")[1] ?? "—"})`, util), combo: best.combo };
    return { panel: mi.panel, t, R, pts: mi.pts, elems: mi.elems, ids: mi.ids, checks: [ch], util, ok: ch.ok, smax: best.s, wmax };
  });
  let maxDisp = { node: "", v: 0 };
  for (const r of sls.length ? sls : uls) for (const [id, u] of Object.entries(r.u)) { const v = Math.hypot(u[0], u[1], u[2]); if (v > maxDisp.v) maxDisp = { node: id, v }; }
  const stabU = stab && Number.isFinite(stab.min) ? 1 / stab.min : 0;
  const utils = [...members.map((m) => m.util), ...conns.map((c) => c.util), ...supports.map((s) => s.result?.maxUtil ?? 0), ...plates.map((p) => p.util), ...(seis?.out.drift.map((d) => d.util) ?? []), stabU];
  return {
    combos, uls, sls, members, conns, supports, plates, panels: [...pan.info, ...plateInfo(a, base, isPlate)], sections, maxDisp, seismic: seis?.out, stability: stab,
    maxUtil: utils.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...utils),
    ok: stabU <= 1 && (seis?.out.drift.every((d) => d.util <= 1 + 1e-9) ?? true) && members.every((m) => m.ok) && conns.every((c) => c.ok) && plates.every((p) => p.ok) && supports.every((s) => !s.error && (s.result?.ok ?? true)),
  };
}

/** Сума загружень з коефіцієнтами — одне загруження (для нелінійного розрахунку сполучення) */
function combineCases(lcs: LoadCase[], factors: Record<string, number>, id: string): LoadCase {
  const out: LoadCase = { id, nodal: [], members: [], shellLoads: [], selfWeight: 0 };
  for (const lc of lcs) {
    const k = factors[lc.id];
    if (!k) continue;
    for (const n of lc.nodal ?? []) out.nodal!.push({ node: n.node, F: n.F.map((v) => v * k) });
    for (const m of lc.members ?? []) out.members!.push(m.kind === "point" ? { ...m, P: m.P * k } : { ...m, w1: m.w1 * k, w2: m.w2 === undefined ? undefined : m.w2 * k });
    for (const sl of lc.shellLoads ?? []) out.shellLoads!.push({ ...sl, q: sl.q * k });
    out.selfWeight! += (lc.selfWeight ?? 0) * k;
  }
  return out;
}

/** Початковий нахил (EN 1993-1-1, 5.3.2(3)): φ = φ0·α_h·α_m, φ0 = 1/200, α_h = 2/√h (2/3…1), α_m = √(0.5·(1 + 1/m)) */
export function swayImperfection(a: Assembly): number {
  const zs = a.nodes.map((n) => n.z), h = (Math.max(...zs) - Math.min(...zs)) / 1000;
  const ah = Math.min(1, Math.max(2 / 3, 2 / Math.sqrt(Math.max(h, 1e-3))));
  const sup = new Set(a.nodes.filter((n) => n.support && n.support !== "none").map((n) => n.id));
  const P = new Map(a.nodes.map((n) => [n.id, n]));
  const cols = a.members.filter((m) => {
    const i = P.get(m.i)!, j = P.get(m.j)!, L = Math.hypot(j.x - i.x, j.y - i.y, j.z - i.z);
    return Math.abs(j.z - i.z) >= 0.9 * L && (sup.has(m.i) || sup.has(m.j));
  }).length;
  const am = Math.sqrt(0.5 * (1 + 1 / Math.max(1, cols)));
  return (ah * am) / 200;
}

function stabilityPart(a: Assembly, model: FrameModel, lcs: LoadCase[], split: Map<string, { id: string; x0: number; L: number }[]>,
  ulsC: { name: string; kind: string; factors: Record<string, number> }[], ulsStat: FrameResult[]): AsmStability | undefined {
  const parent = new Map<string, string>();
  for (const [mid, parts] of split) for (const p of parts) parent.set(p.id, mid);
  const Nof = (r: FrameResult) => { const N = axialForces(r), M = new Map<string, number>(); for (const m of model.members) { const v = N.get(parent.get(m.id) ?? m.id); if (v !== undefined) M.set(m.id, v); } return M; };
  if (!ulsStat.length) return undefined;
  const Ns = ulsStat.map(Nof);
  if (!Ns.some((N) => [...N.values()].some((v) => v < -1))) return undefined;
  const modes = frameBuckling(model, Ns, 1);
  const alpha = ulsC.map((c, k) => ({ combo: c.name, alpha: modes[k][0]?.alpha ?? Infinity }));
  let kMin = 0;
  alpha.forEach((x, k) => { if (x.alpha < alpha[kMin].alpha) kMin = k; });
  const min = alpha[kMin].alpha;
  let shape: FrameResult | undefined;
  const md = modes[kMin][0];
  if (md) {
    shape = { u: Object.fromEntries(a.nodes.map((n) => [n.id, md.phi[n.id] ?? [0, 0, 0, 0, 0, 0]])), reactions: {}, members: {} };
    for (const [id, v] of Object.entries(md.members)) {
      const z = v.x.map(() => 0);
      shape.members[id] = { x: v.x, N: z, Vy: z, Vz: z, T: z, My: z, Mz: z, endI: [0, 0, 0, 0, 0, 0], endJ: [0, 0, 0, 0, 0, 0], disp: v.d };
    }
    mergeMemberParts(shape, split);
  }
  const phiDefault = swayImperfection(a);
  const on = !!a.secondOrder?.on, phi = a.secondOrder?.phiInv ? 1 / a.secondOrder.phiInv : phiDefault;
  const warnings: string[] = [];
  let iters: number[] | undefined;
  if (on) {
    iters = ulsC.map(() => 0);
    const cs = ulsC.map((c, k) => combineCases(lcs, c.factors, `so${k}`));
    // α_cr ≥ 10 — вплив деформацій малий (EN 1993-1-1, 5.2.1(3)): лише сили від нахилу, лінійно, одним розкладом
    const lin = ulsC.map((_, k) => k).filter((k) => alpha[k].alpha >= 10);
    if (lin.length) {
      const imp = imperfectionCases(model, lin.map((k) => cs[k]), phi, lin.map((k) => ulsStat[k])).cases;
      const r = solveFrame(model, imp);
      lin.forEach((k, q) => { const x = r[imp[q].id]; mergeMemberParts(x, split); ulsStat[k] = x; iters![k] = 1; });
    }
    for (let k = 0; k < ulsC.length; k++) {
      if (alpha[k].alpha >= 10) continue;
      try {
        const so = frameSecondOrder(model, cs[k], { phi });
        mergeMemberParts(so.res, split);
        ulsStat[k] = so.res;
        iters[k] = so.iters;
        if (!so.converged) warnings.push(`noconv:${ulsC[k].name}`);
      } catch (e) {
        if (String((e as Error).message) !== "instability") throw e;
        warnings.push(`unstable:${ulsC[k].name}`); iters[k] = -1;
      }
    }
  } else if (min < 10) warnings.push(min < 3 ? "needSecond3" : "needSecond10");
  return { alpha, min, minCombo: alpha[kMin].combo, shape, on, phi, phiDefault, iters, warnings };
}

function seismicPart(a: Assembly, model: FrameModel, lcs: LoadCase[], split: Map<string, { id: string; x0: number; L: number }[]>, res: Record<string, FrameResult>) {
  const S = a.seismic!, code = a.code, warnings: string[] = [];
  const coef: Record<string, number> = Object.fromEntries(a.cases.map((c) => [c.id, S.coef?.[c.id] ?? seisCoefDefault(code, c)]));
  // маси: ДБН — розрахункові значення з коефіцієнтами табл. 6.1 (6.1.1); EN — G + Σψ_E·Q (ψ_E = ψ2)
  const gfOf = (c: AsmCase) => (code === "DBN" ? c.gf ?? GF_DEFAULT[code][c.cat] : 1);
  const massCases = lcs.map((lc, k) => ({ lc, c: coef[a.cases[k].id] * gfOf(a.cases[k]) }));
  const dirs = ([0, 1, 2] as const).filter((d) => (d === 0 ? S.dirs.x : d === 1 ? S.dirs.y : S.dirs.z));
  let nm = Math.max(1, S.nModes ?? 12);
  let modal = frameModes(model, massCases, nm);
  const enough = (mr: typeof modal) => dirs.every((d) => !mr.Mtot[d] || mr.modes.reduce((s, m) => s + m.meff[d], 0) >= (d === 2 ? 0.75 : 0.85));
  while (!enough(modal) && modal.modes.length === nm && nm < 60) { nm = Math.min(60, nm * 2); modal = frameModes(model, massCases, nm); }
  const modes = modal.modes;
  const sum: Vec3 = [0, 1, 2].map((d) => modes.reduce((s, m) => s + m.meff[d], 0)) as Vec3;
  for (const d of dirs) if (modal.Mtot[d] && sum[d] < (d === 2 ? 0.75 : 0.85)) warnings.push(`modalMass:${"xyz"[d]}:${Math.round(sum[d] * 100)}`);
  if (!modes.length) warnings.push("noMass");
  const Sa = modes.map((m) => [0, 1, 2].map((d) => seisSa(code, S, m.T, d === 2)) as Vec3);
  // кореляція форм: ДБН — сусідні форми з різницею періодів < 10 % (6.7, табл. 6.9); EN — CQC
  const n = modes.length;
  const rho = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    if (i === j) return 1;
    if (code === "EN") return rhoCQC(modes[i].T, modes[j].T);
    return Math.abs(i - j) === 1 ? rhoDBN(Math.min(modes[i].T, modes[j].T) / Math.max(modes[i].T, modes[j].T)) : 0;
  }));
  // сили за формами: F_k = m_k·φ_k·Γ_i·Sa_i·g
  const cases: LoadCase[] = [];
  for (const d of dirs) modes.forEach((m, i) => {
    const nodal = Object.entries(modal.mass).map(([node, mk]) => {
      const ph = m.phi[node], k = mk * m.gamma[d] * Sa[i][d] * G_MM;
      return { node, F: [k * ph[0], k * ph[1], k * ph[2], 0, 0, 0] };
    });
    cases.push({ id: `E${d}_${i}`, nodal });
  });
  // форми для креслення: K·u = ω²·M·φ → u = φ
  modes.forEach((m, i) => cases.push({ id: `M_${i}`, nodal: Object.entries(modal.mass).map(([node, mk]) => ({ node, F: [0, 1, 2].map((c) => mk * m.omega ** 2 * m.phi[node][c]).concat([0, 0, 0]) })) }));
  let shapes: FrameResult[] = [];
  let E: FrameResult | undefined;
  const drift: DriftCheck[] = [];
  const Vbase: Vec3 = [0, 0, 0];
  if (modes.length) {
    const r = solveFrame(model, cases);
    for (const x of Object.values(r)) mergeParts(x, split);
    shapes = modes.map((_, i) => r[`M_${i}`]);
    const perDir = dirs.map((d) => quadField(modes.map((_, i) => r[`E${d}_${i}`]), rho));
    E = !perDir.length ? undefined : perDir.length === 1 ? perDir[0] : quadField(perDir, perDir.map((_, i) => perDir.map((_, j) => (i === j ? 1 : 0))));
    // поперечна сила в основі за кожним напрямком: V_i = Γ_i²·Sa_i·g
    for (const d of dirs) {
      const v = modes.map((m, i) => m.gamma[d] * m.gamma[d] * Sa[i][d] * G_MM);
      Vbase[d] = Math.sqrt(Math.max(0, v.reduce((s, vi, i) => s + v.reduce((t, vj, j) => t + rho[i][j] * vi * vj, 0), 0)));
    }
    // перекоси вертикальних стрижнів (колон): пружні переміщення — ДБН ÷ k1, EN × q
    const amp = code === "EN" ? S.q ?? 1.5 : 1 / (S.k1 ?? 0.25);
    const lim = driftLimit(code, S);
    const P = new Map(a.nodes.map((x) => [x.id, x]));
    for (const mb of a.members) {
      const ni = P.get(mb.i)!, nj = P.get(mb.j)!, dz = Math.abs(nj.z - ni.z), L = Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z);
      if (dz < 0.9 * L || dz < 1) continue;
      let worst = 0;
      for (const c of [0, 1]) {
        const per = dirs.filter((d) => d !== 2).map((d) => {
          const v = modes.map((_, i) => { const x = r[`E${d}_${i}`]; return ((x.u[mb.j]?.[c] ?? 0) - (x.u[mb.i]?.[c] ?? 0)) / dz; });
          return v.reduce((s, vi, i) => s + v.reduce((t, vj, j) => t + rho[i][j] * vi * vj, 0), 0);
        });
        worst = Math.max(worst, Math.sqrt(Math.max(0, per.reduce((s, x) => s + x, 0))));
      }
      const ratio = worst * amp;
      drift.push({ member: mb.id, ratio, limit: lim, util: ratio / lim });
    }
  }
  // аварійне сполучення: ДБН — γf·c·P (табл. 6.1), EN — G + ψ2·Q; ± E
  const fac: Record<string, number> = Object.fromEntries(a.cases.map((c) => [c.id, coef[c.id] * gfOf(c)]));
  const txt = a.cases.filter((c) => fac[c.id]).map((c) => `${Math.round(fac[c.id] * 1000) / 1000}·${c.label}`).join(" + ");
  const dl = dirs.map((d) => "XYZ"[d]).join(",");
  const combos = E ? [1, -1].map((sg) => ({ name: sg > 0 ? "E+" : "E−", text: `${txt} ${sg > 0 ? "+" : "−"} E(${dl})`, factors: fac, sign: sg })) : [];
  const out: AsmSeismic = { modes: modes.map((m, i) => ({ T: m.T, meff: m.meff, Sa: Sa[i] })), sum, Mtot: modal.Mtot, Vbase, shapes, coef, drift, warnings };
  return { out, E: E!, combos };
}
