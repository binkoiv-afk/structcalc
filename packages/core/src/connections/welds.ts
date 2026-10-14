// Зварні з'єднання.
// ДБН В.2.6-198, 16.1.5, 16.1.14–16.1.19, табл. 7.3, 16.1, 16.2, Д.2; EN 1993-1-8, 4.5.3.3 (спрощений метод), 4.7.
// Одиниці: Н, мм, МПа.

import type { CodeId } from "../codes/types";
import { Check, f, mkCheck } from "../codes/types";
import type { ConnResult } from "./bolts";

/** ДБН табл. Д.2: Rwf металу кутового шва за класом міцності основного металу */
export const WELD_METAL_DBN: { maxClass: number; Rwun: number; Rwf: number }[] = [
  { maxClass: 315, Rwun: 410, Rwf: 180 },
  { maxClass: 355, Rwun: 450, Rwf: 200 },
  { maxClass: 390, Rwun: 490, Rwf: 215 },
  { maxClass: 440, Rwun: 590, Rwf: 240 },
  { maxClass: Infinity, Rwun: 685, Rwf: 280 },
];
export function weldMetalDBN(steelClass: number) {
  return WELD_METAL_DBN.find((r) => steelClass <= r.maxClass)!;
}

export type WeldProcess = "manual" | "semi" | "autoBoat" | "autoFlat";
export const WELD_PROCESSES: WeldProcess[] = ["manual", "semi", "autoBoat", "autoFlat"];

/** ДБН табл. 16.2: βf, βz за видом зварювання та катетом */
export function weldBeta(p: WeldProcess, kf: number): { bf: number; bz: number } {
  switch (p) {
    case "autoBoat": // автоматичне, df = 3–5, в човник
      return kf <= 16 ? { bf: 1.1, bz: 1.15 } : { bf: 0.7, bz: 1.0 };
    case "autoFlat": // автоматичне, df = 3–5, нижнє
      return kf <= 8 ? { bf: 1.1, bz: 1.15 } : kf <= 16 ? { bf: 0.9, bz: 1.05 } : { bf: 0.7, bz: 1.0 };
    case "semi": // автоматичне та механізоване, df = 1.4–2
      return kf <= 8 ? { bf: 0.9, bz: 1.05 } : kf <= 16 ? { bf: 0.8, bz: 1.0 } : { bf: 0.7, bz: 1.0 };
    default: // ручне, механізоване df < 1.4 або порошковим дротом
      return { bf: 0.7, bz: 1.0 };
  }
}

/** ДБН табл. 16.1: мінімальний катет (таврове двостороннє, напусткове, кутове; ручне та механізоване у суміші газів) */
export function kfMinDBN(tmax: number, Ryn: number): number {
  const T = [5, 10, 16, 22, 32, 40, 80];
  const row = Ryn <= 390 ? [4, 5, 6, 7, 8, 9, 10] : [5, 6, 7, 8, 9, 10, 12];
  const i = T.findIndex((t) => tmax <= t);
  return row[i < 0 ? row.length - 1 : i];
}

/** EN 1993-1-8 табл. 4.1: βw */
export function betaW(fu: number): number {
  return fu <= 360 ? 0.8 : fu <= 430 ? 0.85 : fu <= 510 ? 0.9 : 1.0;
}

/** відрізок шва у площині з'єднання (y, z), мм; trim — віднімати 2kf (обриви на кінцях) */
export interface WeldSeg { y1: number; z1: number; y2: number; z2: number; trim?: boolean; flank?: boolean }

