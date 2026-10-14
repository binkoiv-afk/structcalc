// Расчет и подбор стальной балки: нагрузки → сочетания → усилия → проверки норм.
// Входные данные в «инженерных» единицах: м, кН, кН/м, кН·м.

import { analyzeBeam, BeamLoad, BeamResult, SupportType } from "../analysis/beam";
import { steel } from "../catalog/materials";
import { familySections } from "../catalog/profiles";
import type { Section } from "../geometry/sections";
import { checkMemberDBN, deflectionLimitDSTU, PsiCase } from "../codes/dbn198";
import { checkMemberEN } from "../codes/en1993";
import type { CodeId, MemberResult } from "../codes/types";

export type LoadCategory = "G" | "Q";

export type UserLoad =
  | { type: "udl"; cat: LoadCategory; q: number; from?: number; to?: number } // кН/м, м
  | { type: "point"; cat: LoadCategory; P: number; x: number } // кН, м
  | { type: "moment"; cat: LoadCategory; M: number; x: number }; // кН·м, м

export interface BeamDesignInput {
  code: CodeId;
  steel: string;
  spans: number[]; // м
  supports: SupportType[];
  loads: UserLoad[];
  selfWeight: boolean;
  gammaG: number;
  gammaQ: number;
  gammaC?: number;
  /** ДБН: коэффициент надежности по ответственности γn */
  gammaN?: number;
  ltb: {
    restrained: boolean;
    loadAt: "top" | "center" | "bottom";
    /** число закреплений сжатого пояса в пролете: 0, 1 (в середине), 2 (два и более) */
    restraints?: 0 | 1 | 2;
    /** м; по умолчанию — пролет между закреплениями */
    Lcr?: number;
  };
  /** знаменатель n предельного прогиба l/n; 0 — по норме (ДСТУ Б В.1.2-3 для ДБН, l/250 для EN) */
  deflectionLimit: number;
  /** осевая сжимающая сила, кН (расчетная), и расчетные длины, м */
  axial?: { NEd: number; Lcr_y: number; Lcr_z: number };
}

export const DEFAULT_FACTORS: Record<CodeId, { gammaG: number; gammaQ: number }> = {
  // ДБН В.1.2-2: γf для металлоконструкций 1.05, для прочих постоянных 1.1–1.3; полезные 1.2–1.3
  DBN: { gammaG: 1.1, gammaQ: 1.3 },
  // EN 1990, табл. A1.2(B), формула 6.10
  EN: { gammaG: 1.35, gammaQ: 1.5 },
};

export interface BeamDesignResult {
  section: Section;
  uls: BeamResult;
  sls: BeamResult;
  member: MemberResult;
  C1: number;
  C2: number;
  LcrLT: number;
}

function toCore(l: UserLoad, factor: number): BeamLoad {
  if (l.type === "udl") return { type: "udl", q: l.q * factor, from: l.from != null ? l.from * 1000 : undefined, to: l.to != null ? l.to * 1000 : undefined };
  if (l.type === "point") return { type: "point", P: l.P * 1000 * factor, x: l.x * 1000 };
  return { type: "moment", M: l.M * 1e6 * factor, x: l.x * 1000 };
}

/** Коэффициент C1 по форме эпюры моментов на участке (≈ Cb, AISC 360 F1-1). */
export function c1FromDiagram(x: number[], M: number[], a: number, b: number): number {
  const at = (xx: number) => {
    let best = 0, d = Infinity;
    x.forEach((xi, i) => { const di = Math.abs(xi - xx); if (di < d) { d = di; best = Math.abs(M[i]); } });
    return best;
  };
  let mmax = 0;
  x.forEach((xi, i) => { if (xi >= a - 1e-6 && xi <= b + 1e-6) mmax = Math.max(mmax, Math.abs(M[i])); });
  if (mmax === 0) return 1;
  const L = b - a;
  const cb = (12.5 * mmax) / (2.5 * mmax + 3 * at(a + L / 4) + 4 * at(a + L / 2) + 3 * at(a + (3 * L) / 4));
  return Math.min(cb, 2.5);
}

