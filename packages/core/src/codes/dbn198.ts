// ДБН В.2.6-198:2014 «Сталеві конструкції. Норми проектування» (зі Зміною № 1).
// Формулы и пункты сверены с текстом норм; см. docs/VERIFICATION.md.

import { productOf, Section } from "../geometry/sections";
import { steel } from "../catalog/materials";
import {
  Check, cm3, f, finalize, Intermediate, kN, kNm, maxThickness, mcrDoublySymmetric, MemberInput, MemberResult, mkCheck,
} from "./types";

const CL = "ДБН В.2.6-198";

/** Тип кривой устойчивости (рис. Ж.1). Отнесение сечений требует сверки с рисунком. */
export function sectionTypeDBN(s: Section, axis: "x" | "y" = "y"): "a" | "b" | "c" {
  // Табл. 8.1, примечание: прокатные двутавры h > 500 мм при потере устойчивости в плоскости стенки — тип a.
  if (s.kind === "I" && s.fabrication === "hot" && s.h > 500 && axis === "x") return "a";
  if (s.kind === "CHS") return "a";
  if (s.kind === "RHS" || s.kind === "I") return "b";
  return "c";
}

/** Табл. 8.1 */
const AB: Record<string, [number, number]> = { a: [0.03, 0.06], b: [0.04, 0.09], c: [0.04, 0.14] };
/** Границы λ̄, после которых φ ≤ 7.6/λ̄² (п. 8.1.3) */
const LIM: Record<string, number> = { a: 3.8, b: 4.4, c: 5.8 };

/** Табл. Ж.1: λ̄ → φ·1000 для кривых a, b, c (с λ̄ = 6.0 значения общие). */
const TABLE_G1: [number, number, number, number][] = [
  [0.4, 999, 998, 992], [0.6, 994, 986, 950], [0.8, 981, 967, 929], [1.0, 968, 948, 901], [1.2, 954, 927, 878],
  [1.4, 938, 905, 842], [1.6, 920, 881, 811], [1.8, 900, 855, 778], [2.0, 877, 826, 744], [2.2, 851, 794, 709],
  [2.4, 820, 760, 672], [2.6, 785, 722, 635], [2.8, 747, 683, 598], [3.0, 704, 643, 562], [3.2, 660, 602, 526],
  [3.4, 615, 562, 492], [3.6, 572, 524, 460], [3.8, 530, 487, 430], [4.0, 475, 453, 401], [4.2, 431, 421, 375],
  [4.4, 393, 392, 351], [4.6, 359, 359, 328], [4.8, 330, 330, 308], [5.0, 304, 304, 289], [5.2, 281, 281, 271],
  [5.4, 261, 261, 255], [5.6, 242, 242, 240], [5.8, 226, 226, 226], [6.0, 211, 211, 211], [6.2, 198, 198, 198],
  [6.4, 186, 186, 186], [6.6, 174, 174, 174], [6.8, 164, 164, 164], [7.0, 155, 155, 155], [7.2, 147, 147, 147],
  [7.4, 139, 139, 139], [7.6, 132, 132, 132], [7.8, 125, 125, 125], [8.0, 119, 119, 119], [8.5, 105, 105, 105],
  [9.0, 94, 94, 94], [9.5, 84, 84, 84], [10.0, 76, 76, 76], [10.5, 69, 69, 69], [11.0, 63, 63, 63], [11.5, 57, 57, 57],
  [12.0, 53, 53, 53], [12.5, 49, 49, 49], [13.0, 45, 45, 45], [14.0, 39, 39, 39],
];

/** Коэффициент φ по формулам (8.4), (8.5) п. 8.1.3 (без табличного округления). */
export function phiDBNFormula(lam: number, type: "a" | "b" | "c"): number {
  if (lam <= 0.4) return 1;
  const [a, b] = AB[type];
  const d = 9.87 * (1 - a + b * lam) + lam * lam;
  let phi = (0.5 * (d - Math.sqrt(d * d - 39.48 * lam * lam))) / (lam * lam);
  if (lam > LIM[type]) phi = Math.min(phi, 7.6 / (lam * lam));
  return Math.min(1, phi);
}

