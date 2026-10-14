// Болтовые, фрикционные и заклепочные соединения, саморезы.
// ДБН В.2.6-198, 16.2–16.3, табл. 7.4, Д.4, Д.5, Д.7, 16.4, 16.5; EN 1993-1-8 табл. 3.4; EN 1993-1-3 табл. 8.2.
// Единицы: Н, мм, МПа. Внешние силы — расчетные.

import type { CodeId } from "../codes/types";
import { Check, f, mkCheck } from "../codes/types";

/** Площадь нетто по резьбе As (ISO 898-1), мм² */
export const BOLT_AS: Record<number, number> = {
  10: 58, 12: 84.3, 14: 115, 16: 157, 18: 192, 20: 245, 22: 303, 24: 353, 27: 459, 30: 561, 36: 817, 42: 1120, 48: 1470,
};
export const BOLT_DIAMETERS = Object.keys(BOLT_AS).map(Number);

/** ДБН табл. Д.4: Rbun, Rbyn, Rbs, Rbt; EN: fub, fyb */
export const BOLT_CLASSES: Record<string, { Rbun: number; Rbyn: number; Rbs: number; Rbt: number }> = {
  "4.6": { Rbun: 400, Rbyn: 240, Rbs: 0.42 * 400, Rbt: 0.45 * 400 },
  "5.6": { Rbun: 500, Rbyn: 300, Rbs: 210, Rbt: 225 },
  "5.8": { Rbun: 500, Rbyn: 400, Rbs: 210, Rbt: NaN },
  "8.8": { Rbun: 800, Rbyn: 640, Rbs: 320, Rbt: 435 },
  "10.9": { Rbun: 1000, Rbyn: 900, Rbs: 400, Rbt: 540 },
  "12.9": { Rbun: 1200, Rbyn: 1080, Rbs: 420, Rbt: NaN },
};

/** ДБН табл. Д.5: Rbp по Run соединяемых элементов: [Run, класс А, классы В/С и высокопрочные] */
const RBP: [number, number, number][] = [
  [360, 560, 475], [370, 580, 485], [380, 590, 500], [390, 610, 515], [430, 670, 565], [440, 685, 580], [450, 700, 595],
  [460, 720, 605], [470, 735, 620], [480, 750, 630], [490, 765, 645], [510, 795, 670], [540, 845, 710], [570, 890, 750], [590, 920, 775],
];
export function rbpDBN(Run: number, accuracyA: boolean): number {
  const k = accuracyA ? 1 : 2;
  if (Run <= RBP[0][0]) return RBP[0][k];
  for (let i = 1; i < RBP.length; i++) {
    if (Run <= RBP[i][0]) {
      const [r0, r1] = [RBP[i - 1], RBP[i]];
      return r0[k] + ((r1[k] - r0[k]) * (Run - r0[0])) / (r1[0] - r0[0]);
    }
  }
  return RBP[RBP.length - 1][k];
}

/** ДБН табл. 16.4: γb при смятии (одноболтовое / многоболтовое), a — до края вдоль усилия, s — шаг вдоль усилия */
export function gammaBBearing(Ryn: number, a: number, s: number, d0: number, multi: boolean): number {
  const ad = a / d0, sd = s / d0;
  let ga: number, gs = 1;
  if (Ryn <= 290) {
    ga = ad >= 2 ? 1 : ad >= 1.5 ? 0.4 * ad + 0.2 : ad >= 1.35 ? ad - 0.7 : NaN;
    if (multi) gs = sd >= 2.5 ? 1 : sd >= 2 ? 0.4 * sd : NaN;
  } else if (Ryn <= 390) {
    ga = ad >= 2 ? 1 : ad >= 1.5 ? 0.5 * ad : ad >= 1.35 ? 0.67 * ad - 0.25 : NaN;
    if (multi) gs = sd >= 2.5 ? 1 : sd >= 2 ? 0.5 * sd - 0.25 : NaN;
  } else {
    ga = ad >= (multi ? 3 : 2.5) ? 1 : NaN;
    if (multi) gs = sd >= 3 ? 1 : NaN;
  }
  return Math.min(ga, gs);
}

