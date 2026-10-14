// Расчет и подбор стального стержня на сжатие (центральное и внецентренное).
// Ввод в инженерных единицах: м, кН, кН·м; усилия — расчетные.

import { familySections } from "../catalog/profiles";
import type { Section } from "../geometry/sections";
import { checkMemberDBN } from "../codes/dbn198";
import { checkMemberEN } from "../codes/en1993";
import type { CodeId, MemberInput, MemberResult } from "../codes/types";

/** Коэффициенты расчетной длины μ для типовых закреплений концов (ДБН В.2.6-198, табл. 8.3 / EN — эквивалентно). */
export const END_CONDITIONS: { key: string; mu: number }[] = [
  { key: "pinPin", mu: 1.0 },
  { key: "fixedPin", mu: 0.7 },
  { key: "fixedFixed", mu: 0.5 },
  { key: "fixedFree", mu: 2.0 },
];

export interface ColumnDesignInput {
  code: CodeId;
  steel: string;
  /** геометрическая длина, м */
  L: number;
  /** μ в плоскости сильной оси (изгиба) */
  muY: number;
  /** μ из плоскости (слабая ось) */
  muZ: number;
  /** расстояние между раскреплениями из плоскости, м; по умолчанию L */
  Lz?: number;
  /** расчетная продольная сила (сжатие), кН */
  N: number;
  /** расчетный изгибающий момент относительно сильной оси, кН·м */
  M: number;
  gammaC?: number;
  gammaN?: number;
}

export interface ColumnDesignResult {
  section: Section;
  member: MemberResult;
  Lcr_y: number; // мм
  Lcr_z: number; // мм
}

export function designColumn(inp: ColumnDesignInput, section: Section): ColumnDesignResult {
  const Lcr_y = inp.muY * inp.L * 1000;
  const Lcr_z = inp.muZ * (inp.Lz && inp.Lz > 0 ? inp.Lz : inp.L) * 1000;
  const M = Math.abs(inp.M) * 1e6;
  const mi: MemberInput = {
    code: inp.code, section, steel: inp.steel, gammaC: inp.gammaC, gammaN: inp.gammaN,
    NEd: inp.N * 1000, MEd: M, buckling: { Lcr_y, Lcr_z },
    // ДБН: устойчивость из плоскости учитывается коэффициентом c (10.8); EN — χ_LT в формулах взаимодействия
    ltb: inp.code === "EN" && M > 0 ? { restrained: false, Lcr: Lcr_z, C1: 1, C2: 0, loadAt: "center" } : undefined,
  };
  const member = inp.code === "EN" ? checkMemberEN(mi) : checkMemberDBN(mi);
  return { section, member, Lcr_y, Lcr_z };
}

export function selectColumn(inp: ColumnDesignInput, family: string) {
  const tried: { name: string; mass: number; util: number }[] = [];
  for (const s of familySections(family)) {
    const r = designColumn(inp, s);
    tried.push({ name: s.name, mass: s.mass, util: r.member.maxUtil });
    if (r.member.ok) return { best: r, tried };
  }
  return { best: undefined as ColumnDesignResult | undefined, tried };
}