/** Геометричні характеристики групи швів на одиницю товщини (катет/висота = 1) */
export function weldGroupProps(segsIn: WeldSeg[], trim: number) {
  const segs = segsIn.map((s) => {
    const L = Math.hypot(s.y2 - s.y1, s.z2 - s.z1);
    if (!s.trim || L === 0) return { ...s, L };
    const k = Math.min(trim, L / 2) / L;
    const dy = s.y2 - s.y1, dz = s.z2 - s.z1;
    return { ...s, y1: s.y1 + dy * k, z1: s.z1 + dz * k, y2: s.y2 - dy * k, z2: s.z2 - dz * k, L: L * (1 - 2 * k) };
  });
  const A = segs.reduce((a, s) => a + s.L, 0);
  const yc = segs.reduce((a, s) => a + s.L * (s.y1 + s.y2) / 2, 0) / A;
  const zc = segs.reduce((a, s) => a + s.L * (s.z1 + s.z2) / 2, 0) / A;
  let Iz = 0, Iy = 0;
  for (const s of segs) {
    const a1 = s.y1 - yc, a2 = s.y2 - yc, b1 = s.z1 - zc, b2 = s.z2 - zc;
    Iz += (s.L * (a1 * a1 + a1 * a2 + a2 * a2)) / 3; // ∫y² ds
    Iy += (s.L * (b1 * b1 + b1 * b2 + b2 * b2)) / 3; // ∫z² ds
  }
  const pts = segs.flatMap((s) => [{ y: s.y1 - yc, z: s.z1 - zc }, { y: s.y2 - yc, z: s.z2 - zc }]);
  return { segs, A, yc, zc, Iy, Iz, Ip: Iy + Iz, pts };
}

export interface FilletInput {
  code: CodeId;
  segs: WeldSeg[];
  kf: number; // катет, мм (EN: a = 0.7·kf, якщо не задано a)
  a?: number; // EN: розрахункова висота, мм
  process: WeldProcess;
  /** ДБН: Rwf, Rwun (метал шва) */
  Rwf?: number;
  /** основний метал: Run/fu, Ryn/fy, МПа */
  Run: number;
  Ryn: number;
  tmin: number;
  tmax: number;
  /** зусилля: N — перпендикулярно площині швів (+ розтяг), Vy, Vz — у площині; Mx — момент у площині швів (кручення групи);
   *  My, Mz — згин з площини (навколо осей y, z). Н, Н·мм */
  N: number; Vy: number; Vz: number; Mx: number; My: number; Mz: number;
  gammaC?: number;
  gammaN?: number;
  gammaM2?: number;
}

/** Найнесприятливіша точка групи: результуюче напруження на одиницю товщини шва, Н/мм */
function worstPoint(p: ReturnType<typeof weldGroupProps>, i: FilletInput, gn: number) {
  let best = { y: 0, z: 0, s: 0, n: 0, ty: 0, tz: 0 };
  for (const q of p.pts) {
    const n = (i.N / p.A + (p.Iy ? (i.My * q.z) / p.Iy : 0) - (p.Iz ? (i.Mz * q.y) / p.Iz : 0)) * gn;
    const ty = (i.Vy / p.A - (p.Ip ? (i.Mx * q.z) / p.Ip : 0)) * gn;
    const tz = (i.Vz / p.A + (p.Ip ? (i.Mx * q.y) / p.Ip : 0)) * gn;
    const s = Math.hypot(n, ty, tz);
    if (s > best.s) best = { y: q.y, z: q.z, s, n, ty, tz };
  }
  return best;
}