/** Коэффициент φ: интерполяция по табл. Ж.1 (0.4 ≤ λ̄ ≤ 14), вне таблицы — формулы (8.4), (8.5). */
export function phiDBN(lam: number, type: "a" | "b" | "c"): number {
  if (lam < 0.4) return 1;
  const k = type === "a" ? 1 : type === "b" ? 2 : 3;
  const T = TABLE_G1;
  if (lam > T[T.length - 1][0]) return phiDBNFormula(lam, type);
  for (let i = 1; i < T.length; i++) {
    if (lam <= T[i][0]) {
      const [l0, l1] = [T[i - 1][0], T[i][0]];
      const [p0, p1] = [T[i - 1][k], T[i][k]];
      return (p0 + ((p1 - p0) * (lam - l0)) / (l1 - l0)) / 1000;
    }
  }
  return T[0][k] / 1000;
}

/** φb по (Н.1), (Н.2): φb = φ1 при φ1 ≤ 0.85, иначе 0.68 + 0.21·φ1 ≤ 1. */
export function phiB(phi1: number): number {
  return phi1 <= 0.85 ? phi1 : Math.min(1, 0.68 + 0.21 * phi1);
}

export interface PsiCase {
  cantilever: boolean;
  /** вид нагрузки в пролете */
  load: "point" | "uniform";
  /** пояс, к которому приложена нагрузка */
  flange: "compressed" | "tension";
  /** число закреплений сжатого пояса в пролете: 0, 1 (в середине), 2 (два и более, делящие пролет поровну) */
  restraints: 0 | 1 | 2;
}

/** Коэффициент ψ: табл. Н.1 (балки) и Н.2 (консоли), двутавр с двумя осями симметрии. */
export function psiDBN(alpha: number, c: PsiCase): number {
  if (c.cantilever) {
    const a = Math.min(Math.max(alpha, 4), 100);
    if (c.load === "point") {
      if (c.flange === "tension") return a <= 28 ? 1.0 + 0.16 * a : 4.0 + 0.05 * a;
      return a <= 28 ? 6.2 + 0.08 * a : 7.0 + 0.05 * a;
    }
    // равномерная нагрузка задана только для растянутого пояса; для сжатого — то же (в запас не уменьшаем)
    return 1.42 * Math.sqrt(a);
  }
  const a = Math.min(Math.max(alpha, 0.1), 400);
  const psi1 = a <= 40 ? 2.25 + 0.07 * a : 3.6 + 0.04 * a - 3.5e-5 * a * a;
  if (c.restraints === 2) return psi1;
  if (c.restraints === 1) {
    if (c.load === "point") return 1.75 * psi1; // сосредоточенная в середине
    return c.flange === "compressed" ? 1.14 * psi1 : 1.3 * psi1;
  }
  if (c.load === "point") {
    if (c.flange === "compressed") return a <= 40 ? 1.75 + 0.09 * a : 3.3 + 0.053 * a - 4.5e-5 * a * a;
    return a <= 40 ? 5.05 + 0.09 * a : 6.6 + 0.053 * a - 4.5e-5 * a * a;
  }
  if (c.flange === "compressed") return a <= 40 ? 1.6 + 0.08 * a : 3.15 + 0.04 * a - 2.7e-5 * a * a;
  return a <= 40 ? 3.8 + 0.08 * a : 5.35 + 0.04 * a - 2.7e-5 * a * a;
}

