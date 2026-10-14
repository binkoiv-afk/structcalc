// ДБН В.2.6-198:2014 «Сталеві конструкції. Норми проектування».
// Номера пунктов в отчете будут уточнены при сверке с текстом норм (см. docs/VERIFICATION.md).

import type { Section } from "../geometry/sections";
import { steel } from "../catalog/materials";
import {
  Check, cm3, f, finalize, Intermediate, kN, kNm, maxThickness, mcrDoublySymmetric, MemberInput, MemberResult, mkCheck,
} from "./types";

const CL = "ДБН В.2.6-198";

/** Тип сечения для коэффициента φ (a, b, c). */
export function sectionTypeDBN(s: Section): "a" | "b" | "c" {
  if (s.kind === "CHS") return "a";
  if (s.kind === "RHS" || s.kind === "I") return "b";
  return "c";
}

const AB: Record<string, [number, number]> = { a: [0.03, 0.06], b: [0.04, 0.09], c: [0.04, 0.14] };

/** Коэффициент устойчивости при центральном сжатии φ по условной гибкости λ̄ = λ·√(Ry/E). */
export function phiDBN(lam: number, type: "a" | "b" | "c"): number {
  if (lam <= 0.4) return 1;
  const [a, b] = AB[type];
  const d = 9.87 * (1 - a + b * lam) + lam * lam;
  return Math.min(1, (0.5 * (d - Math.sqrt(d * d - 39.48 * lam * lam))) / (lam * lam));
}

/** φb по критическому моменту: φ1 = Mcr/(Wc·Ry); φb = φ1 при φ1 ≤ 0.85, иначе 0.68 + 0.21·φ1 ≤ 1. */
export function phiB(phi1: number): number {
  return phi1 <= 0.85 ? phi1 : Math.min(1, 0.68 + 0.21 * phi1);
}