export function checkFillet(i: FilletInput): ConnResult {
  const gn = i.gammaN ?? 1, gc = i.gammaC ?? 1;
  const checks: Check[] = [];
  if (i.code === "DBN") {
    const CL = "ДБН В.2.6-198";
    const { bf, bz } = weldBeta(i.process, i.kf);
    const Rwf = i.Rwf ?? weldMetalDBN(i.Ryn).Rwf;
    const Rwz = 0.45 * i.Run;
    const p = weldGroupProps(i.segs, i.kf); // lw = l − 2kf на кожну ділянку з обривами
    const w = worstPoint(p, i, gn);
    const tf = w.s / (bf * i.kf), tz = w.s / (bz * i.kf);
    const values = [
      { k: "β_f / β_z", v: `${bf} / ${bz}` },
      { k: "R_wf / R_wz", v: `${f(Rwf, 0)} / ${f(Rwz, 0)} MPa` },
      { k: "Σl_w", v: `${f(p.A, 0)} mm` },
      { k: "I_y / I_z (t=1)", v: `${f(p.Iy / 1e4, 1)} / ${f(p.Iz / 1e4, 1)} cm⁴/cm` },
      { k: "τ_N+M / τ_Q+M (t=1)", v: `${f(Math.abs(w.n), 1)} / ${f(Math.hypot(w.ty, w.tz), 1)} N/mm` },
    ];
    const subst = (b: number, R: number, t: number) =>
      `τ = √((τ_N+τ_M⊥)² + (τ_Q+τ_M∥)²)/(β·k_f) = ${f(w.s, 1)}/(${b}·${i.kf}) = ${f(t, 1)} MPa; ${f(t, 1)} / (${f(R, 0)}·${gc})`;
    checks.push(mkCheck("weldMetal", `${CL}, п. 16.1.16–16.1.19, ф. (16.2), (16.4), (16.6), (16.8), (16.9); табл. 16.2, Д.2`,
      "τ_f·γ_n / (R_wf·γ_c) ≤ 1", subst(bf, Rwf, tf), tf / (Rwf * gc)));
    checks.push(mkCheck("weldFusion", `${CL}, п. 16.1.16–16.1.19, ф. (16.3), (16.5), (16.7), (16.8)`,
      "τ_z·γ_n / (R_wz·γ_c) ≤ 1", subst(bz, Rwz, tz), tz / (Rwz * gc)));
    // конструктивні вимоги 16.1.5
    const kmin = kfMinDBN(i.tmax, i.Ryn);
    checks.push(mkCheck("weldKfMin", `${CL}, п. 16.1.5 а), табл. 16.1`, "k_f ≥ k_f,min (≥ 4 мм за розрахунком)", `${i.kf} ≥ ${kmin} mm`,
      i.kf >= kmin ? kmin / i.kf : 4 / i.kf, i.kf < kmin ? ["kfBelowTable"] : undefined));
    checks.push(mkCheck("weldKfMax", `${CL}, п. 16.1.5 б)`, "k_f ≤ 1.2·t_min", `${i.kf} ≤ 1.2·${i.tmin} = ${f(1.2 * i.tmin, 1)} mm`, i.kf / (1.2 * i.tmin)));
    const minL = Math.min(...p.segs.filter((s) => s.L > 0).map((s) => s.L));
    const lreq = Math.max(4 * i.kf, 50);
    checks.push(mkCheck("weldLmin", `${CL}, п. 16.1.5 в)`, "l_w ≥ max(4k_f; 50 мм)", `${f(minL, 0)} ≥ ${f(lreq, 0)} mm`, lreq / minL));
    const flank = p.segs.filter((s) => s.flank);
    if (flank.length) {
      const Lf = Math.max(...flank.map((s) => s.L));
      const lmax = 85 * bf * i.kf;
      checks.push(mkCheck("weldLflank", `${CL}, п. 16.1.5 д)`, "l_w,фл ≤ 85·β_f·k_f", `${f(Lf, 0)} ≤ ${f(lmax, 0)} mm`, Lf / lmax));
    }
    return finish(checks, values);
  }
  // EN 1993-1-8, 4.5.3.3 — спрощений метод
  const CL = "EN 1993-1-8";
  const a = i.a ?? 0.7 * i.kf;
  const gM2 = i.gammaM2 ?? 1.25;
  const bw = betaW(i.Run);
  const fvwd = i.Run / Math.sqrt(3) / (bw * gM2);
  const p = weldGroupProps(i.segs, a); // 4.5.1(4): l_eff = l − 2a
  const w = worstPoint(p, i, 1);
  const FwEd = w.s, FwRd = fvwd * a;
  const values = [
    { k: "a", v: `${f(a, 1)} mm` },
    { k: "β_w", v: String(bw) },
    { k: "f_vw,d", v: `${f(fvwd, 1)} MPa` },
    { k: "Σl_eff", v: `${f(p.A, 0)} mm` },
  ];
  checks.push(mkCheck("weldEN", `${CL}, 4.5.3.3, (4.3)–(4.4)`, "F_w,Ed / (f_vw,d·a) ≤ 1, f_vw,d = f_u/(√3·β_w·γ_M2)",
    `F_w,Ed = ${f(FwEd, 1)} N/mm; F_w,Rd = ${f(fvwd, 1)}·${f(a, 1)} = ${f(FwRd, 1)} N/mm`, FwEd / FwRd));
  checks.push(mkCheck("weldAmin", `${CL}, 4.5.2(2)`, "a ≥ 3 мм", `${f(a, 1)} ≥ 3 mm`, 3 / a));
  const minL = Math.min(...p.segs.filter((s) => s.L > 0).map((s) => s.L));
  const lreq = Math.max(6 * a, 30);
  checks.push(mkCheck("weldLmin", `${CL}, 4.5.1(2)`, "l_eff ≥ max(6a; 30 мм)", `${f(minL, 0)} ≥ ${f(lreq, 0)} mm`, lreq / minL));
  const lap = p.segs.filter((s) => s.flank);
  if (lap.length) {
    const Lj = Math.max(...lap.map((s) => s.L));
    if (Lj > 150 * a) {
      const bLw = Math.min(1, 1.2 - (0.2 * Lj) / (150 * a));
      values.push({ k: "β_Lw,1", v: f(bLw, 3) });
      checks.push(mkCheck("weldLong", `${CL}, 4.11, (4.9)`, "F_w,Ed / (β_Lw,1·F_w,Rd) ≤ 1", `β_Lw,1 = ${f(bLw, 3)}`, FwEd / (bLw * FwRd)));
    }
  }
  return finish(checks, values);
}