export function checkMemberDBN(inp: MemberInput): MemberResult {
  const s = inp.section;
  const st = steel(inp.steel);
  const t = maxThickness(s);
  const product = productOf(s);
  const Ryn = st.yieldChar(t, product);
  const Ry = st.strength(t, product);
  const Rs = 0.58 * Ry;
  const gc = inp.gammaC ?? 1.0;
  const gn = inp.gammaN ?? 1.0;
  const MEd = Math.abs(inp.MEd ?? 0) * gn, VEd = Math.abs(inp.VEd ?? 0) * gn, NEd = Math.max(0, inp.NEd ?? 0) * gn;
  const checks: Check[] = [];
  const values: Intermediate[] = [
    { key: "Ryn", symbol: "R_yn", value: Ryn, unit: "MPa" },
    { key: "gm", symbol: "γ_m", value: st.gammaM, unit: "" },
    { key: "Ry", symbol: "R_y = R_yn/γ_m", value: Ry, unit: "MPa" },
    { key: "Rs", symbol: "R_s = 0.58·R_y", value: Rs, unit: "MPa" },
    { key: "gc", symbol: "γ_c", value: gc, unit: "" },
    { key: "gn", symbol: "γ_n", value: gn, unit: "" },
  ];
  if (!Number.isFinite(Ry)) {
    checks.push(mkCheck("material", st.source, "R_yn(t)", `t = ${f(t, 1)} mm`, NaN, ["steelNotSupplied"]));
    return finalize(checks, values);
  }
  const R = Ry * gc;
  const gnTxt = gn !== 1 ? `·${gn}` : "";

  if (MEd > 0 && NEd === 0) {
    const sig = MEd / s.Wy;
    checks.push(mkCheck("bending", `${CL}, п. 9.2.1, ф. (9.1)`, "M·γ_n / (W_n,min·R_y·γ_c) ≤ 1",
      `${f(kNm(MEd / gn))}${gnTxt}·10³ / (${f(cm3(s.Wy), 1)}·${f(Ry, 1)}·${gc}) = ${f(sig, 1)} / ${f(R, 1)} MPa`, sig / R, ["elasticDBN"]));
  }
  if (VEd > 0) {
    const S = s.Wply / 2;
    const tau = (VEd * S) / (s.Iy * s.tWeb);
    checks.push(mkCheck("shear", `${CL}, п. 9.2.1, ф. (9.2)`, "Q·S·γ_n / (I·t_w·R_s·γ_c) ≤ 1",
      `${f(kN(VEd / gn))}${gnTxt}·${f(cm3(S), 1)} / (${f(s.Iy / 1e4, 0)}·${f(s.tWeb / 10, 2)}) = ${f(tau, 1)} / ${f(Rs * gc, 1)} MPa`,
      tau / (Rs * gc)));
    if (MEd > 0 && s.kind === "I") {
      const { tf, tw } = s.dims;
      const sx = (MEd / s.Iy) * (s.h / 2 - tf);
      const Sf = (s.b * tf * (s.h - tf)) / 2;
      const txy = (VEd * Sf) / (s.Iy * tw);
      const u = (0.87 / R) * Math.sqrt(sx * sx + 3 * txy * txy);
      checks.push(mkCheck("reducedStress", `${CL}, п. 9.2.1, ф. (9.4)`, "0.87/(R_y·γ_c)·√(σ_x² + 3τ_xy²) ≤ 1",
        `σ_x = ${f(sx, 1)}; τ_xy = ${f(txy, 1)} MPa; 0.87/${f(R, 1)}·${f(Math.sqrt(sx * sx + 3 * txy * txy), 1)}`, u, ["maxMQTogether"]));
    }
  }

  if (MEd > 0 && s.ltbProne && inp.ltb && !inp.ltb.restrained) {
    const lef = inp.ltb.Lcr;
    let phi1: number;
    const extra: Intermediate[] = [];
    let subst: string;
    const notes: string[] = [];
    if (s.kind === "I" && inp.ltb.dbn) {
      // Прил. Н: φ1 = ψ·(Iy/Ix)·(h/lef)²·E/Ry, α = 1.54·(It/Iy)·(lef/h)²
      const alpha = 1.54 * (s.It / s.Iz) * (lef / s.h) ** 2;
      const psi = psiDBN(alpha, inp.ltb.dbn);
      phi1 = psi * (s.Iz / s.Iy) * (s.h / lef) ** 2 * (st.E / Ry);
      extra.push({ key: "alphaT", symbol: "α_t", value: alpha, unit: "" }, { key: "psi", symbol: "ψ", value: psi, unit: "" });
      subst = `l_ef = ${f(lef / 1000)} m; α_t = ${f(alpha, 2)}; ψ = ${f(psi, 3)}; φ₁ = ${f(phi1, 3)}`;
      notes.push("psiTableH");
    } else {
      const { C1, C2, loadAt } = inp.ltb;
      const Mcr = mcrDoublySymmetric(s, st.E, st.G, lef, C1, C2, loadAt);
      phi1 = Mcr / (s.Wy * Ry);
      extra.push({ key: "Mcr", symbol: "M_cr", value: kNm(Mcr), unit: "kN·m" });
      subst = `l_ef = ${f(lef / 1000)} m; M_cr = ${f(kNm(Mcr))} kN·m; φ₁ = ${f(phi1, 3)}`;
      notes.push("phibViaMcr");
    }
    const pb = phiB(phi1);
    values.push(...extra, { key: "phi1", symbol: "φ₁", value: phi1, unit: "" }, { key: "phib", symbol: "φ_b", value: pb, unit: "" });
    checks.push(mkCheck("ltb", `${CL}, п. 9.4.1, ф. (9.28); дод. Н`, "M·γ_n / (φ_b·W_cx·R_y·γ_c) ≤ 1",
      `${subst}; φ_b = ${f(pb, 3)}; ${f(MEd / s.Wy, 1)} / ${f(pb * R, 1)} MPa`, MEd / (pb * s.Wy * R), notes));
  }

  if (NEd > 0) {
    if (MEd > 0) {
      const u = NEd / (s.A * R) + MEd / (s.Wy * R);
      checks.push(mkCheck("strengthNM", `${CL}, розд. 10`, "N/(A·R_y·γ_c) + M/(W_x·R_y·γ_c) ≤ 1",
        `${f(NEd / s.A, 1)}/${f(R, 1)} + ${f(MEd / s.Wy, 1)}/${f(R, 1)}`, u, ["nmStabilityTodo"]));
    } else {
      checks.push(mkCheck("compression", `${CL}, п. 8.1`, "N·γ_n / (A·R_y·γ_c) ≤ 1",
        `${f(kN(NEd / gn))}${gnTxt}·10 / (${f(s.A / 100)}·${f(R, 1)}) = ${f(NEd / s.A, 1)} / ${f(R, 1)} MPa`, NEd / (s.A * R)));
    }
    if (inp.buckling) {
      const iz = s.kind === "L" ? s.imin : s.iz;
      for (const [axis, Lcr, i] of [["x", inp.buckling.Lcr_y, s.iy], ["y", inp.buckling.Lcr_z, iz]] as const) {
        const type = sectionTypeDBN(s, axis);
        const lam = Lcr / i;
        const lamBar = lam * Math.sqrt(Ry / st.E);
        const phi = phiDBN(lamBar, type);
        const u = NEd / (phi * s.A * R);
        checks.push(mkCheck(`flexBuckling_${axis === "x" ? "y" : "z"}`, `${CL}, п. 8.1.3, ф. (8.3)–(8.5)`, "N·γ_n / (φ·A·R_y·γ_c) ≤ 1",
          `l_ef = ${f(Lcr / 1000)} m; λ_${axis} = ${f(lam, 1)}; λ̄ = ${f(lamBar, 3)}; type ${type}; φ = ${f(phi, 3)}; ${f(kN(NEd))} / ${f(kN(phi * s.A * R))}`,
          u, MEd > 0 ? ["nmStabilityTodo", "curveTypeCheck"] : ["curveTypeCheck"]));
        const alpha = Math.max(0.5, u);
        const lamU = 180 - 60 * alpha;
        checks.push(mkCheck(`slenderness_${axis === "x" ? "y" : "z"}`, `${CL}, п. 13.4`, "λ ≤ λ_u = 180 − 60α",
          `${f(lam, 1)} ≤ ${f(lamU, 1)}`, lam / lamU));
      }
    }
  }

  if (inp.deflection) {
    const { w, Lref, limit } = inp.deflection;
    const flim = Lref / limit;
    checks.push(mkCheck("deflection", "ДСТУ Б В.1.2-3:2006, табл. 1", `f ≤ l/${f(limit, 0)}`,
      `${f(Math.abs(w), 1)} mm ≤ ${f(flim, 1)} mm`, Math.abs(w) / flim));
  }
  return finalize(checks, values);
}

/** Предельный прогиб по ДСТУ Б В.1.2-3:2006, табл. 1, поз. 2а (эстетико-психологические требования):
 *  l ≤ 1 м — l/120; 3 м — l/150; 6 м — l/200; 24 м — l/250; ≥ 36 м — l/300, промежуточные — интерполяция.
 *  Возвращает знаменатель n в l/n. */
export function deflectionLimitDSTU(l_m: number): number {
  const pts: [number, number][] = [[1, 120], [3, 150], [6, 200], [24, 250], [36, 300]];
  if (l_m <= 1) return 120;
  if (l_m >= 36) return 300;
  for (let i = 1; i < pts.length; i++) {
    const [l0, n0] = pts[i - 1], [l1, n1] = pts[i];
    if (l_m <= l1) {
      // интерполируется величина предельного прогиба fu = l/n
      const f0 = l0 / n0, f1 = l1 / n1;
      const fu = f0 + ((f1 - f0) * (l_m - l0)) / (l1 - l0);
      return l_m / fu;
    }
  }
  return 300;
}
