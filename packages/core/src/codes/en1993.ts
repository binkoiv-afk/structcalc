// EN 1993-1-1: проверки сечения и устойчивости стального элемента.
// Рекомендуемые значения γM0 = γM1 = 1.0 (национальные приложения могут отличаться).

import type { Section } from "../geometry/sections";
import { steel } from "../catalog/materials";
import { annex } from "./annex";
import {
  Check, cm3, f, finalize, Intermediate, kN, kNm, maxThickness, mcrDoublySymmetric, MemberInput, MemberResult, mkCheck,
} from "./types";

const CL = "EN 1993-1-1";

/** Класс сечения (табл. 5.2). mode: изгиб относительно y или сжатие. */
export function classifyEN(s: Section, fy: number, mode: "bending" | "compression"): number {
  const eps = Math.sqrt(235 / fy);
  let cls = 1;
  for (const e of s.elements) {
    const r = e.c / e.t;
    let lim: number[];
    if (s.kind === "CHS") {
      lim = [50, 70, 90].map((k) => k * eps * eps);
    } else if (e.support === "outstand") {
      lim = [9, 10, 14].map((k) => k * eps);
      if (s.kind === "L") lim = [15 * eps, 15 * eps, 15 * eps];
    } else if (e.role === "web" && mode === "bending") {
      lim = [72, 83, 124].map((k) => k * eps);
    } else {
      lim = [33, 38, 42].map((k) => k * eps);
    }
    const c = r <= lim[0] ? 1 : r <= lim[1] ? 2 : r <= lim[2] ? 3 : 4;
    cls = Math.max(cls, c);
  }
  return cls;
}

const ALPHA: Record<string, number> = { a0: 0.13, a: 0.21, b: 0.34, c: 0.49, d: 0.76 };

/** Кривая потери устойчивости (табл. 6.2). */
export function bucklingCurveEN(s: Section, fy: number, axis: "y" | "z"): string {
  const high = fy >= 460;
  if (s.kind === "I") {
    if (s.fabrication === "welded") return axis === "y" ? "b" : "c";
    const tf = s.dims.tf;
    if (s.h / s.b > 1.2) {
      if (tf <= 40) return high ? "a0" : axis === "y" ? "a" : "b";
      return high ? "a" : axis === "y" ? "b" : "c";
    }
    if (tf <= 100) return high ? "a" : axis === "y" ? "b" : "c";
    return high ? "c" : "d";
  }
  if (s.kind === "RHS" || s.kind === "CHS") return s.fabrication === "hot" ? (high ? "a0" : "a") : "c";
  if (s.kind === "L") return "b";
  return "c";
}

export function chi(lambda: number, alpha: number, lambda0 = 0.2): number {
  const phi = 0.5 * (1 + alpha * (lambda - lambda0) + lambda * lambda);
  return Math.min(1, 1 / (phi + Math.sqrt(Math.max(phi * phi - lambda * lambda, 0))));
}