export interface BoltGroup {
  rows: number; // вдоль y
  cols: number; // вдоль x
  px: number; // шаг вдоль x, мм
  py: number; // шаг вдоль y, мм
}

/** Усилие сдвига в каждом болте при Fx, Fy (Н) и моменте M (Н·мм) в плоскости — 16.2.11 (упругий расчет). */
export function boltForces(g: BoltGroup, Fx: number, Fy: number, M: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < g.cols; i++) for (let j = 0; j < g.rows; j++) {
    pts.push({ x: (i - (g.cols - 1) / 2) * g.px, y: (j - (g.rows - 1) / 2) * g.py });
  }
  const n = pts.length;
  const Ip = pts.reduce((a, p) => a + p.x * p.x + p.y * p.y, 0);
  const forces = pts.map((p) => {
    const vx = Fx / n - (Ip ? (M * p.y) / Ip : 0);
    const vy = Fy / n + (Ip ? (M * p.x) / Ip : 0);
    return { ...p, vx, vy, v: Math.hypot(vx, vy) };
  });
  const max = forces.reduce((a, b) => (b.v > a.v ? b : a), forces[0]);
  return { n, Ip, forces, max };
}

export interface BoltInput {
  code: CodeId;
  kind: "bearing" | "friction" | "rivet";
  d: number; // мм
  d0?: number; // отверстие, мм (по умолчанию d + 2, заклепки — d + 1)
  boltClass: string;
  /** ДБН: класс точности А (иначе В/С) */
  accuracyA?: boolean;
  shearPlanes: number;
  /** наименьшая суммарная толщина, сминаемая в одном направлении, мм */
  tmin: number;
  /** соединяемые элементы: Ryn/fy, Run/fu, МПа */
  Ryn: number;
  Run: number;
  group: BoltGroup;
  /** расстояние от центра крайнего отверстия до края вдоль усилия, мм */
  a: number;
  /** до края поперек усилия (EN k1), мм */
  e2?: number;
  Fx: number; Fy: number; M: number;
  /** суммарное растяжение соединения, Н (распределяется поровну) */
  T: number;
  gammaC?: number;
  gammaN?: number;
  // фрикционные
  mu?: number;
  gammaH?: number;
  /** EN: заклепка — fur, МПа */
  fur?: number;
  /** EN: γM2 */
  gammaM2?: number;
}

export interface ConnResult { checks: Check[]; values: { k: string; v: string }[]; maxUtil: number; ok: boolean }

const done = (checks: Check[], values: { k: string; v: string }[]): ConnResult => {
  const u = checks.map((c) => c.util);
  return { checks, values, maxUtil: u.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...u), ok: checks.every((c) => c.ok) };
};