function finish(checks: Check[], values: { k: string; v: string }[]): ConnResult {
  const u = checks.map((c) => c.util);
  return { checks, values, maxUtil: u.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...u), ok: checks.every((c) => c.ok) };
}

export interface ButtInput {
  code: CodeId;
  t: number; // найменша товщина, мм
  L: number; // геометрична довжина, мм
  runOff?: boolean; // кінці шва виведені за межі стику (без вирахування 2t)
  physicalControl?: boolean; // ДБН: фізичний контроль якості
  Ry: number; // розрахунковий опір (ДБН) або f_y (EN), МПа
  Ru?: number; // ДБН: R_u
  N: number; // + розтяг
  V: number; // зсув уздовж шва
  M: number; // згин у площині листа
  gammaC?: number;
  gammaN?: number;
  gammaM0?: number;
}

/** Стикові шви: ДБН (16.1), (9.4); EN — повний провар, міцність як основного металу (4.7.1). */
export function checkButt(i: ButtInput): ConnResult {
  const gn = i.gammaN ?? 1, gc = i.gammaC ?? 1;
  const lw = i.runOff ? i.L : i.L - 2 * i.t;
  const A = i.t * lw, W = (i.t * lw * lw) / 6;
  const sN = (i.N * gn) / A, sM = (Math.abs(i.M) * gn) / W, tau = (Math.abs(i.V) * gn) / A;
  const s = Math.abs(sN) + sM;
  const checks: Check[] = [];
  const values = [{ k: "l_w", v: `${f(lw, 0)} mm` }, { k: "σ_w / τ_w", v: `${f(s, 1)} / ${f(tau, 1)} MPa` }];
  if (i.code === "DBN") {
    const CL = "ДБН В.2.6-198";
    const tension = sN + sM > 0;
    const Rwy = tension && !i.physicalControl ? 0.85 * i.Ry : i.Ry;
    const Rws = 0.58 * i.Ry;
    values.push({ k: "R_wy / R_ws", v: `${f(Rwy, 0)} / ${f(Rws, 0)} MPa` });
    checks.push(mkCheck("buttNormal", `${CL}, п. 16.1.14, ф. (16.1); табл. 7.3`, "σ_w·γ_n / (R_wy·γ_c) ≤ 1",
      `σ_w = N/(t·l_w) + 6M/(t·l_w²) = ${f(s, 1)} MPa; R_wy = ${f(Rwy, 0)} MPa`, s / (Rwy * gc)));
    if (tau > 0) {
      checks.push(mkCheck("buttShear", `${CL}, табл. 7.3`, "τ_w / (R_ws·γ_c) ≤ 1", `${f(tau, 1)} / ${f(Rws, 0)}`, tau / (Rws * gc)));
      const red = Math.sqrt(s * s + 3 * tau * tau);
      checks.push(mkCheck("buttCombined", `${CL}, п. 16.1.15, ф. (9.4)`, "√(σ² + 3τ²) / (1.15·R_wy·γ_c) ≤ 1",
        `√(${f(s, 1)}² + 3·${f(tau, 1)}²) = ${f(red, 1)} MPa`, red / (1.15 * Rwy * gc)));
    }
    return finish(checks, values);
  }
  const gM0 = i.gammaM0 ?? 1.0;
  const red = Math.sqrt(s * s + 3 * tau * tau);
  checks.push(mkCheck("buttEN", "EN 1993-1-8, 4.7.1; EN 1993-1-1, (6.1)", "√(σ² + 3τ²) / (f_y/γ_M0) ≤ 1",
    `√(${f(s, 1)}² + 3·${f(tau, 1)}²) = ${f(red, 1)} / ${f(i.Ry / gM0, 0)} MPa`, red / (i.Ry / gM0), ["buttFullPen"]));
  return finish(checks, values);
}