export function checkMemberEN(inp: MemberInput): MemberResult {
  const s = inp.section;
  const st = steel(inp.steel);
  const fy = st.strength(maxThickness(s));
  if (!Number.isFinite(fy)) {
    return finalize([mkCheck("material", st.source, "f_y(t)", `t = ${f(maxThickness(s), 1)} mm`, NaN, ["steelNotSupplied"])], []);
  }
  const gM0 = inp.gammaM0 ?? annex().e1993.gM0, gM1 = inp.gammaM1 ?? annex().e1993.gM1;
  const MEd = Math.abs(inp.MEd ?? 0), VEd = Math.abs(inp.VEd ?? 0), NEd = Math.max(0, inp.NEd ?? 0);
  const checks: Check[] = [];
  const values: Intermediate[] = [
    { key: "fy", symbol: "f_y", value: fy, unit: "MPa" },
    { key: "eps", symbol: "ε", value: Math.sqrt(235 / fy), unit: "" },
  ];

  const clsB = classifyEN(s, fy, "bending");
  const clsN = classifyEN(s, fy, "compression");
  const cls = NEd > 0 ? Math.max(clsB, clsN) : clsB;
  values.push({ key: "class", symbol: "Class", value: cls, unit: "" });
  if (cls === 4) {
    checks.push(mkCheck("class4", `${CL} 5.5`, "Class 4", "—", NaN, ["class4NotSupported"]));
    return finalize(checks, values);
  }
  const Wy = cls <= 2 ? s.Wply : s.Wy;
  const Wname = cls <= 2 ? "W_pl,y" : "W_el,y";
  const McRd = (Wy * fy) / gM0;
  const VplRd = (s.Avz * fy) / Math.sqrt(3) / gM0;
  const NplRd = (s.A * fy) / gM0;

  if (MEd > 0) {
    checks.push(mkCheck("bending", `${CL} 6.2.5`, `M_Ed / (${Wname}·f_y/γ_M0) ≤ 1`,
      `${f(kNm(MEd))} / (${f(cm3(Wy), 1)}·${fy}/${gM0}·10⁻³) = ${f(kNm(MEd))} / ${f(kNm(McRd))}`, MEd / McRd));
  }
  if (VEd > 0) {
    const notes: string[] = [];
    if (s.kind === "I" && (s.h - 2 * s.dims.tf) / s.dims.tw > 72 * Math.sqrt(235 / fy)) notes.push("shearBuckling");
    checks.push(mkCheck("shear", `${CL} 6.2.6`, "V_Ed / (A_v·(f_y/√3)/γ_M0) ≤ 1",
      `${f(kN(VEd))} / (${f(s.Avz / 100)}·${fy}/√3/${gM0}·10⁻¹) = ${f(kN(VEd))} / ${f(kN(VplRd))}`, VEd / VplRd, notes));
    if (MEd > 0 && VEd > 0.5 * VplRd) {
      const rho = (2 * VEd / VplRd - 1) ** 2;
      let MvRd: number;
      if (s.kind === "I" && cls <= 2) {
        const hw = s.h - 2 * s.dims.tf;
        MvRd = Math.min(McRd, ((s.Wply - (rho * (hw * s.dims.tw) ** 2) / (4 * s.dims.tw)) * fy) / gM0);
      } else MvRd = (1 - rho) * McRd;
      checks.push(mkCheck("bendingShear", `${CL} 6.2.8`, "M_Ed / M_V,Rd ≤ 1, ρ = (2V_Ed/V_pl,Rd − 1)²",
        `ρ = ${f(rho, 3)}; ${f(kNm(MEd))} / ${f(kNm(MvRd))}`, MEd / MvRd, ["mvConservative"]));
    }
  }

  // Изгибно-крутильная форма
  let chiLT = 1;
  if (MEd > 0 && s.ltbProne && inp.ltb && !inp.ltb.restrained) {
    const { Lcr, C1, C2, loadAt } = inp.ltb;
    const Mcr = mcrDoublySymmetric(s, st.E, st.G, Lcr, C1, C2, loadAt);
    const lamLT = Math.sqrt((Wy * fy) / Mcr);
    const curve = s.kind === "I" && s.fabrication !== "welded" ? (s.h / s.b <= 2 ? "a" : "b") : s.kind === "I" ? (s.h / s.b <= 2 ? "c" : "d") : "d";
    chiLT = lamLT <= 0.2 || MEd / Mcr <= 0.04 ? 1 : chi(lamLT, ALPHA[curve]);
    const MbRd = (chiLT * Wy * fy) / gM1;
    values.push(
      { key: "Mcr", symbol: "M_cr", value: kNm(Mcr), unit: "kN·m" },
      { key: "lamLT", symbol: "λ̄_LT", value: lamLT, unit: "" },
      { key: "chiLT", symbol: "χ_LT", value: chiLT, unit: "" },
    );
    checks.push(mkCheck("ltb", `${CL} 6.3.2.2`, "M_Ed / (χ_LT·W_y·f_y/γ_M1) ≤ 1",
      `M_cr = ${f(kNm(Mcr))} kN·m; λ̄_LT = ${f(lamLT, 3)}; curve ${curve}; χ_LT = ${f(chiLT, 3)}; ${f(kNm(MEd))} / ${f(kNm(MbRd))}`,
      MEd / MbRd));
  }

  // Сжатие и продольный изгиб
  let chiY = 1, chiZ = 1, lamY = 0, lamZ = 0;
  if (NEd > 0) {
    checks.push(mkCheck("compression", `${CL} 6.2.4`, "N_Ed / (A·f_y/γ_M0) ≤ 1",
      `${f(kN(NEd))} / ${f(kN(NplRd))}`, NEd / NplRd));
    if (inp.buckling) {
      const iz = s.kind === "L" ? s.imin : s.iz;
      const Iz = iz * iz * s.A;
      for (const [axis, Lcr, I] of [["y", inp.buckling.Lcr_y, s.Iy], ["z", inp.buckling.Lcr_z, Iz]] as const) {
        const Ncr = (Math.PI ** 2 * st.E * I) / (Lcr * Lcr);
        const lam = Math.sqrt((s.A * fy) / Ncr);
        const curve = bucklingCurveEN(s, fy, axis);
        const c = lam <= 0.2 || NEd / Ncr <= 0.04 ? 1 : chi(lam, ALPHA[curve]);
        if (axis === "y") { chiY = c; lamY = lam; } else { chiZ = c; lamZ = lam; }
        const NbRd = (c * s.A * fy) / gM1;
        checks.push(mkCheck(`flexBuckling_${axis}`, `${CL} 6.3.1`, `N_Ed / (χ_${axis}·A·f_y/γ_M1) ≤ 1`,
          `L_cr = ${f(Lcr / 1000)} m; λ̄ = ${f(lam, 3)}; curve ${curve}; χ = ${f(c, 3)}; ${f(kN(NEd))} / ${f(kN(NbRd))}`,
          NEd / NbRd));
      }
    }
    if (MEd > 0) {
      // Прил. B (метод 2), одноосный изгиб
      const Cmy = inp.Cmy ?? 0.95;
      const NRk = s.A * fy, MRk = Wy * fy;
      const ny = NEd / (chiY * NRk / gM1), nz = NEd / (chiZ * NRk / gM1);
      const kyy = cls <= 2
        ? Cmy * Math.min(1 + (lamY - 0.2) * ny, 1 + 0.8 * ny)
        : Cmy * Math.min(1 + 0.6 * lamY * ny, 1 + 0.6 * ny);
      const torsional = s.ltbProne && inp.ltb && !inp.ltb.restrained;
      let kzy: number;
      if (!torsional) kzy = cls <= 2 ? 0.6 * kyy : 0.8 * kyy;
      else {
        const CmLT = Cmy;
        kzy = cls <= 2
          ? Math.max(1 - (0.1 * lamZ * nz) / (CmLT - 0.25), 1 - (0.1 * nz) / (CmLT - 0.25))
          : Math.max(1 - (0.05 * lamZ * nz) / (CmLT - 0.25), 1 - (0.05 * nz) / (CmLT - 0.25));
        if (lamZ < 0.4 && cls <= 2) kzy = Math.min(0.6 + lamZ, kzy);
      }
      const my = MEd / (chiLT * MRk / gM1);
      checks.push(mkCheck("interaction_y", `${CL} 6.3.3 (6.61)`, "N_Ed/(χ_y·N_Rk/γ_M1) + k_yy·M_y,Ed/(χ_LT·M_y,Rk/γ_M1) ≤ 1",
        `${f(ny, 3)} + ${f(kyy, 3)}·${f(my, 3)}`, ny + kyy * my, ["annexB"]));
      checks.push(mkCheck("interaction_z", `${CL} 6.3.3 (6.62)`, "N_Ed/(χ_z·N_Rk/γ_M1) + k_zy·M_y,Ed/(χ_LT·M_y,Rk/γ_M1) ≤ 1",
        `${f(nz, 3)} + ${f(kzy, 3)}·${f(my, 3)}`, nz + kzy * my, ["annexB"]));
    }
  }

  if (inp.deflection) {
    const { w, Lref, limit } = inp.deflection;
    const wlim = Lref / limit;
    checks.push(mkCheck("deflection", "EN 1990 A1.4", `w ≤ L/${limit}`,
      `${f(Math.abs(w), 1)} mm ≤ ${f(wlim, 1)} mm`, Math.abs(w) / wlim));
  }
  return finalize(checks, values);
}