export function checkBolts(i: BoltInput): ConnResult {
  const gn = i.gammaN ?? 1, gc = i.gammaC ?? 1;
  const g = boltForces(i.group, i.Fx * gn, i.Fy * gn, i.M * gn);
  const Nt = (Math.max(0, i.T) * gn) / g.n;
  const multi = g.n > 1;
  const along = Math.abs(i.Fx) >= Math.abs(i.Fy) ? "x" : "y";
  const s = along === "x" ? i.group.px : i.group.py;
  const lJoint = along === "x" ? (i.group.cols - 1) * i.group.px : (i.group.rows - 1) * i.group.py;
  const d0 = i.d0 ?? i.d + (i.kind === "rivet" ? 1 : 2);
  const As = BOLT_AS[i.d] ?? 0.78 * i.d * i.d;
  const Ab = (Math.PI * i.d * i.d) / 4;
  const Vmax = g.max.v;
  const values = [
    { k: "n", v: String(g.n) },
    { k: "N_b,max (зсув)", v: `${f(Vmax / 1000)} kN` },
    ...(Nt > 0 ? [{ k: "N_t (розтяг на болт)", v: `${f(Nt / 1000)} kN` }] : []),
    { k: "A_b / A_bn", v: `${f(Ab, 1)} / ${f(As, 1)} mm²` },
  ];
  const checks: Check[] = [];

  if (i.code === "DBN" && i.kind !== "rivet") {
    const CL = "ДБН В.2.6-198";
    // коэффициент длинного соединения (16.2.10)
    const beta = lJoint > 16 * i.d ? Math.max(0.75, 1 - 0.005 * (lJoint / i.d - 16)) : 1;
    if (i.kind === "friction") {
      const cls = i.boltClass;
      const Rbun = cls === "40X" ? (i.d <= 27 ? 1100 : i.d <= 30 ? 950 : 750) : i.d <= 27 ? 1000 : i.d <= 30 ? 860 : 680;
      const Rbh = 0.7 * Rbun; // (7.3)
      const mu = i.mu ?? 0.42, gh = i.gammaH ?? 1.12;
      const Qbh = (Rbh * As * mu) / gh; // (16.17)
      const gb0 = g.n < 5 ? 0.8 : g.n < 10 ? 0.9 : 1.0;
      const Pb = Rbh * As;
      const gb = gb0 * (Nt > 0 ? Math.max(0, 1 - Nt / Pb) : 1); // 16.3.6
      const cap = Qbh * i.shearPlanes * gb * gc;
      values.push({ k: "R_bh", v: `${f(Rbh, 0)} MPa` }, { k: "Q_bh", v: `${f(Qbh / 1000)} kN` }, { k: "P (натяг)", v: `${f(Pb / 1000)} kN` });
      checks.push(mkCheck("friction", `${CL}, п. 16.3.3–16.3.6, ф. (16.17), (16.18)`, "N_b,max·γ_n ≤ Q_bh·k·γ_b·γ_c",
        `Q_bh = ${f(Rbh, 0)}·${f(As, 1)}·${mu}/${gh} = ${f(Qbh / 1000)} kN; k = ${i.shearPlanes}; γ_b = ${f(gb, 3)}; ${f(Vmax / 1000)} / ${f(cap / 1000)} kN`,
        Vmax / beta / cap, beta < 1 ? ["longJoint"] : undefined));
      if (Nt > 0) checks.push(mkCheck("boltTension", `${CL}, п. 16.3.6`, "N_t ≤ P_b", `${f(Nt / 1000)} / ${f(Pb / 1000)} kN`, Nt / Pb));
      return done(checks, values);
    }
    const B = BOLT_CLASSES[i.boltClass];
    const gbS = 1 * (multi && !i.accuracyA ? 0.9 : 1);
    const gbP = gammaBBearing(i.Ryn, i.a, s, d0, multi) * (multi && !i.accuracyA ? 0.9 : 1);
    const Nbs = B.Rbs * Ab * i.shearPlanes * gbS * gc; // (16.12)
    const Rbp = rbpDBN(i.Run, !!i.accuracyA);
    const Nbp = Rbp * i.d * i.tmin * gbP * gc; // (16.13)
    values.push({ k: "R_bs / R_bp", v: `${f(B.Rbs, 0)} / ${f(Rbp, 0)} MPa` }, { k: "γ_b (зріз / зминання)", v: `${f(gbS, 3)} / ${f(gbP, 3)}` });
    if (Vmax > 0) {
      const notes = beta < 1 ? ["longJoint"] : undefined;
      checks.push(mkCheck("boltShear", `${CL}, п. 16.2.9, ф. (16.12)`, "N_b·γ_n / (R_bs·A_b·n_s·γ_b·γ_c) ≤ 1",
        `${f(Vmax / 1000)} / (${f(B.Rbs, 0)}·${f(Ab, 1)}·${i.shearPlanes}·${f(gbS, 2)}·${gc}) = ${f(Vmax / 1000)} / ${f(Nbs / 1000)} kN`, Vmax / beta / Nbs, notes));
      checks.push(mkCheck("boltBearing", `${CL}, п. 16.2.9, ф. (16.13); табл. 16.4`, "N_b·γ_n / (R_bp·d_b·Σt_min·γ_b·γ_c) ≤ 1",
        `a/d = ${f(i.a / d0, 2)}; s/d = ${f(s / d0, 2)}; ${f(Vmax / 1000)} / (${f(Rbp, 0)}·${i.d}·${i.tmin}·${f(gbP, 3)}·${gc}) = ${f(Vmax / 1000)} / ${f(Nbp / 1000)} kN`,
        Vmax / beta / Nbp, Number.isNaN(gbP) ? ["edgeTooSmall"] : notes));
    }
    if (Nt > 0) {
      const Nbt = B.Rbt * As * gc; // (16.14)
      checks.push(mkCheck("boltTension", `${CL}, п. 16.2.9, ф. (16.14)`, "N_t·γ_n / (R_bt·A_bn·γ_c) ≤ 1",
        `${f(Nt / 1000)} / (${f(B.Rbt, 0)}·${f(As, 1)}·${gc}) = ${f(Nt / 1000)} / ${f(Nbt / 1000)} kN`, Nt / Nbt, Number.isNaN(B.Rbt) ? ["classNoTension"] : undefined));
      if (Vmax > 0) {
        const NbsA = B.Rbs * Ab * i.shearPlanes * gbS * gc, NbtA = B.Rbt * Ab * gc; // 16.2.13: A_bn → A_b
        const u = Math.sqrt((Vmax / NbsA) ** 2 + (Nt / NbtA) ** 2);
        checks.push(mkCheck("boltShearTension", `${CL}, п. 16.2.13, ф. (16.16)`, "√((N_s/N_bs)² + (N_t/N_bt)²) ≤ 1",
          `√(${f(Vmax / NbsA, 3)}² + ${f(Nt / NbtA, 3)}²)`, u));
      }
    }
    return done(checks, values);
  }

  // EN 1993-1-8, табл. 3.4 (болты и заклепки)
  const CL = "EN 1993-1-8";
  const gM2 = i.gammaM2 ?? 1.25;
  const e1 = i.a, p1 = s;
  const e2 = i.e2 ?? i.a;
  const p2 = along === "x" ? i.group.py : i.group.px;
  if (i.kind === "rivet") {
    const fur = i.fur ?? 400;
    const A0 = (Math.PI * d0 * d0) / 4;
    const FvRd = (0.6 * fur * A0 * i.shearPlanes) / gM2;
    const ab = Math.min(e1 / (3 * d0), p1 / (3 * d0) - 0.25, fur / i.Run, 1);
    const k1 = Math.min(2.8 * e2 / d0 - 1.7, 1.4 * p2 / d0 - 1.7, 2.5);
    const FbRd = (k1 * ab * i.Run * d0 * i.tmin) / gM2;
    values.push({ k: "F_v,Rd / F_b,Rd", v: `${f(FvRd / 1000)} / ${f(FbRd / 1000)} kN` });
    if (Vmax > 0) {
      checks.push(mkCheck("rivetShear", `${CL}, табл. 3.4`, "F_v,Ed / (0.6·f_ur·A_0·n/γ_M2) ≤ 1", `${f(Vmax / 1000)} / ${f(FvRd / 1000)} kN`, Vmax / FvRd));
      checks.push(mkCheck("boltBearing", `${CL}, табл. 3.4`, "F_v,Ed / (k_1·α_b·f_u·d_0·t/γ_M2) ≤ 1",
        `k1 = ${f(k1, 2)}; α_b = ${f(ab, 3)}; ${f(Vmax / 1000)} / ${f(FbRd / 1000)} kN`, Vmax / FbRd));
    }
    if (Nt > 0) {
      const FtRd = (0.6 * fur * A0) / gM2;
      checks.push(mkCheck("rivetTension", `${CL}, табл. 3.4`, "F_t,Ed / (0.6·f_ur·A_0/γ_M2) ≤ 1", `${f(Nt / 1000)} / ${f(FtRd / 1000)} kN`, Nt / FtRd, ["rivetTensionAvoid"]));
    }
    return done(checks, values);
  }
  const B = BOLT_CLASSES[i.boltClass];
  const fub = B.Rbun;
  if (i.kind === "friction") {
    const mu = i.mu ?? 0.4, ks = 1, gM3 = 1.25;
    const FpC = 0.7 * fub * As;
    const FsRd = (ks * i.shearPlanes * mu * (FpC - 0.8 * Nt)) / gM3; // (3.6), (3.8a)
    values.push({ k: "F_p,C", v: `${f(FpC / 1000)} kN` }, { k: "F_s,Rd", v: `${f(FsRd / 1000)} kN` });
    checks.push(mkCheck("friction", `${CL}, 3.9, (3.6)–(3.8)`, "F_v,Ed / (k_s·n·μ·(F_p,C − 0.8·F_t,Ed)/γ_M3) ≤ 1",
      `μ = ${mu}; ${f(Vmax / 1000)} / ${f(FsRd / 1000)} kN`, Vmax / FsRd));
    return done(checks, values);
  }
  const av = ["4.6", "5.6", "8.8"].includes(i.boltClass) ? 0.6 : 0.5;
  const FvRd = (av * fub * As * i.shearPlanes) / gM2; // резьба в плоскости среза — в запас
  const ab = Math.min(e1 / (3 * d0), multi ? p1 / (3 * d0) - 0.25 : Infinity, fub / i.Run, 1);
  const k1 = Math.min(2.8 * e2 / d0 - 1.7, multi && i.group.rows > 1 ? 1.4 * p2 / d0 - 1.7 : Infinity, 2.5);
  const FbRd = (k1 * ab * i.Run * i.d * i.tmin) / gM2;
  const FtRd = (0.9 * fub * As) / gM2;
  values.push({ k: "F_v,Rd / F_b,Rd / F_t,Rd", v: `${f(FvRd / 1000)} / ${f(FbRd / 1000)} / ${f(FtRd / 1000)} kN` });
  const betaLf = lJoint > 15 * i.d ? Math.min(1, Math.max(0.75, 1 - (lJoint - 15 * i.d) / (200 * i.d))) : 1;
  if (Vmax > 0) {
    checks.push(mkCheck("boltShear", `${CL}, табл. 3.4`, "F_v,Ed / (α_v·f_ub·A_s·n/γ_M2) ≤ 1",
      `α_v = ${av}; ${f(Vmax / 1000)} / ${f(FvRd / 1000)} kN`, Vmax / (betaLf * FvRd), betaLf < 1 ? ["longJoint"] : undefined));
    checks.push(mkCheck("boltBearing", `${CL}, табл. 3.4`, "F_v,Ed / (k_1·α_b·f_u·d·t/γ_M2) ≤ 1",
      `k1 = ${f(k1, 2)}; α_b = ${f(ab, 3)}; ${f(Vmax / 1000)} / ${f(FbRd / 1000)} kN`, Vmax / FbRd));
  }
  if (Nt > 0) {
    checks.push(mkCheck("boltTension", `${CL}, табл. 3.4`, "F_t,Ed / (0.9·f_ub·A_s/γ_M2) ≤ 1", `${f(Nt / 1000)} / ${f(FtRd / 1000)} kN`, Nt / FtRd));
    if (Vmax > 0) checks.push(mkCheck("boltShearTension", `${CL}, табл. 3.4`, "F_v,Ed/F_v,Rd + F_t,Ed/(1.4·F_t,Rd) ≤ 1",
      `${f(Vmax / FvRd, 3)} + ${f(Nt / (1.4 * FtRd), 3)}`, Vmax / FvRd + Nt / (1.4 * FtRd)));
  }
  return done(checks, values);
}