/** Пресети конфігурацій кутових швів (у координатах площини з'єднання y — горизонт., z — вертик.) */
export type WeldShape = "flank2" | "trans2" | "rect" | "channel" | "lines2v" | "iProfile" | "rhs";
export interface WeldShapeParams { b: number; h: number; tf?: number; tw?: number }

export function weldShape(shape: WeldShape, p: WeldShapeParams): WeldSeg[] {
  const { b, h } = p, hb = b / 2, hh = h / 2;
  switch (shape) {
    case "flank2": // два флангові шви довжиною b, на відстані h (напуск, зусилля вздовж y)
      return [{ y1: -hb, z1: hh, y2: hb, z2: hh, trim: true, flank: true }, { y1: -hb, z1: -hh, y2: hb, z2: -hh, trim: true, flank: true }];
    case "trans2": // два лобові шви довжиною h на відстані b
      return [{ y1: -hb, z1: -hh, y2: -hb, z2: hh, trim: true }, { y1: hb, z1: -hh, y2: hb, z2: hh, trim: true }];
    case "lines2v": // два вертикальні шви (кронштейн/ребро до колони), довжина h, відстань b
      return [{ y1: -hb, z1: -hh, y2: -hb, z2: hh, trim: true }, { y1: hb, z1: -hh, y2: hb, z2: hh, trim: true }];
    case "channel": // П-подібний: два фланги + лобовий
      return [
        { y1: -hb, z1: hh, y2: hb, z2: hh, flank: true }, { y1: -hb, z1: -hh, y2: hb, z2: -hh, flank: true },
        { y1: hb, z1: -hh, y2: hb, z2: hh },
      ];
    case "rhs":
    case "rect": // по контуру
      return [
        { y1: -hb, z1: -hh, y2: hb, z2: -hh }, { y1: hb, z1: -hh, y2: hb, z2: hh },
        { y1: hb, z1: hh, y2: -hb, z2: hh }, { y1: -hb, z1: hh, y2: -hb, z2: -hh },
      ];
    case "iProfile": { // двотавр по контуру: полиці зовні і зсередини, стінка з двох боків
      const tf = p.tf ?? 10, tw = p.tw ?? 6;
      const zi = hh - tf, yw = tw / 2;
      return [
        { y1: -hb, z1: hh, y2: hb, z2: hh }, { y1: -hb, z1: -hh, y2: hb, z2: -hh },
        { y1: -hb, z1: zi, y2: -yw, z2: zi, trim: true }, { y1: yw, z1: zi, y2: hb, z2: zi, trim: true },
        { y1: -hb, z1: -zi, y2: -yw, z2: -zi, trim: true }, { y1: yw, z1: -zi, y2: hb, z2: -zi, trim: true },
        { y1: -yw, z1: -zi, y2: -yw, z2: zi }, { y1: yw, z1: -zi, y2: yw, z2: zi },
      ];
    }
  }
}