export function checkMemberDBN(inp: MemberInput): MemberResult {
  const s = inp.section;
  const st = steel(inp.steel);
  const Ry = st.strength(maxThickness(s));
  const Rs = 0.58 * Ry;
  const gc = inp.gammaC ?? 1.0;
  const MEd = Math.abs(inp.MEd ?? 0), VEd = Math.abs(inp.VEd ?? 0), NEd = Math.max(0, inp.NEd ?? 0);
  const checks: Check[] = [];
  const values: Intermediate[] = [
    { key: "Ry", symbol: "R_y", value: Ry, unit: "MPa" },
    { key: "Rs", symbol: "R_s", value: Rs, unit: "MPa" },
    { key: "gc", symbol: "γ_c", value: gc, unit: "" },
  ];
  const R = Ry * gc;

  if (MEd > 0 && NEd === 0) {
    const sig = MEd / s.Wy;
    checks.push(mkCheck("bending", CL, "M / (W_x·R_y·γ_c) ≤ 1",
      `${f(kNm(MEd))}·10³ / (${f(cm3(s.Wy), 1)}·${Ry}·${gc}) = ${f(sig, 1)} / ${f(R, 1)} MPa`, sig / R, ["elasticDBN"]));
  }
  if (VEd > 0) {
    const S = s.Wply / 2;
    const tau = (VEd * S) / (s.Iy * s.tWeb);
    checks.push(mkCheck("shear", CL, "Q·S / (I_x·t_w·R_s·γ_c) ≤ 1",
      `${f(kN(VEd))}·${f(cm3(S), 1)} / (${f(s.Iy / 1e4, 0)}·${f(s.tWeb / 10, 2)}) = ${f(tau, 1)} / ${f(Rs * gc, 1)} MPa`,
      tau / (Rs * gc)));
    if (MEd > 0 && s.kind === "I") {
      const { tf, tw } = s.dims;
      const s1 = (MEd / s.Iy) * (s.h / 2 - tf);
      const Sf = (s.b * tf * (s.h - tf)) / 2;
      const t1 = (VEd * Sf) / (s.Iy * tw);
      const sef = Math.sqrt(s1 * s1 + 3 * t1 * t1);
      checks.push(mkCheck("reducedStress", CL, "√(σ₁² + 3τ₁²) / (1.15·R_y·γ_c) ≤ 1",
        `σ₁ = ${f(s1, 1)}; τ₁ = ${f(t1, 1)}; σ_ef = ${f(sef, 1)} / ${f(1.15 * R, 1)} MPa`, sef / (1.15 * R), ["maxMQTogether"]));
    }
  }

  if (MEd > 0 && s.ltbProne && inp.ltb && !inp.ltb.restrained) {
    const { Lcr, C1, C2, loadAt } = inp.ltb;
    const Mcr = mcrDoublySymmetric(s, st.E, st.G, Lcr, C1, C2, loadAt);
    const phi1 = Mcr / (s.Wy * Ry);
    const pb = phiB(phi1);
    values.push(
      { key: "Mcr", symbol: "M_cr", value: kNm(Mcr), unit: "kN·m" },
      { key: "phi1", symbol: "φ₁", value: phi1, unit: "" },
      { key: "phib", symbol: "φ_b", value: pb, unit: "" },
    );
    checks.push(mkCheck("ltb", CL, "M / (φ_b·W_c·R_y·γ_c) ≤ 1",
      `M_cr = ${f(kNm(Mcr))} kN·m; φ₁ = ${f(phi1, 3)}; φ_b = ${f(pb, 3)}; ${f(MEd / s.Wy, 1)} / ${f(pb * R, 1)} MPa`,
      MEd / (pb * s.Wy * R), ["phibViaMcr"]));
  }

  if (NEd > 0) {
    if (MEd > 0) {
      const u = NEd / (s.A * R) + MEd / (s.Wy * R);
      checks.push(mkCheck("strengthNM", CL, "N/(A·R_y·γ_c) + M/(W_x·R_y·γ_c) ≤ 1",
        `${f(NEd / s.A, 1)}/${f(R, 1)} + ${f(MEd / s.Wy, 1)}/${f(R, 1)}`, u, ["nmStabilityTodo"]));
    } else {
      checks.push(mkCheck("compression", CL, "N / (A·R_y·γ_c) ≤ 1",
        `${f(kN(NEd))}·10 / (${f(s.A / 100)}·${f(R, 1)}) = ${f(NEd / s.A, 1)} / ${f(R, 1)} MPa`, NEd / (s.A * R)));
    }
    if (inp.buckling) {
      const type = sectionTypeDBN(s);
      const iz = s.kind === "L" ? s.imin : s.iz;
      for (const [axis, Lcr, i] of [["x", inp.buckling.Lcr_y, s.iy], ["y", inp.buckling.Lcr_z, iz]] as const) {
        const lam = Lcr / i;
        const lamBar = lam * Math.sqrt(Ry / st.E);
        const phi = phiDBN(lamBar, type);
        const u = NEd / (phi * s.A * R);
        checks.push(mkCheck(`flexBuckling_${axis === "x" ? "y" : "z"}`, CL, "N / (φ·A·R_y·γ_c) ≤ 1",
          `l_ef = ${f(Lcr / 1000)} m; λ_${axis} = ${f(lam, 1)}; λ̄ = ${f(lamBar, 3)}; type ${type}; φ = ${f(phi, 3)}; ${f(kN(NEd))} / ${f(kN(phi * s.A * R))}`,
          u, MEd > 0 ? ["nmStabilityTodo"] : undefined));
        const alpha = Math.max(0.5, u);
        const lamU = 180 - 60 * alpha;
        checks.push(mkCheck(`slenderness_${axis === "x" ? "y" : "z"}`, CL, "λ ≤ λ_u = 180 − 60α",
          `${f(lam, 1)} ≤ ${f(lamU, 1)}`, lam / lamU));
      }
    }
  }

  if (inp.deflection) {
    const { w, Lref, limit } = inp.deflection;
    const flim = Lref / limit;
    checks.push(mkCheck("deflection", "ДСТУ Б В.1.2-3:2006", `f ≤ l/${limit}`,
      `${f(Math.abs(w), 1)} mm ≤ ${f(flim, 1)} mm`, Math.abs(w) / flim));
  }
  return finalize(checks, values);
}