export interface ScrewInput {
  d: number; // номинальный диаметр, мм
  t: number; // толщина листа под головкой, мм
  t1: number; // толщина опорного элемента, мм
  fu: number; // лист, МПа
  fu1: number; // опорный элемент, МПа
  dw: number; // диаметр шайбы/головки, мм
  FvRk: number; // несущая способность самореза на срез по данным изготовителя, Н
  FtRk?: number; // на растяжение по данным изготовителя, Н
  e1: number; // до края вдоль усилия, мм
  n: number;
  V: number; // суммарный сдвиг, Н
  T: number; // суммарный отрыв, Н
  gammaM2?: number;
}

/** Самонарезающие винты (саморезы): EN 1993-1-3, табл. 8.2. */
export function checkScrews(i: ScrewInput): ConnResult {
  const CL = "EN 1993-1-3, табл. 8.2";
  const gM2 = i.gammaM2 ?? 1.25;
  const r = i.t1 / i.t;
  const a1 = Math.min(3.2 * Math.sqrt(i.t / i.d), 2.1);
  const a2 = 2.1;
  const alpha = r <= 1 ? a1 : r >= 2.5 ? a2 : a1 + ((a2 - a1) * (r - 1)) / 1.5;
  const FbRd = (alpha * i.fu * i.d * i.t) / gM2; // условие e1 ≥ 3d — примечание screwEdge
  const FvRd = (i.FvRk) / gM2;
  const FpRd = (i.dw * i.t * i.fu) / gM2;
  const FoRd = (i.t1 < 1.25 * i.t ? 0.45 : 0.65) * i.d * i.t1 * i.fu1 / gM2;
  const FtRd = i.FtRk ? i.FtRk / gM2 : Infinity;
  const V = i.V / i.n, T = i.T / i.n;
  const checks: Check[] = [];
  const values = [{ k: "α", v: f(alpha, 3) }, { k: "F_b,Rd", v: `${f(FbRd / 1000, 3)} kN` }, { k: "F_p,Rd / F_o,Rd", v: `${f(FpRd / 1000, 3)} / ${f(FoRd / 1000, 3)} kN` }];
  if (V > 0) {
    checks.push(mkCheck("screwBearing", CL, "F_v,Ed ≤ F_b,Rd = α·f_u·d·t/γ_M2", `α = ${f(alpha, 3)}; ${f(V / 1000, 3)} / ${f(FbRd / 1000, 3)} kN`, V / FbRd, i.e1 < 3 * i.d ? ["screwEdge"] : undefined));
    checks.push(mkCheck("screwShear", CL, "F_v,Ed ≤ F_v,Rk/γ_M2 (по даним виробника)", `${f(V / 1000, 3)} / ${f(FvRd / 1000, 3)} kN`, V / FvRd, ["screwManufacturer"]));
  }
  if (T > 0) {
    checks.push(mkCheck("screwPullThrough", CL, "F_t,Ed ≤ F_p,Rd = d_w·t·f_u/γ_M2", `${f(T / 1000, 3)} / ${f(FpRd / 1000, 3)} kN`, T / FpRd));
    checks.push(mkCheck("screwPullOut", CL, "F_t,Ed ≤ F_o,Rd = 0.45(0.65)·d·t_sup·f_u,sup/γ_M2", `${f(T / 1000, 3)} / ${f(FoRd / 1000, 3)} kN`, T / FoRd));
    if (Number.isFinite(FtRd)) checks.push(mkCheck("screwTension", CL, "F_t,Ed ≤ F_t,Rk/γ_M2", `${f(T / 1000, 3)} / ${f(FtRd / 1000, 3)} kN`, T / FtRd));
    if (V > 0) {
      const u = T / Math.min(FpRd, FoRd) + V / Math.min(FbRd, FvRd);
      checks.push(mkCheck("screwInteraction", "EN 1993-1-3, (8.2)", "F_t/min(F_p,F_o) + F_v/min(F_b,F_n) ≤ 1", `${f(u, 3)}`, u));
    }
  }
  return done(checks, values);
}