export function designBeam(inp: BeamDesignInput, section: Section): BeamDesignResult {
  const st = steel(inp.steel);
  const EI = st.E * section.Iy;
  const spans = inp.spans.map((s) => s * 1000);
  const sw: UserLoad[] = inp.selfWeight ? [{ type: "udl", cat: "G", q: (section.mass * 9.81) / 1000 }] : [];
  const all = [...inp.loads, ...sw];
  const fac = (l: UserLoad) => (l.cat === "G" ? inp.gammaG : inp.gammaQ);
  const uls = analyzeBeam({ spans, supports: inp.supports, EI, loads: all.map((l) => toCore(l, fac(l))) });
  const sls = analyzeBeam({ spans, supports: inp.supports, EI, loads: all.map((l) => toCore(l, 1)) });

  // Участок для изгибно-крутильной проверки — пролет с наибольшим |M|
  const bounds = [0];
  for (const L of spans) bounds.push(bounds[bounds.length - 1] + L);
  let crit = 0, cm = -1;
  spans.forEach((_, i) => {
    let m = 0;
    uls.x.forEach((x, k) => { if (x >= bounds[i] && x <= bounds[i + 1]) m = Math.max(m, Math.abs(uls.M[k])); });
    if (m > cm) { cm = m; crit = i; }
  });
  const isCant = inp.supports[crit] === "free" || inp.supports[crit + 1] === "free";
  const nRes = inp.ltb.restraints ?? 0;
  const LcrLT = inp.ltb.Lcr != null && inp.ltb.Lcr > 0
    ? inp.ltb.Lcr * 1000
    : isCant ? (inp.code === "DBN" ? spans[crit] : 2 * spans[crit]) : spans[crit] / (nRes + 1);
  const C1 = isCant ? 1 : c1FromDiagram(uls.x, uls.M, bounds[crit], bounds[crit + 1]);
  const hasUdl = all.some((l) => l.type === "udl");
  const C2 = hasUdl ? 0.454 : 0.63;
  const psiCase: PsiCase = {
    cantilever: isCant,
    load: hasUdl ? "uniform" : "point",
    flange: isCant
      ? (inp.ltb.loadAt === "bottom" ? "compressed" : "tension")
      : (inp.ltb.loadAt === "bottom" ? "tension" : "compressed"),
    restraints: isCant ? 0 : nRes,
  };

  const limitFor = (Lref: number) =>
    inp.deflectionLimit > 0 ? inp.deflectionLimit : inp.code === "DBN" ? deflectionLimitDSTU(Lref / 1000) : 250;
  const worst = sls.spanDeflections.reduce((a, b) =>
    Math.abs(b.w) * limitFor(b.Lref) / b.Lref > Math.abs(a.w) * limitFor(a.Lref) / a.Lref ? b : a);
  const MEd = Math.max(Math.abs(uls.Mmax), Math.abs(uls.Mmin));
  const memberInput = {
    code: inp.code, section, steel: inp.steel, gammaC: inp.gammaC, gammaN: inp.gammaN,
    MEd, VEd: uls.Vabs, NEd: inp.axial ? inp.axial.NEd * 1000 : 0,
    ltb: { restrained: inp.ltb.restrained, Lcr: LcrLT, C1, C2, loadAt: inp.ltb.loadAt, dbn: psiCase },
    buckling: inp.axial ? { Lcr_y: inp.axial.Lcr_y * 1000, Lcr_z: inp.axial.Lcr_z * 1000 } : undefined,
    deflection: { w: worst.w, Lref: worst.Lref, limit: limitFor(worst.Lref) },
  };
  const member = inp.code === "EN" ? checkMemberEN(memberInput) : checkMemberDBN(memberInput);
  return { section, uls, sls, member, C1, C2, LcrLT };
}

export interface SelectionResult {
  best?: BeamDesignResult;
  tried: { name: string; mass: number; util: number }[];
}

/** Подбор: самый легкий профиль семейства, проходящий все проверки. */
export function selectBeam(inp: BeamDesignInput, family: string): SelectionResult {
  const tried: SelectionResult["tried"] = [];
  for (const s of familySections(family)) {
    const r = designBeam(inp, s);
    tried.push({ name: s.name, mass: s.mass, util: r.member.maxUtil });
    if (r.member.ok) return { best: r, tried };
  }
  return { tried };
}
